#!/usr/bin/env python3
"""Run the dependency-light half of the test suite without pytest.

Why this exists: the full suite needs pytest, FastAPI, boto3 and bcrypt.  This
runner needs only what the inference pipeline itself needs -- numpy, OpenCV and
``cryptography`` -- so the core of the module can be verified on a machine, in a
container, or in a sandbox where the rest is not installed.

It is a safety net, not a replacement.  ``pytest`` remains the real gate and is
what CI runs.

    python scripts/verify_offline.py [-v]

Exit code 0 when everything passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import importlib
import inspect
import os
import shutil
import sys
import tempfile
import traceback
import types
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

#: Modules that need only numpy / OpenCV / cryptography / starlette / httpx.
OFFLINE_MODULES = [
    "tests.unit.test_fle",
    "tests.unit.test_hmac",
    "tests.unit.test_score",
    "tests.unit.test_calibration",
    "tests.unit.test_build_calibration",
    "tests.unit.test_preprocess",
    "tests.unit.test_quality",
    "tests.unit.test_keys",
    "tests.unit.test_keyproviders",
    "tests.unit.test_rotate_keys",
    "tests.unit.test_config",
    "tests.unit.test_services",
    "tests.unit.test_s3",
    "tests.unit.test_pin",
    "tests.unit.test_runtime",
    "tests.security.test_guards",
    "tests.security.test_headers_parity",
    "tests.security.test_lockout",
    "tests.security.test_stores",
    "tests.golden.test_golden_vector",
    "tests.contract.test_reason_codes",
    "tests.contract.test_route_inventory",
    "tests.memory.test_memory_ceiling",
    "tests.deploy.test_manifests",
    "tests.deploy.test_audit_gate",
    "tests.api.test_middleware",
]

#: Needs FastAPI, which this runner cannot substitute for. Covered by pytest.
REQUIRES_PYTEST = {
    "tests.api.test_routes": "fastapi",
    "tests.contract.test_openapi": "fastapi",
}


# --------------------------------------------------------------- pytest shim
class _Raises:
    def __init__(self, expected: type[BaseException] | tuple[type[BaseException], ...]) -> None:
        self.expected = expected
        self.value: BaseException | None = None

    def __enter__(self) -> _Raises:
        return self

    def __exit__(self, exc_type, exc, _tb) -> bool:
        if exc_type is None:
            names = getattr(self.expected, "__name__", str(self.expected))
            raise AssertionError(f"expected {names} but nothing was raised")
        if not issubclass(exc_type, self.expected):
            return False
        self.value = exc
        return True


class _Approx:
    def __init__(self, expected: float, rel: float | None = None, abs: float | None = None) -> None:
        self.expected = expected
        self.rel = rel
        self.abs = abs

    def _tolerance(self) -> float:
        if self.abs is not None:
            return self.abs
        if self.rel is not None:
            return abs(self.expected) * self.rel
        return max(1e-6, abs(self.expected) * 1e-6)

    def __eq__(self, other: object) -> bool:
        try:
            return abs(float(other) - float(self.expected)) <= self._tolerance()  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return NotImplemented

    def __repr__(self) -> str:
        return f"approx({self.expected})"


class _MonkeyPatch:
    def __init__(self) -> None:
        self._saved: list[tuple[str, str | None]] = []

    def setenv(self, name: str, value: str) -> None:
        self._saved.append((name, os.environ.get(name)))
        os.environ[name] = value

    def delenv(self, name: str, raising: bool = True) -> None:
        self._saved.append((name, os.environ.get(name)))
        os.environ.pop(name, None)

    def undo(self) -> None:
        for name, previous in reversed(self._saved):
            if previous is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = previous
        self._saved.clear()


def _install_pytest_shim() -> None:
    if "pytest" in sys.modules:
        return
    shim = types.ModuleType("pytest")
    shim.raises = _Raises  # type: ignore[attr-defined]
    shim.approx = _Approx  # type: ignore[attr-defined]
    shim.fixture = lambda *a, **k: (a[0] if a and callable(a[0]) else (lambda f: f))  # type: ignore[attr-defined]
    shim.skip = lambda *a, **k: None  # type: ignore[attr-defined]

    class _Mark:
        @staticmethod
        def parametrize(argnames, argvalues, **_kwargs):
            """A real implementation, not a no-op.

            A no-op decorator leaves the parameters as unfilled arguments, and
            the runner then reports "unsupported fixture 'name'" for a test that
            pytest runs perfectly well. Recording the cases here and expanding
            them in the runner keeps a parametrised test genuinely covered by
            the offline path rather than silently skipped.
            """
            names = [n.strip() for n in argnames.split(",")] if isinstance(argnames, str) else list(argnames)

            def decorate(fn):
                cases = getattr(fn, "_pnsm_params", [])
                for values in argvalues:
                    row = values if isinstance(values, (tuple, list)) else (values,)
                    if len(row) != len(names):
                        raise ValueError(
                            f"parametrize on {fn.__name__}: {len(names)} names, {len(row)} values"
                        )
                    cases.append(dict(zip(names, row, strict=True)))
                fn._pnsm_params = cases
                return fn

            return decorate

        def __getattr__(self, _name: str):
            return lambda *a, **k: (lambda f: f)

    shim.mark = _Mark()  # type: ignore[attr-defined]
    sys.modules["pytest"] = shim


def _install_bcrypt_stub() -> bool:
    """Substitute a behavioural model of bcrypt when the real one is absent.

    **This runs only in this offline runner.** ``pytest`` uses the real bcrypt,
    and CI installs it, so the production key-derivation path is always tested
    somewhere.

    The stub is faithful to the properties ``app.crypto.pin`` depends on -- a
    fresh random salt per call, a ``$2b$<cost>$<salt><digest>`` layout, the
    72-byte input truncation, and ``ValueError`` on a malformed hash -- so it
    exercises the peppering, the policy and the lockout wiring for real. It is
    emphatically **not** cryptographically equivalent: it wraps SHA-256, not
    Blowfish, and must never be used for anything but this runner.
    """
    import importlib.util

    if importlib.util.find_spec("bcrypt") is not None:
        return False

    import base64
    import hashlib
    import hmac as _hmac
    import os

    module = types.ModuleType("bcrypt")

    def _b64(raw: bytes, length: int) -> bytes:
        return base64.b64encode(raw)[:length].replace(b"+", b".").replace(b"=", b".")

    def gensalt(rounds: int = 12, prefix: bytes = b"2b") -> bytes:
        return b"$2b$" + f"{rounds:02d}".encode() + b"$" + _b64(os.urandom(16), 22)

    def hashpw(password: bytes, salt: bytes) -> bytes:
        if not isinstance(password, bytes) or not isinstance(salt, bytes):
            raise TypeError("Unicode-objects must be encoded before hashing")
        parts = salt.split(b"$")
        if len(parts) < 4 or len(parts[3]) < 22:
            raise ValueError("Invalid salt")
        cost = parts[2]
        seed = parts[3][:22]
        digest = hashlib.sha256(seed + password[:72]).digest()  # bcrypt truncates at 72
        return b"$2b$" + cost + b"$" + seed + _b64(digest, 31)

    def checkpw(password: bytes, hashed: bytes) -> bool:
        if not isinstance(password, bytes) or not isinstance(hashed, bytes):
            raise TypeError("Unicode-objects must be encoded before checking")
        parts = hashed.split(b"$")
        if len(parts) < 4 or len(parts[3]) < 22:
            raise ValueError("Invalid hash")
        salt = b"$2b$" + parts[2] + b"$" + parts[3][:22]
        return _hmac.compare_digest(hashpw(password, salt), hashed)

    module.gensalt = gensalt  # type: ignore[attr-defined]
    module.hashpw = hashpw  # type: ignore[attr-defined]
    module.checkpw = checkpw  # type: ignore[attr-defined]
    sys.modules["bcrypt"] = module
    return True


# ------------------------------------------------------------------- runner
def run(verbose: bool = False) -> int:
    _install_pytest_shim()
    stubbed_bcrypt = _install_bcrypt_stub()
    if stubbed_bcrypt:
        print(
            "note: bcrypt is not installed, so a behavioural stub is standing in for it.\n"
            "      The peppering, policy and lockout logic is genuinely exercised; the real\n"
            "      Blowfish key derivation is not. Run `pytest` for that.\n"
        )

    passed: list[str] = []
    failed: list[tuple[str, str]] = []

    for module_name in OFFLINE_MODULES:
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:
            failed.append((module_name, f"import failed: {exc!r}"))
            if verbose:
                traceback.print_exc()
            continue

        for name, fn in sorted(vars(module).items()):
            if not name.startswith("test_") or not callable(fn):
                continue
            # One entry per parametrised case, so a single failing case is
            # reported with the values that produced it rather than as a
            # whole-function failure.
            cases: list[dict[str, object]] = getattr(fn, "_pnsm_params", None) or [{}]
            for params in cases:
                suffix = (
                    "[" + "-".join(str(v) for v in params.values()) + "]" if params else ""
                )
                label = f"{module_name}::{name}{suffix}"
                temp_dir: str | None = None
                patcher = _MonkeyPatch()
                try:
                    kwargs: dict[str, object] = dict(params)
                    for parameter in inspect.signature(fn).parameters:
                        if parameter in kwargs:
                            continue
                        if parameter == "tmp_path":
                            temp_dir = tempfile.mkdtemp(prefix="pnsm-test-")
                            kwargs["tmp_path"] = Path(temp_dir)
                        elif parameter == "monkeypatch":
                            kwargs["monkeypatch"] = patcher
                        else:
                            raise RuntimeError(f"unsupported fixture {parameter!r}")
                    fn(**kwargs)
                    passed.append(label)
                    if verbose:
                        print(f"  PASS {label}")
                except Exception as exc:
                    failed.append((label, f"{type(exc).__name__}: {exc}"))
                    if verbose:
                        traceback.print_exc()
                finally:
                    patcher.undo()
                    if temp_dir:
                        shutil.rmtree(temp_dir, ignore_errors=True)

    print()
    print("=" * 68)
    print(f"offline verification: {len(passed)} passed, {len(failed)} failed")
    if stubbed_bcrypt:
        print("  bcrypt: behavioural stub (pytest uses the real one)")
    for module_name, reason in REQUIRES_PYTEST.items():
        print(f"  skipped (needs {reason}): {module_name}")
    if failed:
        print("-" * 68)
        for label, reason in failed:
            print(f"  FAIL {label}\n       {reason}")
    print("=" * 68)
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true")
    raise SystemExit(run(parser.parse_args().verbose))
