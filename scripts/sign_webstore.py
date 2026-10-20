#!/usr/bin/env python3
"""Sign a prepared Chrome Web Store package as a verified CRX3 upload."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import tempfile
from pathlib import PurePosixPath
from typing import Dict, Iterable, List, Tuple
import zipfile
from io import BytesIO

from release import json_bytes, version_tuple, write_immutable


VERSION_RE = re.compile(r"[a-f0-9]{40}")
MAX_CRX_HEADER = 16 * 1024 * 1024
MAX_ZIP_ENTRIES = 4096
MAX_ZIP_BYTES = 256 * 1024 * 1024
SIGNED_DATA_PREFIX = b"CRX3 SignedData\0"


def _protobuf_fields(payload: bytes) -> Iterable[Tuple[int, bytes]]:
    offset = 0
    while offset < len(payload):
        key = 0
        shift = 0
        while True:
            if offset >= len(payload):
                raise ValueError("Truncated protobuf key")
            byte = payload[offset]
            offset += 1
            key |= (byte & 127) << shift
            if byte < 128:
                break
            shift += 7
            if shift > 63:
                raise ValueError("Invalid protobuf key")
        number, wire_type = key >> 3, key & 7
        if not number or wire_type != 2:
            raise ValueError("Unsupported protobuf field")
        length = 0
        shift = 0
        while True:
            if offset >= len(payload):
                raise ValueError("Truncated protobuf length")
            byte = payload[offset]
            offset += 1
            length |= (byte & 127) << shift
            if byte < 128:
                break
            shift += 7
            if shift > 63:
                raise ValueError("Invalid protobuf length")
        if shift > 63 or length > len(payload) - offset:
            raise ValueError("Invalid protobuf length")
        yield number, payload[offset:offset + length]
        offset += length


def _openssl(*arguments: str, input_data: bytes | None = None) -> bytes:
    result = subprocess.run(["openssl", *arguments], input=input_data, capture_output=True)
    if result.returncode:
        raise RuntimeError("OpenSSL CRX operation failed")
    return result.stdout


def read_verified_crx(payload: bytes, expected_key_sha256: str) -> bytes:
    """Return the ZIP archive only after a bounded CRX3 signature check."""
    if (not isinstance(expected_key_sha256, str)
            or not re.fullmatch(r"[a-f0-9]{64}", expected_key_sha256)):
        raise ValueError("Invalid upload key SHA-256")
    if len(payload) < 16 or payload[:4] != b"Cr24":
        raise ValueError("Not a CRX file")
    version, header_size = struct.unpack_from("<II", payload, 4)
    if version != 3 or not header_size or header_size > MAX_CRX_HEADER:
        raise ValueError("Unsupported CRX header")
    header_end = 12 + header_size
    if len(payload) < header_end:
        raise ValueError("Truncated CRX header")
    header = payload[12:header_end]
    archive = payload[header_end:]

    proofs: List[Tuple[bytes, bytes]] = []
    signed_data = None
    for number, content in _protobuf_fields(header):
        if number == 2:
            key = signature = b""
            for proof_number, proof_content in _protobuf_fields(content):
                if proof_number == 1:
                    key = proof_content
                elif proof_number == 2:
                    signature = proof_content
            if not key or not signature:
                raise ValueError("Incomplete CRX proof")
            proofs.append((key, signature))
        elif number == 10000:
            if signed_data is not None:
                raise ValueError("Duplicate CRX signed data")
            signed_data = content
    if signed_data is None:
        raise ValueError("Missing CRX signed data")

    signed_fields = list(_protobuf_fields(signed_data))
    if (len(signed_fields) != 1 or signed_fields[0][0] != 1
            or len(signed_fields[0][1]) != 16):
        raise ValueError("Invalid CRX signed data")
    signed_value = (SIGNED_DATA_PREFIX + len(signed_data).to_bytes(4, "little")
                    + signed_data + archive)
    for key, signature in proofs:
        if hashlib.sha256(key).hexdigest() != expected_key_sha256:
            continue
        if signed_fields[0][1] != hashlib.sha256(key).digest()[:16]:
            raise ValueError("CRX ID does not match upload key")
        with tempfile.TemporaryDirectory(prefix="quicklogin-crx-verify-") as temporary:
            directory = Path(temporary)
            public_key = directory / "public-key.pem"
            signature_path = directory / "signature.bin"
            data_path = directory / "signed-data.bin"
            public_key.write_bytes(_openssl(
                "pkey", "-pubin", "-inform", "DER", "-outform", "PEM", input_data=key
            ))
            signature_path.write_bytes(signature)
            data_path.write_bytes(signed_value)
            try:
                _openssl("dgst", "-sha256", "-verify", str(public_key),
                         "-signature", str(signature_path), str(data_path))
            except RuntimeError:
                continue
        return archive
    raise ValueError("No valid signature for the expected upload key")


def _zip_files(payload: bytes) -> Dict[str, bytes]:
    files: Dict[str, bytes] = {}
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        entries = archive.infolist()
        if (len(entries) > MAX_ZIP_ENTRIES
                or sum(info.file_size for info in entries) > MAX_ZIP_BYTES):
            raise ValueError("ZIP exceeds signing bounds")
        if archive.testzip() is not None:
            raise ValueError("ZIP CRC check failed")
        for info in archive.infolist():
            name = info.filename
            path = PurePosixPath(name)
            if (name.endswith("/") or not path.parts or path.is_absolute()
                    or ".." in path.parts or "\\" in name or name in files):
                raise ValueError("Invalid ZIP entry")
            if info.create_system == 3 and stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError("ZIP symlink is not allowed")
            files[name] = archive.read(info)
    return files


def _validate_prepared(record_path: Path) -> Tuple[dict, bytes]:
    record = json.loads(record_path.read_text())
    version = record.get("version")
    version_tuple(version)
    if (record.get("filename") != f"cqu-quicklogin-{version}-webstore.zip"
            or record.get("sourceCommit") != record_path.parent.name
            or not re.fullmatch(VERSION_RE, str(record.get("sourceCommit")))
            or type(record.get("size")) is not int or record["size"] <= 0
            or not re.fullmatch(r"[a-f0-9]{64}", str(record.get("sha256")))
            or record.get("canaryKeyRemoved") is not True):
        raise ValueError("Invalid prepared package record")

    payload = (record_path.parent / record["filename"]).read_bytes()
    if len(payload) != record["size"] or hashlib.sha256(payload).hexdigest() != record["sha256"]:
        raise ValueError("Prepared ZIP size or SHA-256 differs")
    files = _zip_files(payload)
    manifest = json.loads(files["manifest.json"])
    info = json.loads(files["build-info.json"])
    if ("key" in manifest or manifest.get("version") != version
            or info.get("extensionVersion") != version
            or info.get("sourceCommit") != record["sourceCommit"]):
        raise ValueError("Prepared ZIP identity differs")
    return record, payload


def _write_private_key(directory: Path, private_key: bytes) -> Path:
    path = directory / "upload-key.pem"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(private_key)
        if not private_key.endswith(b"\n"):
            output.write(b"\n")
    return path


def _chrome_command() -> List[str]:
    if sys.platform == "linux":
        return ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x720x24", "google-chrome"]
    if sys.platform == "darwin":
        return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    raise RuntimeError("Chrome CRX signing requires Linux or macOS")


def _pack_extension(root: Path, key_path: Path) -> bytes:
    output = root.with_suffix(".crx")
    profile = root.parent / "chrome-profile"
    result = subprocess.run([
        *_chrome_command(), f"--user-data-dir={profile}", f"--pack-extension={root}",
        f"--pack-extension-key={key_path}",
    ], capture_output=True)
    if result.returncode or not output.is_file():
        raise RuntimeError("Chrome did not produce a signed CRX")
    return output.read_bytes()


def sign_archive(record_path: Path) -> dict:
    record, source = _validate_prepared(record_path.resolve())
    expected_digest = os.environ.get("CWS_UPLOAD_KEY_SHA256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", expected_digest):
        raise ValueError("Invalid CWS_UPLOAD_KEY_SHA256")
    private_key = os.environ.get("CWS_UPLOAD_PRIVATE_KEY", "").encode()
    if b"PRIVATE KEY" not in private_key:
        raise ValueError("CWS_UPLOAD_PRIVATE_KEY is missing")

    with tempfile.TemporaryDirectory(prefix="quicklogin-crx-") as temporary:
        directory = Path(temporary)
        key_path = _write_private_key(directory, private_key)
        public_key = _openssl("pkey", "-in", str(key_path), "-pubout", "-outform", "DER")
        key_text = _openssl("pkey", "-pubin", "-inform", "DER", "-text", "-noout",
                            input_data=public_key)
        match = re.search(rb"Public-Key: \((\d+) bit\)", key_text)
        if b"Modulus:" not in key_text or not match or int(match.group(1)) < 2048:
            raise ValueError("Upload signing key must be RSA-2048 or stronger")
        digest = hashlib.sha256(public_key).hexdigest()
        if digest != expected_digest:
            raise ValueError("CWS_UPLOAD_KEY_SHA256 does not match private key")
        extension = directory / "extension"
        extension.mkdir()
        for name, content in _zip_files(source).items():
            destination = extension / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        crx = _pack_extension(extension, key_path)
        signed_archive = read_verified_crx(crx, digest)
        if _zip_files(signed_archive) != _zip_files(source):
            raise ValueError("CRX ZIP contents differ from prepared package")

        filename = f"cqu-quicklogin-{record['version']}-webstore.crx"
        result = {
            "version": record["version"], "sourceCommit": record["sourceCommit"],
            "canaryKeyRemoved": True, "filename": filename, "size": len(crx),
            "sha256": hashlib.sha256(crx).hexdigest(), "uploadKeySha256": digest,
        }
        write_immutable(record_path.parent / filename, crx)
        write_immutable(record_path.parent / "signed-package.json", json_bytes(result))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = sign_archive(args.record)
    except (KeyError, OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
