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
    files = sorted((repo / 'dist').rglob('*'))
    if any(p.is_symlink() for p in files):
        raise ValueError('Symlinks are not allowed in the archive')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            if not path.is_file():
                continue
            entry = zipfile.ZipInfo(path.relative_to(repo / 'dist').as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, path.read_bytes(), compresslevel=9)
    payload = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP CRC check failed')
        for entry in archive.namelist():
            if archive.read(entry) != (repo / 'dist' / entry).read_bytes():
                raise ValueError('ZIP contents do not match dist')
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build')
    build.add_argument('--tag', required=True)
    build.add_argument('--notes', type=Path, required=True)
    build.add_argument('--output', type=Path, default=Path('releases'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    subprocess.run(['npm', 'run', 'check:package'], cwd=root, check=True)
    notes = [line.removeprefix('- ').strip() for line in args.notes.read_text().splitlines() if line.startswith('- ')]
    record = build_release(root, args.tag, notes, args.output)
    print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    main()
