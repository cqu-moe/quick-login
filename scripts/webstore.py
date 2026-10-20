#!/usr/bin/env python3
"""Upload a verified QuickLogin package and submit it for automatic publication."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
import zipfile

from release import version_tuple
from sign_webstore import read_verified_crx

ITEM_ID = 'ainapeknaclcpoioimonkodmoakhacjd'
API = 'https://chromewebstore.googleapis.com'


def publish_archive(record_path, version, commit, publisher, token, expected_key_sha256):
    version_tuple(version)
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('Invalid source commit')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', publisher) or not token.strip():
        raise ValueError('Missing or invalid Chrome Web Store authentication')
    record = json.loads(record_path.read_text())
    filename = f'cqu-quicklogin-{version}-webstore.crx'
    if (record['filename'] != filename or record['version'] != version
            or record['sourceCommit'] != commit or record.get('canaryKeyRemoved') is not True
            or record.get('uploadKeySha256') != expected_key_sha256):
        raise ValueError('Package identity differs from the verified release')
    payload = (record_path.parent / filename).read_bytes()
    if len(payload) != record['size'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
        raise ValueError('Package size or SHA-256 differs')
    with zipfile.ZipFile(io.BytesIO(read_verified_crx(payload, expected_key_sha256))) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        info = json.loads(archive.read('build-info.json'))
        if (archive.testzip() is not None or 'key' in manifest or manifest.get('manifest_version') != 3
                or manifest['version'] != version or info['extensionVersion'] != version
                or info['sourceCommit'] != commit):
            raise ValueError('Invalid embedded manifest or build provenance')

    name = f'publishers/{publisher}/items/{ITEM_ID}'

    def request(method, operation, data=None):
        prefix = '/upload/v2/' if operation == 'upload' else '/v2/'
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
        if operation == 'upload':
            headers.update({'Content-Type': 'application/octet-stream', 'X-Goog-Upload-Protocol': 'raw',
                            'X-Goog-Upload-File-Name': filename})
        req = urllib.request.Request(API + prefix + name + ':' + operation, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            # API bodies can contain account data; report only the operation and HTTP status.
            raise RuntimeError(f'Chrome Web Store {operation}: HTTP {error.code}; inspect Dashboard before retrying') from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError(f'Chrome Web Store {operation}: transport failure; inspect Dashboard before retrying') from None
        if result.get('name') != name or result.get('itemId') != ITEM_ID:
            raise ValueError('Chrome Web Store response belongs to a different item')
        return result

    def versions(revision):
        return {channel['crxVersion'] for channel in revision.get('distributionChannels', [])}

    def receipt(current):
        for field in ('publishedItemRevisionStatus', 'submittedItemRevisionStatus'):
            revision = current.get(field, {})
            if revision.get('state') in ('PENDING_REVIEW', 'PUBLISHED') and versions(revision) == {version}:
                return {**record, 'itemId': ITEM_ID, 'state': revision['state']}
        return None

    current = request('GET', 'fetchStatus')
    if current.get('takenDown') or current.get('warned'):
        raise RuntimeError('Store policy action requires Dashboard review')
    published = current.get('publishedItemRevisionStatus', {})
    submitted = current.get('submittedItemRevisionStatus', {})
    if not published and not submitted:
        raise RuntimeError('No existing release state; inspect Dashboard')
    for revision in (published, submitted):
        if revision:
            if not versions(revision) or revision.get('state') not in (
                    'PUBLISHED', 'PENDING_REVIEW', 'STAGED', 'REJECTED', 'CANCELLED'):
                raise RuntimeError('Unknown store state; inspect Dashboard')
            for value in versions(revision):
                version_tuple(value)
    if submitted.get('state') == 'REJECTED':
        raise RuntimeError('Store rejected a submission; resolve the review before automatic publishing')
    if any(version_tuple(v) > version_tuple(version) for v in versions(published)):
        return {**record, 'itemId': ITEM_ID, 'state': 'SUPERSEDED'}
    if existing := receipt(current):
        return existing
    if submitted.get('state') in ('PENDING_REVIEW', 'STAGED'):
        return {**record, 'itemId': ITEM_ID,
                'state': 'WAITING_REVIEW' if submitted['state'] == 'PENDING_REVIEW' else 'WAITING_PUBLICATION',
                'reviewVersions': sorted(versions(submitted))}
    if current.get('lastAsyncUploadState') in ('IN_PROGRESS', 'UPLOAD_IN_PROGRESS'):
        raise RuntimeError('An earlier upload is still processing; retry after it finishes')
    upload = request('POST', 'upload', payload)
    upload_state = upload.get('uploadState')
    if upload_state == 'SUCCEEDED' and upload.get('crxVersion') != version:
        raise RuntimeError('Upload did not confirm the requested version')
    # shortcut: item-wide async status needs one uploader; add a shared lock before allowing other writers.
    for _ in range(12):
        if upload_state not in ('IN_PROGRESS', 'UPLOAD_IN_PROGRESS'):
            break
        time.sleep(5)
        processing = request('GET', 'fetchStatus')
        if processing.get('takenDown') or processing.get('warned'):
            raise RuntimeError('Store policy action requires Dashboard review')
        upload_state = processing.get('lastAsyncUploadState')
    if upload_state != 'SUCCEEDED':
        raise RuntimeError(f'Upload is not ready: {upload_state}; nothing was submitted')
    submitted = request('POST', 'publish', json.dumps({
        'publishType': 'DEFAULT_PUBLISH', 'blockOnWarnings': True,
    }).encode())
    if submitted.get('state') not in ('PENDING_REVIEW', 'PUBLISHED'):
        raise RuntimeError('Store did not accept automatic publication')
    current = request('GET', 'fetchStatus')
    if result := receipt(current):
        return result
    raise RuntimeError('Submission readback did not confirm the requested version')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--source-commit', required=True)
    args = parser.parse_args()
    try:
        result = publish_archive(args.record, args.version, args.source_commit,
                                 os.environ.get('CWS_PUBLISHER_ID', ''), os.environ.get('CWS_ACCESS_TOKEN', ''),
                                 os.environ.get('CWS_UPLOAD_KEY_SHA256', ''))
    except (ValueError, KeyError, OSError, RuntimeError, zipfile.BadZipFile) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False))
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a') as output:
            output.write('## Chrome Web Store\n\n')
            for key in ('version', 'sourceCommit', 'sha256', 'itemId', 'state'):
                output.write(f'- {key}: `{result[key]}`\n')
            if result.get('reviewVersions'):
                output.write('- Waiting for: `' + ', '.join(result['reviewVersions']) + '`\n')
            output.write('\nPENDING_REVIEW means submitted, not published. Google controls review timing.\n')
            output.write('WAITING states leave the existing submission untouched; the next scheduled run re-reads the latest Canary candidate.\n')


if __name__ == '__main__':
    main()
