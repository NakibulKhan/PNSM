#!/usr/bin/env python3
"""Dependency blocklist.

The single most likely way this module fails in production is somebody running
``pip install deepface`` to "use the library the proposal mentions".  That pulls
TensorFlow (or PyTorch), which needs 1.2-2.5 GB on import and is killed by the
Linux OOM killer on the 1 GB Fargate task -- precisely the failure the source risk
matrix predicts.

Encoding the rule in the build is the only version of it that survives a
deadline. A comment in a README is not a control.

    python scripts/check_deps.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

#: Packages that make the container die inside its memory limit. Fatal wherever
#: they appear -- declared, installed, or imported.
FATAL = {
    "tensorflow": "1.2-2.5 GB on import; guaranteed OOM in a 1 GB task",
    "tensorflow-cpu": "same footprint as tensorflow",
    "torch": "800 MB+ on import; leaves nothing for the model in a 1 GB task",
    "torchvision": "pulls torch",
    "keras": "pulls tensorflow",
    "deepface": "pulls tensorflow or torch; use onnxruntime against exported weights",
    "insightface": "pulls onnxruntime plus heavy extras and downloads weights at runtime",
}

#: Packages that merely bloat the image. Fatal if *declared* as a runtime
#: dependency; ignored if merely present in a developer's environment, where a
#: shared interpreter may legitimately hold all sorts of things.
DISCOURAGED = {
    "opencv-python": "the GUI build; adds ~120 MB of X11 we never use. Use opencv-python-headless",
    "opencv-contrib-python": "same as opencv-python",
    "scikit-learn": "not needed at runtime; the calibration fit is plain numpy",
    "scipy": "not needed at runtime",
    "pandas": "not needed at runtime",
    "matplotlib": "development only; belongs in requirements-dev.txt",
}

BLOCKED = {**FATAL, **DISCOURAGED}

RUNTIME_FILES = ["requirements.txt", "requirements.lock"]


def parse_requirement(line: str) -> str | None:
    line = line.split("#", 1)[0].strip()
    if not line or line.startswith("-"):
        return None
    match = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)", line)
    return match.group(1).lower().replace("_", "-") if match else None


def check_declared() -> list[str]:
    problems: list[str] = []
    for filename in RUNTIME_FILES:
        path = REPO_ROOT / filename
        if not path.exists():
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            name = parse_requirement(line)
            if name and name in BLOCKED:
                problems.append(f"{filename}:{number}: {name} -- {BLOCKED[name]}")
    return problems


def check_installed() -> list[str]:
    """Catch a memory-killer that reached the environment without the file changing.

    Only :data:`FATAL` packages are checked here. A developer's interpreter may
    legitimately hold pandas or scipy for unrelated work; what matters is that
    they are not runtime dependencies of *this* service.
    """
    problems: list[str] = []
    try:
        from importlib.metadata import distributions
    except ImportError:  # pragma: no cover
        return problems
    for dist in distributions():
        name = (dist.metadata["Name"] or "").lower().replace("_", "-")
        if name in FATAL:
            problems.append(f"installed: {name} {dist.version} -- {FATAL[name]}")
    return problems


def check_imports() -> list[str]:
    """Catch a heavy framework that a module imports at runtime."""
    problems: list[str] = []
    forbidden = {"tensorflow", "torch", "keras", "deepface", "insightface"}
    for path in (REPO_ROOT / "app").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for name in forbidden:
            if re.search(rf"^\s*(import {name}|from {name}[. ])", text, re.MULTILINE):
                problems.append(f"{path.relative_to(REPO_ROOT)}: imports {name}")
    return problems


def main() -> int:
    problems = check_declared() + check_installed() + check_imports()
    if problems:
        print("Dependency blocklist violated:\n")
        for problem in problems:
            print(f"  {problem}")
        print(
            "\nInference runs through onnxruntime against exported .onnx weights "
            "(see app/ai/session.py). That is what keeps resident memory under "
            "300 MB inside a 1 GB task."
        )
        return 1
    print(f"Dependency blocklist clean ({len(BLOCKED)} packages checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
