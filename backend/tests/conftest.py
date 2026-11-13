import sys
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.detector import Detection  # noqa: E402

# A ~880 m x 800 m area in Dubai, north-up.
TL = (25.2048, 55.2708)
BR = (25.1972, 55.2796)
CORNERS = [TL, (TL[0], BR[1]), BR, (BR[0], TL[1])]


class FakeDetector:
    """Deterministic stand-in for YOLO: finds bright rectangles on a dark image."""

    def __init__(self) -> None:
        self.calls = 0

    def detect(self, image_bgr: np.ndarray, confidence: Optional[float] = None) -> List[Detection]:
        self.calls += 1
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            label = "small vehicle" if w * h < 2000 else "storage tank"
            conf = 0.9
            if confidence is not None and conf < confidence:
                continue
            out.append(Detection(label, conf, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]))
        return out

    def info(self):
        return {"weights": "fake", "loaded": True, "task": "detect", "classes": ["small vehicle", "storage tank"], "error": None}


def make_test_image(width=400, height=300, boxes=((50, 40, 30, 20), (200, 150, 80, 60))):
    img = np.zeros((height, width, 3), dtype=np.uint8)
    for x, y, w, h in boxes:
        img[y : y + h, x : x + w] = 255
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


@pytest.fixture
def fake_detector():
    return FakeDetector()
