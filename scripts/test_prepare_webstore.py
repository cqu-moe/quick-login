import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch
import zipfile

import prepare_webstore
from release import CHANNEL_KEY, archive_directory, git, json_bytes


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
        rebuild = patch.object(prepare_webstore, "rebuild_canary", return_value=self.canary)
        rebuild.start()
        self.addCleanup(rebuild.stop)

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

    def test_rejects_coherent_r2_substitution_before_writing(self):
        for change in ("runtime", "extra", "missing", "commit"):
            with self.subTest(change=change):
                with zipfile.ZipFile(io.BytesIO(self.canary)) as archive:
                    files = {name: archive.read(name) for name in archive.namelist()}
                commit = COMMIT
                if change == "runtime":
                    files["background.js"] = b"/* attacker-controlled runtime */"
                elif change == "extra":
                    files["extra.js"] = b"/* additional runtime */"
                elif change == "missing":
                    del files["background.js"]
                else:
                    commit = "c" * 40
                    info = json.loads(files["build-info.json"])
                    files["build-info.json"] = json_bytes({**info, "sourceCommit": commit})
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, "w") as archive:
                    for name, content in files.items():
                        archive.writestr(name, content)
                payload = buffer.getvalue()
                record = {**self.record, "sourceCommit": commit, "size": len(payload),
                          "sha256": hashlib.sha256(payload).hexdigest()}
                self.objects = {
                    CHANNEL_KEY: json_bytes(record),
                    "quicklogin/releases/0.4.9/release.json": json_bytes(record),
                    record["objectKey"]: payload,
                }
                output = self.root / change
                stderr = io.StringIO()
                with redirect_stderr(stderr), self.assertRaises(SystemExit) as failure:
                    self.invoke(output)
                self.assertEqual(failure.exception.code, 1)
                self.assertIn("Canary ZIP differs from the trusted Git build", stderr.getvalue())
                self.assertFalse(output.exists())


class RebuildCanaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        original = Path(__file__).resolve().parent.parent
        git(original, "clone", "--quiet", "--shared", "--no-checkout", "--no-tags",
            "--", str(original), str(self.repo))
        self.commit = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "tag", "v0.0.1", self.commit)
        self.record = {"version": "0.0.1", "sourceCommit": self.commit}

    def test_rebuilds_the_tag_in_a_clean_checkout(self):
        run = subprocess.run

        def build(command, **kwargs):
            if command[0] != "npm":
                return run(command, **kwargs)
            source = kwargs["cwd"]
            self.assertNotEqual(source, self.repo)
            self.assertEqual(git(source, "rev-parse", "HEAD"), self.commit)
            if command == ["npm", "run", "build"]:
                (source / "dist").mkdir()
                (source / "dist/background.js").write_bytes(b"/* trusted build */")
            return subprocess.CompletedProcess(command, 0)

        with patch.object(prepare_webstore.subprocess, "run", side_effect=build):
            payload = prepare_webstore.rebuild_canary(self.repo, self.record, self.root)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            self.assertEqual(archive.namelist(), ["background.js"])
            self.assertEqual(archive.read("background.js"), b"/* trusted build */")

    def test_rejects_missing_tag_and_forged_commit_before_build(self):
        for record in ({**self.record, "version": "0.0.2"},
                       {**self.record, "sourceCommit": "c" * 40}):
            with self.subTest(record=record), self.assertRaises((ValueError, subprocess.CalledProcessError)):
                prepare_webstore.rebuild_canary(self.repo, record, self.root)
            self.assertFalse((self.root / "source").exists())

    def test_rejects_tag_outside_trusted_history_before_build(self):
        real_git = prepare_webstore.git

        def git_without_ancestry(root, *args):
            if args[0] == "merge-base":
                raise subprocess.CalledProcessError(1, ["git", *args])
            return real_git(root, *args)

        with patch.object(prepare_webstore, "git", side_effect=git_without_ancestry):
            with self.assertRaises(subprocess.CalledProcessError):
                prepare_webstore.rebuild_canary(self.repo, self.record, self.root)
        self.assertFalse((self.root / "source").exists())


if __name__ == "__main__":
    unittest.main()
