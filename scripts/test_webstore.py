import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import webstore


ITEM = 'ainapeknaclcpoioimonkodmoakhacjd'
NAME = f'publishers/publisher-123/items/{ITEM}'
COMMIT = 'a' * 40
FIXTURE = Path(__file__).with_name('fixtures').joinpath('webstore-test.crx')
FIXTURE_KEY_SHA256 = '0d1d30c24f6545ca8109db07f0771aac54c1cae6eaf9c37873a46687091286f7'


def status(version, state='PUBLISHED', *, submitted=False):
    return {
        'name': NAME, 'itemId': ITEM,
        'submittedItemRevisionStatus' if submitted else 'publishedItemRevisionStatus': {
            'state': state, 'distributionChannels': [{'crxVersion': version, 'deployPercentage': 100}],
        },
    }


class WebstoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        payload = FIXTURE.read_bytes()
        self.archive = self.root / 'cqu-quicklogin-0.4.9-webstore.crx'
        self.archive.write_bytes(payload)
        self.record = self.root / 'signed-package.json'
        self.record.write_text(json.dumps({
            'version': '0.4.9', 'filename': self.archive.name, 'sourceCommit': COMMIT,
            'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(),
            'canaryKeyRemoved': True, 'uploadKeySha256': FIXTURE_KEY_SHA256,
        }))
        self.requests = []

    def publish(self, replies):
        def respond(request, **kwargs):
            self.requests.append(request)
            self.assertTrue(replies, f'Unexpected store request: {request.method} {request.full_url}')
            reply = replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return io.BytesIO(json.dumps(reply).encode())
        with patch('urllib.request.urlopen', side_effect=respond), patch('time.sleep'):
            return webstore.publish_archive(self.record, '0.4.9', COMMIT, 'publisher-123',
                                            'test-token', FIXTURE_KEY_SHA256)

    def test_uploads_verified_package_and_submits_for_automatic_publication(self):
        result = self.publish([
            status('0.4.6'),
            {'name': NAME, 'itemId': ITEM, 'crxVersion': '0.4.9', 'uploadState': 'SUCCEEDED'},
            {'name': NAME, 'itemId': ITEM, 'state': 'PENDING_REVIEW'},
            status('0.4.9', 'PENDING_REVIEW', submitted=True),
        ])
        self.assertEqual(result['state'], 'PENDING_REVIEW')
        self.assertEqual(result['version'], '0.4.9')
        upload = next(request for request in self.requests if request.full_url.endswith(':upload'))
        self.assertEqual(upload.data, self.archive.read_bytes())
        headers = {key.lower(): value for key, value in upload.header_items()}
        self.assertEqual(headers['x-goog-upload-protocol'], 'raw')
        self.assertEqual(headers['x-goog-upload-file-name'], self.archive.name)
        self.assertEqual(headers['content-type'], 'application/octet-stream')
        submit = next(request for request in self.requests if request.full_url.endswith(':publish'))
        self.assertEqual(json.loads(submit.data), {'publishType': 'DEFAULT_PUBLISH', 'blockOnWarnings': True})
        self.assertEqual(submit.get_header('Authorization'), 'Bearer test-token')

    def test_retry_does_not_upload_or_submit_an_already_pending_or_published_version(self):
        for state in ('PENDING_REVIEW', 'PUBLISHED'):
            with self.subTest(state=state):
                self.requests.clear()
                result = self.publish([status('0.4.9', state, submitted=state == 'PENDING_REVIEW')])
                self.assertEqual(result['state'], state)
                self.assertEqual([request.method for request in self.requests], ['GET'])

    def test_waits_without_mutation_for_another_review_or_staged_publication(self):
        for version, state, expected in (
                ('0.4.8', 'PENDING_REVIEW', 'WAITING_REVIEW'),
                ('0.4.10', 'PENDING_REVIEW', 'WAITING_REVIEW'),
                ('0.4.9', 'STAGED', 'WAITING_PUBLICATION')):
            with self.subTest(state=state, version=version):
                self.requests.clear()
                result = self.publish([status(version, state, submitted=True)])
                self.assertEqual(result['state'], expected)
                self.assertEqual(result['reviewVersions'], [version])
                self.assertEqual([request.method for request in self.requests], ['GET'])

    def test_older_candidate_after_canary_rollback_never_downgrades_store(self):
        result = self.publish([status('0.4.10')])
        self.assertEqual(result['state'], 'SUPERSEDED')
        self.assertEqual([request.method for request in self.requests], ['GET'])

    def test_rejection_and_policy_actions_block_automatic_resubmission(self):
        cases = [
            status('0.4.8', 'REJECTED', submitted=True),
            status('0.4.9', 'REJECTED', submitted=True),
            {**status('0.4.6'), 'takenDown': True},
            {**status('0.4.6'), 'warned': True},
            {'name': NAME, 'itemId': ITEM},
        ]
        for current in cases:
            with self.subTest(current=current):
                self.requests.clear()
                with self.assertRaises((ValueError, RuntimeError)):
                    self.publish([current])
                self.assertEqual([request.method for request in self.requests], ['GET'])

    def test_waits_for_async_upload_before_submitting(self):
        result = self.publish([
            status('0.4.6'),
            {'name': NAME, 'itemId': ITEM, 'uploadState': 'IN_PROGRESS'},
            {**status('0.4.6'), 'lastAsyncUploadState': 'IN_PROGRESS'},
            {**status('0.4.6'), 'lastAsyncUploadState': 'SUCCEEDED'},
            {'name': NAME, 'itemId': ITEM, 'state': 'PENDING_REVIEW'},
            status('0.4.9', 'PENDING_REVIEW', submitted=True),
        ])
        self.assertEqual(result['state'], 'PENDING_REVIEW')
        self.assertEqual([request.method for request in self.requests], ['GET', 'POST', 'GET', 'GET', 'POST', 'GET'])

    def test_policy_warning_during_async_upload_prevents_submission(self):
        with self.assertRaisesRegex(RuntimeError, 'policy action'):
            self.publish([
                status('0.4.6'),
                {'name': NAME, 'itemId': ITEM, 'uploadState': 'IN_PROGRESS'},
                {**status('0.4.6'), 'lastAsyncUploadState': 'SUCCEEDED', 'warned': True},
            ])
        self.assertFalse(any(request.full_url.endswith(':publish') for request in self.requests))

    def test_failed_or_unconfirmed_upload_never_submits(self):
        for state in ('FAILED', 'NOT_FOUND', 'UPLOAD_STATE_UNSPECIFIED', 'IN_PROGRESS'):
            with self.subTest(state=state):
                self.requests.clear()
                with self.assertRaises(RuntimeError):
                    self.publish([
                        status('0.4.6'),
                        {'name': NAME, 'itemId': ITEM, 'uploadState': 'IN_PROGRESS'},
                        *[{**status('0.4.6'), 'lastAsyncUploadState': state} for _ in range(12)],
                    ])
                self.assertFalse(any(request.full_url.endswith(':publish') for request in self.requests))

    def test_corrupt_package_is_rejected_before_any_network_request(self):
        self.archive.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            self.publish([])
        self.assertEqual(self.requests, [])

    def test_api_failure_does_not_leak_body_or_retry_a_mutation(self):
        secret_body = io.BytesIO(b'{"message":"sensitive account details test-token"}')
        denied = urllib.error.HTTPError('https://example.invalid', 403, 'Forbidden', {}, secret_body)
        with self.assertRaisesRegex(RuntimeError, 'HTTP 403') as error:
            self.publish([status('0.4.6'), denied])
        self.assertNotIn('sensitive', str(error.exception))
        self.assertNotIn('test-token', str(error.exception))
        self.assertEqual([request.method for request in self.requests], ['GET', 'POST'])

    def test_wrong_item_or_version_cannot_be_reported_as_success(self):
        for last in (
                status('0.4.8', 'PENDING_REVIEW', submitted=True),
                {**status('0.4.9', 'PENDING_REVIEW', submitted=True), 'itemId': 'wrong-item'}):
            with self.subTest(last=last), self.assertRaises((ValueError, RuntimeError)):
                self.publish([
                    status('0.4.6'),
                    {'name': NAME, 'itemId': ITEM, 'crxVersion': '0.4.9', 'uploadState': 'SUCCEEDED'},
                    {'name': NAME, 'itemId': ITEM, 'state': 'PENDING_REVIEW'},
                    last,
                ])


if __name__ == '__main__':
    unittest.main()
