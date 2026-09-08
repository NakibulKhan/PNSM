"""LivenessService as a use case, without an HTTP server.

Real, own-built active-illumination PAD signal (Item 3, Flawless/Ultra
blueprint) -- not ISO/IEC 30107-3 certified. These tests prove the underlying
color-correlation math behaves correctly on synthetic frames, not that it
passes certification (no such lab access exists here).
"""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

from app.errors import PnsmError
from app.services.liveness import LivenessService
from app.storage.s3 import InMemoryObjectStore
from tests.helpers import make_settings


def _solid_color_b64(rgb: tuple[int, int, int], size: int = 64) -> str:
    """A small solid-color JPEG, encoded exactly like the mobile client would send one."""
    r, g, b = rgb
    frame_bgr = np.full((size, size, 3), (b, g, r), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return base64.b64encode(bytes(buf.tobytes())).decode("ascii")


def _frame(color: str, rgb: tuple[int, int, int]) -> dict:
    return {"color": color, "image": {"kind": "base64", "value": _solid_color_b64(rgb)}}


@pytest.fixture()
def service() -> LivenessService:
    return LivenessService(InMemoryObjectStore(), make_settings())


class TestLivenessService:
    def test_frames_that_match_the_reported_flash_colors_pass(self, service: LivenessService) -> None:
        frames = [_frame("red", (255, 0, 0)), _frame("blue", (0, 0, 255))]
        result = service.execute(user_ref="alice", frames=frames)
        assert result["passed"] is True
        assert result["confidence"] > 90.0
        assert len(result["per_frame_scores"]) == 2

    def test_frames_with_no_correlation_to_the_reported_flash_fail(self, service: LivenessService) -> None:
        # A static grey frame (e.g. a printed photo under ambient light) does
        # not track the reported flash colors at all.
        frames = [_frame("red", (128, 128, 128)), _frame("blue", (128, 128, 128))]
        result = service.execute(user_ref="alice", frames=frames)
        assert result["passed"] is False
        assert result["confidence"] < 90.0

    def test_mixed_frames_land_between_the_two_extremes(self, service: LivenessService) -> None:
        matching = service.execute(user_ref="a", frames=[_frame("green", (0, 255, 0))])["confidence"]
        mismatching = service.execute(user_ref="a", frames=[_frame("green", (255, 0, 0))])["confidence"]
        assert matching > mismatching

    def test_an_undecodable_frame_raises_bad_request(self, service: LivenessService) -> None:
        frames = [{"color": "red", "image": {"kind": "base64", "value": base64.b64encode(b"not an image").decode()}}]
        with pytest.raises(PnsmError):
            service.execute(user_ref="alice", frames=frames)

    def test_the_pass_threshold_is_configurable(self) -> None:
        strict = LivenessService(InMemoryObjectStore(), make_settings(liveness_min_confidence=99.9))
        lenient = LivenessService(InMemoryObjectStore(), make_settings(liveness_min_confidence=1.0))
        frames = [_frame("white", (250, 245, 250))]  # close but not perfect
        assert strict.execute(user_ref="a", frames=frames)["passed"] is False
        assert lenient.execute(user_ref="a", frames=frames)["passed"] is True
