#!/usr/bin/env python3
"""Prepare a Chrome Web Store package from the published Canary release."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse
import zipfile

from release import CHANNEL_KEY, s3_get, validate_record, verify_package


_spec = importlib.util.spec_from_file_location(
    "package_webstore", Path(__file__).with_name("package-webstore.py")
)
_package_webstore = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_package_webstore)
write_webstore = _package_webstore.write_webstore


def prepare_webstore(bucket, endpoint, output):
    with tempfile.TemporaryDirectory(prefix="quicklogin-webstore-") as temporary:
        directory = Path(temporary)
        pointer = directory / "current.json"
        if s3_get(bucket, endpoint, CHANNEL_KEY, pointer) is None:
            raise ValueError("Canary channel pointer is missing")
        record = validate_record(json.loads(pointer.read_text()))

        metadata = directory / "release.json"
        metadata_key = f"quicklogin/releases/{record['version']}/release.json"
        if s3_get(bucket, endpoint, metadata_key, metadata) is None:
            raise ValueError("Immutable Canary metadata is missing")
        if validate_record(json.loads(metadata.read_text())) != record:
            raise ValueError("Canary pointer and immutable metadata differ")

        archive = directory / "canary.zip"
        if s3_get(bucket, endpoint, record["objectKey"], archive,
                  expected_sha256=record["sha256"]) is None:
            raise ValueError("Published Canary package is missing")
        canary_payload = archive.read_bytes()
        verify_package(record, canary_payload)

        checked_pointer = directory / "checked.json"
        if (s3_get(bucket, endpoint, CHANNEL_KEY, checked_pointer) is None
                or checked_pointer.read_bytes() != pointer.read_bytes()):
            raise ValueError("Canary pointer changed during preparation; rerun for the latest version")

        result = write_webstore(canary_payload, output, record["sourceCommit"])
        result["path"] = str(Path(result["path"]).with_name("package.json"))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--output", type=Path, default=Path("releases/webstore"))
    args = parser.parse_args()

    endpoint = urlparse(args.endpoint)
    if (endpoint.scheme != "https" or not re.fullmatch(r"[a-f0-9]{32}\.r2\.cloudflarestorage\.com", endpoint.netloc)
            or endpoint.path not in ("", "/") or endpoint.query or endpoint.fragment):
        parser.error("Endpoint must be the HTTPS Cloudflare R2 S3 account endpoint")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", args.bucket):
        parser.error("Invalid bucket name")

    try:
        result = prepare_webstore(args.bucket, args.endpoint, args.output.resolve())
    except (KeyError, OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"{error}\n")

    print(json.dumps(result, ensure_ascii=False))
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a") as workflow_output:
            workflow_output.write(
                f"version={result['version']}\n"
                f"source_commit={result['sourceCommit']}\n"
                f"record={result['path']}\n"
            )


if __name__ == "__main__":
    main()
