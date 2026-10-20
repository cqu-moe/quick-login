#!/usr/bin/env python3
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import sign_webstore


FIXTURE = Path(__file__).with_name("fixtures").joinpath("webstore-test.crx")
FIXTURE_KEY_SHA256 = "0d1d30c24f6545ca8109db07f0771aac54c1cae6eaf9c37873a46687091286f7"
COMMIT = "a" * 40


def chrome_available():
    try:
        command = sign_webstore._chrome_command()
    except RuntimeError:
        return False
    if sys.platform == "linux":
        return shutil.which(command[-1]) is not None and shutil.which(command[0]) is not None
    return Path(command[0]).exists()


class SignWebstoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def prepared_record(self):
        payload = io.BytesIO()
        files = {
            "manifest.json": {
                "manifest_version": 3, "name": "QuickLogin Webstore Signing Fixture",
                "version": "0.4.9", "background": {"service_worker": "background.js"},
            },
            "build-info.json": {"extensionVersion": "0.4.9", "sourceCommit": COMMIT},
            "background.js": "/* synthetic runtime */",
            "assets/nested/runtime.js": "/* nested runtime asset */",
        }
        with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in files.items():
                archive.writestr(name, json.dumps(content, indent=2).encode()
                                 if isinstance(content, dict) else content.encode())
        data = payload.getvalue()
        directory = self.root / COMMIT
        directory.mkdir()
        (directory / "cqu-quicklogin-0.4.9-webstore.zip").write_bytes(data)
        record = directory / "package.json"
        record.write_text(json.dumps({
            "version": "0.4.9", "filename": "cqu-quicklogin-0.4.9-webstore.zip",
            "sourceCommit": COMMIT, "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "canaryKeyRemoved": True,
        }))
        return record, files

    def test_verifies_real_chrome_fixture_and_payload(self):
        crx = FIXTURE.read_bytes()
        archive = sign_webstore.read_verified_crx(crx, FIXTURE_KEY_SHA256)
        files = sign_webstore._zip_files(archive)
        self.assertEqual(json.loads(files["manifest.json"])["version"], "0.4.9")
        self.assertEqual(files["background.js"], b"/* synthetic runtime */")

    def test_rejects_corrupt_signature_payload_or_wrong_key_digest(self):
        crx = FIXTURE.read_bytes()
        header_size = struct.unpack_from("<I", crx, 8)[0]
        cases = [
            crx[:12 + header_size - 1] + bytes([crx[12 + header_size - 1] ^ 1]) + crx[12 + header_size:],
            crx[:-1] + bytes([crx[-1] ^ 1]),
            crx[:8] + struct.pack("<I", sign_webstore.MAX_CRX_HEADER + 1) + crx[12:],
        ]
        for payload in cases:
            with self.subTest(payload=payload[-1:]):
                with self.assertRaises(ValueError):
                    sign_webstore.read_verified_crx(payload, FIXTURE_KEY_SHA256)
        with self.assertRaises(ValueError):
            sign_webstore.read_verified_crx(crx, "0" * 64)

    def test_ignores_safe_directories_but_rejects_directory_traversal(self):
        for name in ('assets/', '../escape/'):
            with self.subTest(name=name):
                payload = io.BytesIO()
                with zipfile.ZipFile(payload, 'w') as archive:
                    archive.writestr(name, b'')
                if name == 'assets/':
                    self.assertEqual(sign_webstore._zip_files(payload.getvalue()), {})
                else:
                    with self.assertRaises(ValueError):
                        sign_webstore._zip_files(payload.getvalue())

    def test_rejects_protobuf_length_past_remaining_bytes(self):
        with self.assertRaises(ValueError):
            list(sign_webstore._protobuf_fields(b"\x0a\x02a"))

    def test_rejects_key_fingerprint_mismatch_before_chrome(self):
        record, _ = self.prepared_record()
        key = self.root / "transient-key.pem"
        subprocess.run([
            "openssl", "genpkey", "-algorithm", "RSA",
            "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(key),
        ], check=True, capture_output=True)
        with patch.dict(os.environ, {
            "CWS_UPLOAD_PRIVATE_KEY": key.read_text(),
            "CWS_UPLOAD_KEY_SHA256": "1" * 64,
        }), patch.object(sign_webstore, "_pack_extension") as pack:
            with self.assertRaises((RuntimeError, ValueError)):
                sign_webstore.sign_archive(record)
            pack.assert_not_called()

    @unittest.skipUnless(chrome_available(), "Google Chrome is not installed")
    def test_real_chrome_signing_smoke(self):
        record, _ = self.prepared_record()
        key = self.root / "transient-key.pem"
        subprocess.run([
            "openssl", "genpkey", "-algorithm", "RSA",
            "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(key),
        ], check=True, capture_output=True)
        public = subprocess.run([
            "openssl", "pkey", "-in", str(key), "-pubout", "-outform", "DER",
        ], check=True, capture_output=True).stdout
        fingerprint = hashlib.sha256(public).hexdigest()
        with patch.dict(os.environ, {
            "CWS_UPLOAD_PRIVATE_KEY": key.read_text(),
            "CWS_UPLOAD_KEY_SHA256": fingerprint,
        }):
            result = sign_webstore.sign_archive(record)
        self.assertEqual(result["uploadKeySha256"], fingerprint)
        crx = (record.parent / result["filename"]).read_bytes()
        signed = sign_webstore._zip_files(sign_webstore.read_verified_crx(crx, fingerprint))
        self.assertEqual(signed, sign_webstore._zip_files(
            (record.parent / "cqu-quicklogin-0.4.9-webstore.zip").read_bytes()
        ))
        self.assertEqual(json.loads(signed["manifest.json"])["version"], "0.4.9")
        self.assertEqual(json.loads((record.parent / "signed-package.json").read_text()), result)


if __name__ == "__main__":
    unittest.main()
