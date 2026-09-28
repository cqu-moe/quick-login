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


if __name__ == '__main__':
    unittest.main()
