#!/usr/bin/env python3
"""Package built runtime files for Chrome Web Store without the canary key."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

from release import (archive_directory, git, json_bytes, version_tuple,
                     verify_directory_archive, write_immutable)


def build_webstore_payload(canary_payload, expected_commit):
    with zipfile.ZipFile(io.BytesIO(canary_payload)) as source:
        if source.testzip() is not None:
            raise ValueError("Canary ZIP CRC check failed")
        manifest = json.loads(source.read("manifest.json"))
        info = json.loads(source.read("build-info.json"))
        version = manifest["version"]
        version_tuple(version)
        if (manifest.get("manifest_version") != 3
                or info["extensionVersion"] != version
                or info["sourceCommit"] != expected_commit):
            raise ValueError("Invalid build provenance")
        manifest.pop("key", None)
        for size, name in manifest["icons"].items():
            image = source.read(name)
            if (image[:8] != b"\x89PNG\r\n\x1a\n" or
                    int.from_bytes(image[16:20], "big") != int(size) or
                    int.from_bytes(image[20:24], "big") != int(size)):
                raise ValueError(f"Invalid icon dimensions: {name}")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(source.namelist()):
                if name.endswith("/"):
                    continue
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                content = json_bytes(manifest) if name == "manifest.json" else source.read(name)
                archive.writestr(entry, content, compresslevel=9)
    data = output.getvalue()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.testzip() is not None or "key" in json.loads(archive.read("manifest.json")):
            raise ValueError("Invalid store archive")

    filename = f"cqu-quicklogin-{version}-webstore.zip"
    record = {"version": version, "filename": filename, "sourceCommit": info["sourceCommit"],
              "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
              "canaryKeyRemoved": True}
    return data, record


def write_webstore(canary_payload, output, expected_commit):
    data, record = build_webstore_payload(canary_payload, expected_commit)
    target = output / record["sourceCommit"]
    target.mkdir(parents=True, exist_ok=True)
    filename = record["filename"]
    write_immutable(target / filename, data)
    write_immutable(target / "package.json", json_bytes(record))
    return {**record, "path": str(target / filename)}


def build_webstore(repo, output):
    if git(repo, "status", "--porcelain"):
        raise ValueError("Commit source changes before packaging")
    subprocess.run(["npm", "run", "check:package"], cwd=repo, check=True)
    dist = repo / "dist"
    payload = archive_directory(dist)
    verify_directory_archive(payload, dist)
    return write_webstore(payload, output, git(repo, "rev-parse", "HEAD"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("releases/webstore"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    print(json.dumps(build_webstore(root, args.output.resolve()), ensure_ascii=False))
