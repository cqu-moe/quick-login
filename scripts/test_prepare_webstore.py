import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch
import zipfile

import prepare_webstore
from release import CHANNEL_KEY, archive_directory, json_bytes


COMMIT = "a" * 40
ICON = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class PrepareWebstoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        dist = self.root / "dist"
        dist.mkdir()
        (dist / "background.js").write_text("/* runtime */")
        (dist / "icon.png").write_bytes(ICON)
        (dist / "build-info.json").write_text(json.dumps({
            "extensionVersion": "0.4.9", "sourceCommit": COMMIT,
            "protocolVersion": 1, "contractDigest": "b" * 64,
        }))
        (dist / "manifest.json").write_text(json.dumps({
            "manifest_version": 3, "version": "0.4.9", "key": "canary-key",
            "icons": {"1": "icon.png"},
        }))
        self.canary = archive_directory(dist)
        self.record = {
            "schemaVersion": 1, "channel": "canary", "version": "0.4.9",
            "filename": "cqu-quicklogin-0.4.9-canary.zip",
            "objectKey": "quicklogin/releases/0.4.9/cqu-quicklogin-0.4.9-canary.zip",
            "size": len(self.canary), "sha256": hashlib.sha256(self.canary).hexdigest(),
            "sourceCommit": COMMIT, "protocolVersion": 1, "contractDigest": "b" * 64,
            "publishedAt": "2026-10-20T04:00:00+00:00", "notes": ["Test release"],
        }
        self.objects = {
            CHANNEL_KEY: json_bytes(self.record),
            "quicklogin/releases/0.4.9/release.json": json_bytes(self.record),
            self.record["objectKey"]: self.canary,
        }
        self.calls = []
        self.pointer_race = False

    def get(self, bucket, endpoint, key, destination, **kwargs):
        self.calls.append(key)
        self.assertEqual(bucket, "quicklogin")
        self.assertEqual(endpoint, "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com")
        if key == CHANNEL_KEY and self.pointer_race and len(self.calls) == 4:
            replacement = {**self.record, "version": "0.5.0"}
            payload = json_bytes(replacement)
        else:
            payload = self.objects[key]
        Path(destination).write_bytes(payload)
        return '"etag"'

    def invoke(self, output):
        github_output = output / "github-output"
        argv = [
            "prepare_webstore.py", "--bucket", "quicklogin", "--endpoint",
            "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
            "--output", str(output),
        ]
        with patch.object(prepare_webstore, "s3_get", self.get), patch.dict(
                os.environ, {"GITHUB_OUTPUT": str(github_output)}), patch.object(
                sys, "argv", argv):
            prepare_webstore.main()


    def prepare(self, output):
        github_output = output / "github-output"
        self.invoke(output)
        return github_output

    def test_prepares_verified_package_and_reports_workflow_outputs(self):
        output = self.root / "webstore"
        github_output = self.prepare(output)

        record_path = output / COMMIT / "package.json"
        archive_path = output / COMMIT / "cqu-quicklogin-0.4.9-webstore.zip"
        record = json.loads(record_path.read_text())
        payload = archive_path.read_bytes()
        self.assertEqual(record["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(record["size"], len(payload))
        self.assertTrue(record["canaryKeyRemoved"])
        self.assertEqual(
            github_output.read_text(),
            f"version=0.4.9\nsource_commit={COMMIT}\nrecord={(archive_path.parent / 'package.json').resolve()}\n",
        )

        with zipfile.ZipFile(io.BytesIO(self.canary)) as canary, zipfile.ZipFile(
                io.BytesIO(payload)) as webstore:
            self.assertEqual(canary.namelist(), webstore.namelist())
            for name in canary.namelist():
                if name == "manifest.json":
                    source_manifest = json.loads(canary.read(name))
                    store_manifest = json.loads(webstore.read(name))
                    self.assertEqual(source_manifest.pop("key"), "canary-key")
                    self.assertEqual(source_manifest, store_manifest)
                else:
                    self.assertEqual(canary.read(name), webstore.read(name))

        self.invoke(output)
        self.assertEqual(archive_path.read_bytes(), payload)

    def test_rejects_metadata_package_and_pointer_tampering(self):
        cases = [
            ("metadata", {
                "quicklogin/releases/0.4.9/release.json": json_bytes({**self.record, "sha256": "c" * 64}),
            }, "Canary pointer and immutable metadata differ"),
            ("package", {self.record["objectKey"]: self.canary[:-2] + b"xx"},
             "Package size or SHA-256 does not match release record"),
        ]
        for name, replacement, reason in cases:
            with self.subTest(name):
                self.objects = {
                    CHANNEL_KEY: json_bytes(self.record),
                    "quicklogin/releases/0.4.9/release.json": json_bytes(self.record),
                    self.record["objectKey"]: self.canary,
                }
                self.objects.update(replacement)
                output = self.root / name
                stderr = io.StringIO()
                with self.assertRaises(SystemExit) as failure:
                    with redirect_stderr(stderr):
                        self.invoke(output)
                self.assertEqual(failure.exception.code, 1)
                self.assertIn(reason, stderr.getvalue())
                self.assertFalse(output.exists())

    def test_rejects_pointer_race_before_writing(self):
        self.pointer_race = True
        output = self.root / "race"
        with self.assertRaises(SystemExit) as failure:
            self.invoke(output)
        self.assertEqual(failure.exception.code, 1)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
