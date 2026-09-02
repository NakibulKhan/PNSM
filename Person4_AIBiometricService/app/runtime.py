"""Composition root.

Everything the service needs is built here, once, and handed to the routers.
Keeping construction in one place means the FastAPI layer stays a thin adapter
and the whole application can be assembled inside a test without an HTTP
server.

Reference: blueprint section 02.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

from app.ai.calibration import Calibration, CalibrationError, load_calibration
from app.ai.detect import build_detector
from app.ai.engine import FaceEngine
from app.ai.preprocess import DEFAULT_PREPROCESS, PreprocessConfig
from app.ai.session import build_embedder
from app.config import Settings, get_settings
from app.crypto.keyproviders import KeyProvider, build_key_provider
from app.security.guards import SecurityGuards
from app.security.headers import describe_policy
from app.security.lockout import LockoutPolicy
from app.services.enroll import EnrollService
from app.services.pin_service import PinService
from app.services.presign import PresignService
from app.services.verify import VerifyService
from app.storage.s3 import build_object_store

log = logging.getLogger(__name__)


def _check_preprocess_fingerprint(calibration: Calibration, cfg: PreprocessConfig) -> None:
    """Refuse to run a calibration that was fitted on a different pipeline.

    This is the structural guard against the highest-likelihood silent failure
    in the module: a preprocessing tweak that shifts every score by a few
    points without raising anything, quietly invalidating the fitted mapping.
    """
    recorded = (calibration.measured or {}).get("preprocess_fingerprint")
    if recorded is None:
        log.warning(
            "calibration %s carries no preprocess fingerprint; cannot verify that it was "
            "fitted on the current pipeline. Refit with build_calibration.py to close this gap.",
            calibration.calibration_version,
        )
        return
    current = cfg.fingerprint()
    if recorded != current:
        raise CalibrationError(
            f"Calibration {calibration.calibration_version!r} was fitted with preprocessing "
            f"fingerprint {recorded} but this build uses {current}. The mapping from cosine to "
            "confidence is no longer valid. Refit with `python calibration/build_calibration.py`."
        )


class Runtime:
    """Long-lived application state."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.started_at = time.monotonic()
        self.preprocess = DEFAULT_PREPROCESS
        self._calibration_lock = threading.Lock()

        self.warnings = self.settings.validate_startup()
        for warning in self.warnings:
            log.warning("startup: %s", warning)

        self._calibration = self._load_calibration()

        detector = build_detector(
            self.settings.det_model_path, allow_stub=self.settings.allow_stub_models
        )
        embedder = build_embedder(
            self.settings.rec_model_path,
            self.settings.model_version,
            allow_stub=self.settings.allow_stub_models,
        )
        self.engine = FaceEngine(detector, embedder, self.settings, self.preprocess)

        _check_preprocess_fingerprint(self._calibration, self.preprocess)

        # Built before the services so a misconfigured CMK fails at boot, not
        # at the first enrolment.
        self.key_provider: KeyProvider = build_key_provider(self.settings)
        self.store = build_object_store(self.settings)
        self.guards = SecurityGuards(
            max_clock_skew_s=self.settings.max_clock_skew_s,
            nonce_ttl_s=self.settings.nonce_ttl_s,
            image_replay_window=self.settings.image_replay_window,
            rate_limit_per_min=self.settings.verify_rate_limit_per_min,
        )
        self.lockout = LockoutPolicy(
            max_attempts=self.settings.pin_max_attempts,
            lockout_seconds=self.settings.pin_lockout_seconds,
        )

        self.enroll_service = EnrollService(
            self.engine, self.store, self.settings, self.key_provider
        )
        self.verify_service = VerifyService(
            self.engine,
            self.store,
            self.guards,
            self.settings,
            self.calibration,
            self.key_provider,
        )
        self.pin_service = PinService(self.settings, self.lockout)
        self.presign_service = PresignService(self.store, self.settings)

        self.warm = False
        self.warmup_info: dict[str, Any] = {}

    # ------------------------------------------------------------ calibration
    def _load_calibration(self, path: Path | None = None) -> Calibration:
        return load_calibration(
            path or self.settings.calibration_path,
            approve_override=self.settings.approve_threshold,
            flag_override=self.settings.flag_threshold,
            # The engine may not exist yet on first load, so the model check is
            # made against the configured version rather than the loaded one.
            expected_model_version=(
                None if self.settings.allow_stub_models else self.settings.model_version
            ),
        )

    def calibration(self) -> Calibration:
        """Current calibration. Read under a lock so a hot reload is atomic."""
        with self._calibration_lock:
            return self._calibration

    def reload_calibration(self) -> dict[str, Any]:
        """Re-read the calibration file without restarting.

        Lets a threshold be corrected live during a demo instead of requiring a
        redeploy and another cold start.
        """
        fresh = self._load_calibration()
        _check_preprocess_fingerprint(fresh, self.preprocess)
        with self._calibration_lock:
            previous = self._calibration.calibration_version
            self._calibration = fresh
        log.info("calibration reloaded %s -> %s", previous, fresh.calibration_version)
        return {"reloaded": True, "previous": previous, "current": fresh.summary()}

    # ---------------------------------------------------------------- warmup
    def warmup(self) -> dict[str, Any]:
        if not self.settings.warmup_on_start:
            self.warm = True
            self.warmup_info = {"warm": True, "skipped": True}
            return self.warmup_info
        try:
            self.warmup_info = self.engine.warmup()
            self.warm = True
        except Exception as exc:  # a failed warmup must not stop the service
            log.error("warmup failed: %s", exc)
            self.warmup_info = {"warm": False, "error": str(exc)}
            self.warm = False
        return self.warmup_info

    @property
    def uptime_s(self) -> float:
        return time.monotonic() - self.started_at

    def health(self) -> dict[str, Any]:
        """Deliberately cheap: no model call, no network.

        The ECS health check hits this every 30 seconds and an external uptime
        monitor every few minutes. If the probe cost inference time it would
        compete with the check-ins it exists to protect.
        """
        return {
            "status": "ok",
            "version": self.settings.service_version,
            "uptime_s": round(self.uptime_s, 1),
        }

    def storage_posture(self) -> dict[str, Any]:
        """Bucket encryption and public-access state.

        Checked here rather than assumed: a default-encryption rule that was
        quietly removed looks identical to one that is in place, right up
        until somebody reads the objects.
        """
        verify_encryption = getattr(self.store, "verify_bucket_encryption", None)
        verify_public = getattr(self.store, "verify_public_access_blocked", None)
        if verify_encryption is None or verify_public is None:
            return {"checked": False}
        try:
            return {
                "checked": True,
                "encryption": verify_encryption(),
                "public_access": verify_public(),
            }
        except Exception as exc:  # posture reporting must never break readiness
            return {"checked": False, "error": str(exc)}

    def ready(self) -> dict[str, Any]:
        calibration = self.calibration()
        return {
            "status": "ready" if self.warm else "starting",
            "model_version": self.engine.model_version,
            "calibration_version": calibration.calibration_version,
            "preprocess_fingerprint": self.preprocess.fingerprint(),
            "storage": "ok",
            "warm": self.warm,
            "thresholds": calibration.summary(),
            "warnings": self.warnings,
            "security": {
                "key_provider": self.key_provider.name,
                "kms_key_id": self.settings.kms_key_id or None,
                "decision_bands": self.settings.decision_bands,
                "auth_required": self.settings.auth_required,
                "headers": describe_policy(
                    self.settings.csp_policy, self.settings.hsts_max_age_s
                )
                if self.settings.security_headers_enabled
                else {"enabled": "false"},
            },
            "aws": {
                "region": self.settings.aws_region,
                "bucket": self.settings.s3_bucket,
                "endpoint": self.settings.s3_endpoint or "aws-default",
                "posture": self.storage_posture(),
            },
        }
