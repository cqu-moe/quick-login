#!/usr/bin/env python3
"""Create verified, deterministic CI archives without release-channel metadata."""
import argparse
import hashlib
import json
from pathlib import Path
import re

import release


FORBIDDEN_NAMES = re.compile(r'\.map$|(^|/)\.env|\.pem$|\.key$', re.IGNORECASE)
FORBIDDEN_CONTENT = re.compile(
    rb'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|client_secret|sourceMappingURL=', re.IGNORECASE)


def validate_public_output(root):
    if not root.is_dir():
        raise ValueError(f'Missing build output: {root}')
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Symlink is not allowed in artifact: {path.relative_to(root)}')
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        if FORBIDDEN_NAMES.search(name):
            raise ValueError(f'Forbidden artifact file: {name}')
        if FORBIDDEN_CONTENT.search(path.read_bytes()):
            raise ValueError(f'Forbidden artifact content: {name}')


def package_output(repo, source, filename, *, version, source_commit, kind):
    validate_public_output(source)
    payload = release.archive_directory(source)
    release.verify_directory_archive(payload, source)
    return {
        'kind': kind,
        'version': version,
        'sourceCommit': source_commit,
        'filename': filename,
        'size': len(payload),
        'sha256': hashlib.sha256(payload).hexdigest(),
        '_payload': payload,
    }


def build_ci_artifacts(repo, output):
    package = json.loads((repo / 'package.json').read_text())
    lock = json.loads((repo / 'package-lock.json').read_text())
    version = release.version_tuple(package.get('version'))
    if package['version'] != lock.get('version') or package['version'] != lock.get('packages', {}).get('', {}).get('version'):
        raise ValueError('Package and lockfile versions differ')
    source_manifest = json.loads((repo / 'public/manifest.json').read_text())
    manifest = json.loads((repo / 'dist/manifest.json').read_text())
    info = json.loads((repo / 'dist/build-info.json').read_text())
    source_commit = release.git(repo, 'rev-parse', 'HEAD')
    if any(value != package['version'] for value in (
            source_manifest.get('version'), manifest.get('version'), info.get('extensionVersion'))):
        raise ValueError('Source and built extension versions differ')
    if info.get('sourceCommit') != source_commit:
        raise ValueError('Built extension source commit does not equal HEAD')

    extension = package_output(
        repo, repo / 'dist', f'cqu-quicklogin-{package["version"]}-ci-{source_commit}.zip',
        version=package['version'], source_commit=source_commit, kind='extension')
    website = package_output(
        repo, repo / 'website/dist', f'quicklogin-website-{package["version"]}-{source_commit}.zip',
        version=package['version'], source_commit=source_commit, kind='website')
    output.mkdir(parents=True, exist_ok=True)
    for artifact in (extension, website):
        release.write_immutable(output / artifact['filename'], artifact.pop('_payload'))
    record = {
        'schemaVersion': 1,
        'artifactChannel': 'ci',
        'sourceCommit': source_commit,
        'extension': {key: value for key, value in extension.items() if key != '_payload'},
        'website': {key: value for key, value in website.items() if key != '_payload'},
    }
    metadata = release.json_bytes(record)
    release.write_immutable(output / 'build.json', metadata)
    checksums = ''.join(
        f'{hashlib.sha256(content).hexdigest()}  {name}\n'
        for name, content in (
            (record['extension']['filename'], (output / record['extension']['filename']).read_bytes()),
            (record['website']['filename'], (output / record['website']['filename']).read_bytes()),
            ('build.json', metadata),
        ))
    release.write_immutable(output / 'SHA256SUMS', checksums.encode('ascii'))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('ci-artifacts'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    result = build_ci_artifacts(root, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
