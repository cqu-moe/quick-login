#!/usr/bin/env python3
"""Package built runtime files for Chrome Web Store without the canary key."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

from release import git, json_bytes, version_tuple, write_immutable


def build_webstore(repo, output):
    if git(repo, "status", "--porcelain"):
        raise ValueError("Commit source changes before packaging")
    subprocess.run(["npm", "run", "check:package"], cwd=repo, check=True)
    dist = repo / "dist"
    manifest = json.loads((dist / "manifest.json").read_text())
    info = json.loads((dist / "build-info.json").read_text())
    version = manifest["version"]
    version_tuple(version)
    if info["sourceCommit"] != git(repo, "rev-parse", "HEAD"):
        raise ValueError("Build does not belong to current HEAD")
    manifest.pop("key", None)
    for size, name in manifest["icons"].items():
        image = (dist / name).read_bytes()
        if (image[:8] != b"\x89PNG\r\n\x1a\n" or
                int.from_bytes(image[16:20], "big") != int(size) or
                int.from_bytes(image[20:24], "big") != int(size)):
            raise ValueError(f"Invalid icon dimensions: {name}")
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(dist.rglob("*")):
            if path.is_symlink():
                raise ValueError("Symlinks are not allowed")
            if not path.is_file():
                continue
            name = path.relative_to(dist).as_posix()
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            content = json_bytes(manifest) if name == "manifest.json" else path.read_bytes()
            archive.writestr(entry, content, compresslevel=9)
    data = payload.getvalue()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.testzip() is not None or "key" in json.loads(archive.read("manifest.json")):
            raise ValueError("Invalid store archive")
    target = output / info["sourceCommit"]
    target.mkdir(parents=True, exist_ok=True)
    filename = f"cqu-quicklogin-{version}-webstore.zip"
    record = {"version": version, "filename": filename, "sourceCommit": info["sourceCommit"],
              "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
              "canaryKeyRemoved": True}
    write_immutable(target / filename, data)
    write_immutable(target / "package.json", json_bytes(record))
    return {**record, "path": str(target / filename)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("releases/webstore"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    print(json.dumps(build_webstore(root, args.output.resolve()), ensure_ascii=False))
