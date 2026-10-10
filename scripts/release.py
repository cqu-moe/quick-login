#!/usr/bin/env python3
"""Build and publish verified QuickLogin canary archives."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlparse
import zipfile

VERSION = re.compile(r'(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})')
CHANNEL_KEY = 'quicklogin/channels/canary.json'


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


def version_tuple(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError('Invalid X.Y.Z version')
    parts = tuple(map(int, value.split('.')))
    if max(parts) > 65535 or parts == (0, 0, 0):
        raise ValueError('Version outside extension manifest range')
    return parts


def validate_record(record):
    if not isinstance(record, dict):
        raise ValueError('Invalid release record')
    version = record.get('version')
    version_tuple(version)
    filename = f'cqu-quicklogin-{version}-canary.zip'
    if (record.get('schemaVersion') != 1 or record.get('channel') != 'canary'
            or record.get('filename') != filename
            or record.get('objectKey') != f'quicklogin/releases/{version}/{filename}'
            or type(record.get('size')) is not int or record['size'] <= 0
            or type(record.get('protocolVersion')) is not int or record['protocolVersion'] <= 0):
        raise ValueError('Invalid release identity or size')
    for field, length in [('sha256', 64), ('sourceCommit', 40), ('contractDigest', 64)]:
        if not isinstance(record.get(field), str) or not re.fullmatch('[a-f0-9]{' + str(length) + '}', record[field]):
            raise ValueError(f'Invalid {field}')
    if not isinstance(record.get('publishedAt'), str):
        raise ValueError('Invalid publication time')
    date = datetime.fromisoformat(record['publishedAt'].replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('Publication time needs timezone')
    notes = record.get('notes')
    if not isinstance(notes, list) or not notes or len(notes) > 32 or any(not isinstance(n, str) or not n.strip() or len(n) > 1024 for n in notes):
        raise ValueError('Invalid release notes')
    return record


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def write_immutable(path, content):
    try:
        with path.open('xb') as output:
            output.write(content)
    except FileExistsError:
        if path.read_bytes() != content:
            raise ValueError(f'Refusing to overwrite {path.name}')


def archive_directory(root):
    files = sorted(root.rglob('*'))
    if any(path.is_symlink() for path in files):
        raise ValueError('Symlinks are not allowed in the archive')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            if not path.is_file():
                continue
            entry = zipfile.ZipInfo(path.relative_to(root).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, path.read_bytes(), compresslevel=9)
    return buffer.getvalue()


def verify_directory_archive(payload, root):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP CRC check failed')
        for entry in archive.namelist():
            if archive.read(entry) != (root / entry).read_bytes():
                raise ValueError('ZIP contents do not match build output')


def build_release(repo, tag, notes, output):
    if not tag.startswith('v'):
        raise ValueError('Release tag must be vX.Y.Z')
    version = tag[1:]
    version_tuple(version)
    read = lambda name: json.loads((repo / name).read_text())
    package, lock = read('package.json'), read('package-lock.json')
    info = read('dist/build-info.json')
    versions = [package['version'], lock['version'], lock['packages']['']['version'],
                read('public/manifest.json')['version'], read('dist/manifest.json')['version'], info['extensionVersion']]
    if any(v != version for v in versions):
        raise ValueError('Tag, source and built versions differ')
    if info['sourceCommit'] != git(repo, 'rev-parse', 'HEAD'):
        raise ValueError('Built source commit does not equal HEAD')
    payload = archive_directory(repo / 'dist')
    verify_directory_archive(payload, repo / 'dist')
    filename = f'cqu-quicklogin-{version}-canary.zip'
    record = validate_record({
        'schemaVersion': 1, 'channel': 'canary', 'version': version, 'filename': filename,
        'objectKey': f'quicklogin/releases/{version}/{filename}', 'size': len(payload),
        'sha256': hashlib.sha256(payload).hexdigest(), 'sourceCommit': info['sourceCommit'],
        'protocolVersion': info['protocolVersion'], 'contractDigest': info['contractDigest'],
        'publishedAt': datetime.fromtimestamp(int(git(repo, 'show', '-s', '--format=%ct', 'HEAD')), timezone.utc).isoformat(),
        'notes': notes,
    })
    output.mkdir(parents=True, exist_ok=True)
    write_immutable(output / filename, payload)
    write_immutable(output / f'{version}.json', json_bytes(record))
    return record


def s3_call(endpoint, operation, *arguments):
    result = subprocess.run(['aws', '--endpoint-url', endpoint, '--region', 'auto', '--output', 'json',
                             's3api', operation, *map(str, arguments)], capture_output=True, text=True)
    if result.returncode:
        match = re.search(r'An error occurred \(([^)]+)\)', result.stderr)
        code = match.group(1) if match else 'CLI_FAILED'
        if operation == 'get-object' and code in ('NoSuchKey', 'NotFound', '404'):
            return None
        if operation == 'put-object' and code in ('PreconditionFailed', '412', 'ConditionalRequestConflict', '409'):
            return False
        raise RuntimeError(f'S3 {operation} failed: {code}')
    return json.loads(result.stdout or '{}')


def s3_get(bucket, endpoint, key, destination, *, expected_sha256=None):
    response = s3_call(endpoint, 'get-object', '--bucket', bucket, '--key', key, destination)
    if response is not None and expected_sha256 is not None and response.get('Metadata', {}).get('sha256') != expected_sha256:
        raise ValueError('Missing or inconsistent object digest metadata')
    return None if response is None else response['ETag']


def s3_put(bucket, endpoint, key, source, *, etag=None, create=False, sha256=None):
    if create == (etag is not None):
        raise ValueError('Every write requires exactly one precondition')
    arguments = ['--bucket', bucket, '--key', key, '--body', source,
                 '--content-type', 'application/zip' if sha256 else 'application/json',
                 '--cache-control', 'private, no-store']
    arguments += ['--if-none-match', '*'] if create else ['--if-match', etag]
    if sha256:
        arguments += ['--metadata', json.dumps({'sha256': sha256})]
    return s3_call(endpoint, 'put-object', *arguments) is not False


def verify_package(record, payload):
    validate_record(record)
    if len(payload) != record['size'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
        raise ValueError('Package size or SHA-256 does not match release record')
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if archive.testzip() is not None:
            raise ValueError('Package CRC check failed')
        manifest = json.loads(archive.read('manifest.json'))
        info = json.loads(archive.read('build-info.json'))
        if manifest['version'] != record['version'] or info['extensionVersion'] != record['version']:
            raise ValueError('Embedded package version does not match release record')
        for key in ('sourceCommit', 'protocolVersion', 'contractDigest'):
            if info[key] != record[key]:
                raise ValueError(f'Embedded {key} does not match release record')


def promote_release(record, bucket, endpoint, directory, *, rollback=False):
    remote_zip = directory / 'remote.zip'
    if s3_get(bucket, endpoint, record['objectKey'], remote_zip, expected_sha256=record['sha256']) is None:
        raise ValueError('Published package is missing')
    verify_package(record, remote_zip.read_bytes())
    pointer = directory / 'current.json'
    etag = s3_get(bucket, endpoint, CHANNEL_KEY, pointer)
    current = validate_record(json.loads(pointer.read_text())) if etag is not None else None
    if current is not None:
        if current['version'] == record['version']:
            if current != record:
                raise ValueError('Current version has conflicting metadata')
            return {'version': record['version'], 'sha256': record['sha256'], 'promoted': False}
        if not rollback and version_tuple(current['version']) > version_tuple(record['version']):
            raise ValueError('An older release cannot replace the current version')
    new_pointer = directory / 'next.json'; new_pointer.write_bytes(json_bytes(record))
    if not s3_put(bucket, endpoint, CHANNEL_KEY, new_pointer, etag=etag, create=etag is None):
        raise RuntimeError('Release pointer changed concurrently; rerun to re-evaluate')
    if s3_get(bucket, endpoint, CHANNEL_KEY, pointer) is None or json.loads(pointer.read_text()) != record:
        raise RuntimeError('Release pointer readback differs; inspect before retrying')
    return {'previousVersion': current['version'] if current else None,
            'version': record['version'], 'sha256': record['sha256'], 'promoted': True}


def publish_release(record, archive, bucket, endpoint):
    verify_package(record, archive.read_bytes())
    with tempfile.TemporaryDirectory(prefix='quicklogin-publish-') as temporary:
        directory = Path(temporary)
        if not s3_put(bucket, endpoint, record['objectKey'], archive, create=True, sha256=record['sha256']):
            remote = directory / 'existing.zip'
            if s3_get(bucket, endpoint, record['objectKey'], remote, expected_sha256=record['sha256']) is None:
                raise RuntimeError('Existing package disappeared')
            verify_package(record, remote.read_bytes())
        metadata_key = f"quicklogin/releases/{record['version']}/release.json"
        metadata = directory / 'release.json'; metadata.write_bytes(json_bytes(record))
        if not s3_put(bucket, endpoint, metadata_key, metadata, create=True):
            existing = directory / 'existing.json'
            if s3_get(bucket, endpoint, metadata_key, existing) is None or json.loads(existing.read_text()) != record:
                raise ValueError('Refusing to overwrite existing release metadata')
        # Read back the immutable record as well as the ZIP before promoting it.
        checked = directory / 'checked.json'
        if s3_get(bucket, endpoint, metadata_key, checked) is None or json.loads(checked.read_text()) != record:
            raise ValueError('Release metadata readback differs')
        return promote_release(record, bucket, endpoint, directory)


def rollback_release(version, bucket, endpoint):
    version_tuple(version)
    with tempfile.TemporaryDirectory(prefix='quicklogin-rollback-') as temporary:
        directory = Path(temporary); metadata = directory / 'release.json'
        if s3_get(bucket, endpoint, f'quicklogin/releases/{version}/release.json', metadata) is None:
            raise ValueError('Rollback version has not been published')
        record = validate_record(json.loads(metadata.read_text()))
        if record['version'] != version:
            raise ValueError('Rollback metadata version differs')
        return promote_release(record, bucket, endpoint, directory, rollback=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build')
    build.add_argument('--tag', required=True)
    build.add_argument('--notes', type=Path, required=True)
    build.add_argument('--output', type=Path, default=Path('releases'))
    publish = commands.add_parser('publish')
    publish.add_argument('--record', type=Path, required=True)
    rollback = commands.add_parser('rollback')
    rollback.add_argument('--version', required=True)
    for command in (publish, rollback):
        command.add_argument('--bucket', required=True)
        command.add_argument('--endpoint', required=True)
    args = parser.parse_args()
    if args.command == 'build':
        root = Path(__file__).resolve().parent.parent
        subprocess.run(['npm', 'run', 'check:package'], cwd=root, check=True)
        notes = [line.removeprefix('- ').strip() for line in args.notes.read_text().splitlines() if line.startswith('- ')]
        result = build_release(root, args.tag, notes, args.output)
    else:
        endpoint = urlparse(args.endpoint)
        if (endpoint.scheme != 'https' or not re.fullmatch(r'[a-f0-9]{32}\.r2\.cloudflarestorage\.com', endpoint.netloc)
                or endpoint.path not in ('', '/') or endpoint.query or endpoint.fragment):
            parser.error('Endpoint must be the HTTPS Cloudflare R2 S3 account endpoint')
        if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', args.bucket):
            parser.error('Invalid bucket name')
        if args.command == 'publish':
            record = validate_record(json.loads(args.record.read_text()))
            result = publish_release(record, args.record.parent / record['filename'], args.bucket, args.endpoint)
        else:
            result = rollback_release(args.version, args.bucket, args.endpoint)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
