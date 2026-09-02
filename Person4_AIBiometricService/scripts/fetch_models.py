#!/usr/bin/env python3
"""Download the two ONNX models into ``models/``.

    python scripts/fetch_models.py
    python scripts/fetch_models.py --verify-only

Weights are **not** committed to git: 16 MB of binary in a repository is a
nuisance, and a checksum-verified download is auditable in a way a committed
blob is not. They *are* baked into the container image at build time, so a cold
start never depends on an external host being reachable.

Two models, both small enough that the image stays under its size gate:

* ``face_detection_yunet_2023mar.onnx`` (~233 KB) -- OpenCV's YuNet detector.
  Emits the five landmarks ArcFace alignment needs, with NMS handled inside
  OpenCV, so none of the anchor-decoding code that would otherwise be the most
  bug-prone part of this pipeline exists here.
* ``w600k_mbf.onnx`` (~13.6 MB) -- the ArcFace MobileFaceNet backbone from the
  InsightFace ``buffalo_s`` pack. 512-dimensional output.

If a download fails, fetch the files by hand from the URLs printed below, drop
them in ``models/``, and re-run with ``--verify-only``.
"""

from __future__ import annotations

import argparse
import hashlib
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = REPO_ROOT / "models"

MODELS = {
    "face_detection_yunet_2023mar.onnx": {
        "urls": [
            "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        ],
        "approx_bytes": 232_589,
        "purpose": "face detection + 5-point landmarks",
    },
    "w600k_mbf.onnx": {
        "urls": [
            "https://huggingface.co/deepghs/insightface/resolve/main/buffalo_s/w600k_mbf.onnx",
        ],
        "approx_bytes": 13_600_000,
        "purpose": "ArcFace 512-d recognition backbone",
    },
}

CHECKSUM_FILE = MODEL_DIR / "checksums.txt"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_checksums() -> dict[str, str]:
    if not CHECKSUM_FILE.exists():
        return {}
    entries: dict[str, str] = {}
    for line in CHECKSUM_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        digest, _, name = line.partition("  ")
        if digest and name:
            entries[name] = digest
    return entries


def write_checksums(entries: dict[str, str]) -> None:
    lines = [
        "# sha256 checksums for the ONNX weights, recorded on first download.",
        "# Commit this file. A mismatch on a later run means the upstream artifact",
        "# changed, which invalidates the calibration fitted against it.",
    ]
    lines += [f"{digest}  {name}" for name, digest in sorted(entries.items())]
    CHECKSUM_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def download(url: str, target: Path) -> None:
    print(f"    from {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "pnsm-ai-svc/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        target.write_bytes(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verify-only", action="store_true", help="check what is present, download nothing")
    parser.add_argument("--force", action="store_true", help="re-download even if the file exists")
    args = parser.parse_args()

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    recorded = load_checksums()
    failures: list[str] = []

    for name, spec in MODELS.items():
        target = MODEL_DIR / name
        print(f"\n{name}  ({spec['purpose']})")

        if target.exists() and not args.force:
            print(f"  present: {target.stat().st_size:,} bytes")
        elif args.verify_only:
            print("  MISSING (verify-only, not downloading)")
            failures.append(name)
            continue
        else:
            print("  downloading...")
            for url in spec["urls"]:
                try:
                    download(url, target)
                    break
                except Exception as exc:
                    print(f"    failed: {exc}")
            else:
                print(f"  COULD NOT DOWNLOAD. Fetch it manually into {MODEL_DIR} from:")
                for url in spec["urls"]:
                    print(f"    {url}")
                failures.append(name)
                continue

        digest = sha256(target)
        if name in recorded:
            if recorded[name] != digest:
                print(f"  CHECKSUM MISMATCH\n    expected {recorded[name]}\n    got      {digest}")
                print(
                    "  The upstream artifact changed. Do NOT keep using the existing calibration:\n"
                    "  a different model means a different score distribution. Re-fit, or restore\n"
                    "  the original weights."
                )
                failures.append(name)
                continue
            print(f"  checksum ok: {digest[:16]}...")
        else:
            recorded[name] = digest
            print(f"  checksum recorded: {digest[:16]}...")

    write_checksums(recorded)

    if failures:
        print(f"\nIncomplete: {', '.join(failures)}")
        print("The service will refuse to start without the recognition model.")
        print("For tests only, set PNSM_ALLOW_STUB_MODELS=true to use the deterministic stub.")
        return 1

    print(f"\nAll models present in {MODEL_DIR}")
    print(f"Checksums in {CHECKSUM_FILE.relative_to(REPO_ROOT)} -- commit that file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
