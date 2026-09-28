import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'dist').mkdir()
        (self.root / 'public').mkdir()
        self.write('package.json', {'version': '0.4.0'})
        self.write('package-lock.json', {'version': '0.4.0', 'packages': {'': {'version': '0.4.0'}}})
        self.write('public/manifest.json', {'version': '0.4.0'})
        self.write('dist/manifest.json', {'version': '0.4.0'})
        self.write('dist/build-info.json', {'extensionVersion': '0.4.0', 'sourceCommit': 'a' * 40,
                   'protocolVersion': 3, 'contractDigest': 'b' * 64})
        (self.root / 'dist/background.js').write_text('console.log("synthetic");')
        self.git = patch.object(release, 'git', side_effect=lambda root, *args: '1700000000' if args[0] == 'show' else 'a' * 40)
        self.git.start()
        self.addCleanup(self.git.stop)

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def build(self, output='out', tag='v0.4.0'):
        return release.build_release(self.root, tag, ['合成发布说明'], self.root / output)

    def test_zip_is_verified_deterministic_and_never_overwritten(self):
        first = self.build()
        archive = self.root / 'out' / first['filename']
        with zipfile.ZipFile(archive) as z:
            self.assertEqual(z.namelist(), ['background.js', 'build-info.json', 'manifest.json'])
            self.assertIsNone(z.testzip())
        os.utime(self.root / 'dist/background.js', (1800000000, 1800000000))
        self.assertEqual(self.build('other')['sha256'], first['sha256'])
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), first['sha256'])
        self.assertEqual(self.build(), first)
        archive.write_bytes(b'cannot overwrite')
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual(archive.read_bytes(), b'cannot overwrite')

    def test_rejects_version_provenance_and_symlinks(self):
        with self.assertRaises(ValueError):
            self.build(tag='v0.4.1')
        self.write('package-lock.json', {'version': '0.4.1', 'packages': {'': {'version': '0.4.0'}}})
        with self.assertRaises(ValueError):
            self.build()
        self.write('package-lock.json', {'version': '0.4.0', 'packages': {'': {'version': '0.4.0'}}})
        info = json.loads((self.root / 'dist/build-info.json').read_text())
        info['sourceCommit'] = 'c' * 40
        self.write('dist/build-info.json', info)
        with self.assertRaises(ValueError):
            self.build()
        info['sourceCommit'] = 'a' * 40
        self.write('dist/build-info.json', info)
        (self.root / 'dist/link').symlink_to(self.root / 'package.json')
        with self.assertRaises(ValueError):
            self.build()

    def test_rejects_untrusted_record_keys_and_versions(self):
        record = self.build()
        for key, value in [('objectKey', '../secret'), ('filename', 'bad\r\nheader.zip'),
                           ('version', '0.4.0/../../secret'), ('size', True), ('sha256', 'bad')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate_record({**record, key: value})


class PublishTests(unittest.TestCase):
    write = PackageTests.write
    build = PackageTests.build

    def setUp(self):
        PackageTests.setUp(self)
        self.store = {}
        self.events = []
        self.get_patch = patch.object(release, 's3_get', side_effect=self.get)
        self.put_patch = patch.object(release, 's3_put', side_effect=self.put)
        self.get_patch.start(); self.put_patch.start()
        self.addCleanup(self.get_patch.stop); self.addCleanup(self.put_patch.stop)

    def get(self, bucket, endpoint, key, destination):
        self.events.append(('get', key))
        if key not in self.store:
            return None
        data = self.store[key]
        destination.write_bytes(data)
        return '"' + hashlib.md5(data).hexdigest() + '"'

    def put(self, bucket, endpoint, key, source, *, etag=None, create=False, sha256=None):
        self.events.append(('put', key))
        current = self.store.get(key)
        if create and current is not None:
            return False
        if etag is not None and (current is None or etag != '"' + hashlib.md5(current).hexdigest() + '"'):
            return False
        self.store[key] = source.read_bytes()
        return True

    def record(self, version):
        for name in ['package.json', 'package-lock.json', 'public/manifest.json', 'dist/manifest.json']:
            item = json.loads((self.root / name).read_text()); item['version'] = version
            if name == 'package-lock.json': item['packages']['']['version'] = version
            self.write(name, item)
        info = json.loads((self.root / 'dist/build-info.json').read_text()); info['extensionVersion'] = version
        self.write('dist/build-info.json', info)
        return self.build(output=version, tag='v' + version)

    def publish(self, record):
        return release.publish_release(record, self.root / record['version'] / record['filename'], 'bucket', 'endpoint')

    def test_publish_verifies_before_promotion_and_reuses_identical_objects(self):
        record = self.record('0.4.0')
        self.publish(record)
        self.assertEqual(json.loads(self.store[release.CHANNEL_KEY]), record)
        self.assertLess(self.events.index(('get', record['objectKey'])), self.events.index(('put', release.CHANNEL_KEY)))
        previous = dict(self.store); self.publish(record)
        self.assertEqual(self.store, previous)
        self.store[record['objectKey']] = b'tampered'
        with self.assertRaises(ValueError): self.publish(record)
        self.assertEqual(self.store[record['objectKey']], b'tampered')

    def test_monotonic_promotion_and_explicit_verified_rollback(self):
        old = self.record('0.9.0'); self.publish(old)
        latest = self.record('0.10.0'); self.publish(latest)
        with self.assertRaises(ValueError): self.publish(old)
        self.assertEqual(json.loads(self.store[release.CHANNEL_KEY])['version'], '0.10.0')
        release.rollback_release('0.9.0', 'bucket', 'endpoint')
        self.assertEqual(json.loads(self.store[release.CHANNEL_KEY])['version'], '0.9.0')
        with self.assertRaises(ValueError): release.rollback_release('0.8.0', 'bucket', 'endpoint')

    def test_failed_remote_readback_and_pointer_conflict_do_not_promote(self):
        record = self.record('0.4.0')
        original = self.get
        def corrupt(bucket, endpoint, key, destination):
            etag = original(bucket, endpoint, key, destination)
            if key == record['objectKey']: destination.write_bytes(b'corrupt')
            return etag
        with patch.object(release, 's3_get', side_effect=corrupt):
            with self.assertRaises(ValueError): self.publish(record)
        self.assertNotIn(release.CHANNEL_KEY, self.store)
        original_put = self.put
        def conflict(bucket, endpoint, key, source, **kwargs):
            if key == release.CHANNEL_KEY: return False
            return original_put(bucket, endpoint, key, source, **kwargs)
        with patch.object(release, 's3_put', side_effect=conflict):
            with self.assertRaises(RuntimeError): self.publish(record)
        self.assertNotIn(release.CHANNEL_KEY, self.store)


class AwsBoundaryTests(unittest.TestCase):
    def test_get_distinguishes_missing_from_denied_and_put_is_conditional(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'file'; path.write_bytes(b'test')
            from subprocess import CompletedProcess
            with patch.object(release.subprocess, 'run', return_value=CompletedProcess([], 0, '{"ETag":"etag"}', '')) as run:
                self.assertTrue(release.s3_put('bucket', 'endpoint', 'key', path, create=True, sha256='a'*64))
                self.assertIn('--if-none-match', run.call_args.args[0])
                self.assertIn('--metadata', run.call_args.args[0])
                self.assertTrue(release.s3_put('bucket', 'endpoint', 'key', path, etag='old'))
                self.assertIn('--if-match', run.call_args.args[0])
            with patch.object(release.subprocess, 'run', return_value=CompletedProcess([], 254, '', 'An error occurred (NoSuchKey) when calling GetObject')):
                self.assertIsNone(release.s3_get('bucket', 'endpoint', 'key', path))
            with patch.object(release.subprocess, 'run', return_value=CompletedProcess([], 254, '', 'An error occurred (AccessDenied) when calling GetObject')):
                with self.assertRaises(RuntimeError): release.s3_get('bucket', 'endpoint', 'key', path)


if __name__ == '__main__':
    unittest.main()
