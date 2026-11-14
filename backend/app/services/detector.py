"""Object detectors.

`Detector` is the small interface the pipeline depends on. `YoloDetector` implements it
with Ultralytics YOLO (v8 / v11, axis-aligned or oriented boxes) plus sliced inference
for large frames. The model is loaded lazily on first use so the API starts instantly.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Protocol, Sequence

import numpy as np

from app.services.tiling import class_aware_nms, make_tiles

log = logging.getLogger("geopulse.detector")


@dataclass
class Detection:
    label: str
    confidence: float
    polygon: List[List[float]]  # pixel-space [[x, y], ...] (4 points, clockwise from top-left)
    class_id: int = -1
    oriented: bool = False

    @property
    def bbox(self) -> List[float]:
        pts = np.asarray(self.polygon, dtype=np.float64)
        return [float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max())]

    @property
    def center(self) -> List[float]:
        pts = np.asarray(self.polygon, dtype=np.float64)
        return [float(pts[:, 0].mean()), float(pts[:, 1].mean())]


class Detector(Protocol):
    def detect(self, image_bgr: np.ndarray, confidence: Optional[float] = None) -> List[Detection]: ...

    def info(self) -> Dict: ...


def _box_polygon(x1: float, y1: float, x2: float, y2: float) -> List[List[float]]:
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


class YoloDetector:
    def __init__(
        self,
        weights: str,
        confidence: float = 0.25,
        iou: float = 0.45,
        tile_size: int = 1024,
        tile_overlap: float = 0.2,
        device: str = "",
        batch_size: int = 4,
    ) -> None:
        self.weights = weights
        self.confidence = confidence
        self.iou = iou
        self.tile_size = tile_size
        self.tile_overlap = tile_overlap
        self.device = device
        self.batch_size = batch_size
        self._model = None
        self._load_error: Optional[str] = None
        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()  # one inference at a time per model

    # ----------------------------------------------------------------- loading
    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is None:
                try:
                    from ultralytics import YOLO
                except ImportError as exc:
                    self._load_error = "ultralytics is not installed (pip install -r requirements.txt)."
                    raise RuntimeError(self._load_error) from exc
                log.info("Loading model %s (downloads on first use if missing)", self.weights)
                try:
                    from pathlib import Path

                    Path(self.weights).parent.mkdir(parents=True, exist_ok=True)
                    self._model = YOLO(self.weights)
                    self._load_error = None
                except Exception as exc:
                    self._load_error = f"Failed to load model '{self.weights}': {exc}"
                    raise RuntimeError(self._load_error) from exc
        return self._model

    @property
    def task(self) -> Optional[str]:
        return getattr(self._model, "task", None) if self._model is not None else None

    @property
    def class_names(self) -> Dict[int, str]:
        return dict(self._model.names) if self._model is not None else {}

    def info(self) -> Dict:
        return {
            "weights": self.weights,
            "loaded": self.loaded,
            "task": self.task,
            "classes": list(self.class_names.values()),
            "confidence": self.confidence,
            "iou": self.iou,
            "tile_size": self.tile_size,
            "tile_overlap": self.tile_overlap,
            "error": self._load_error,
        }

    # --------------------------------------------------------------- inference
    def _parse_result(self, result, offset_x: int, offset_y: int):
        """Turn one Ultralytics Results object into (polygons, scores, class_ids, oriented)."""
        obb = getattr(result, "obb", None)
        if obb is not None and len(obb):
            polys = obb.xyxyxyxy.cpu().numpy().astype(np.float64)  # (N, 4, 2)
            scores = obb.conf.cpu().numpy().astype(np.float64)
            classes = obb.cls.cpu().numpy().astype(np.int64)
            oriented = True
        elif result.boxes is not None and len(result.boxes):
            xyxy = result.boxes.xyxy.cpu().numpy().astype(np.float64)
            polys = np.stack([np.array(_box_polygon(*b)) for b in xyxy])
            scores = result.boxes.conf.cpu().numpy().astype(np.float64)
            classes = result.boxes.cls.cpu().numpy().astype(np.int64)
            oriented = False
        else:
            return None
        polys[:, :, 0] += offset_x
        polys[:, :, 1] += offset_y
        return polys, scores, classes, oriented

    def _predict(self, images: Sequence[np.ndarray], conf: float, imgsz: int):
        kwargs = dict(conf=conf, iou=self.iou, imgsz=imgsz, verbose=False)
        if self.device:
            kwargs["device"] = self.device
        return self._model.predict(list(images), **kwargs)

    def detect(self, image_bgr: np.ndarray, confidence: Optional[float] = None) -> List[Detection]:
        self.load()
        conf = self.confidence if confidence is None else float(confidence)
        h, w = image_bgr.shape[:2]

        # Small frames: a single pass is enough. Large frames: sliced inference.
        if max(w, h) <= int(self.tile_size * 1.25):
            tiles = [(0, 0, w, h)]
            imgsz = max(32, min(self.tile_size, int(np.ceil(max(w, h) / 32) * 32)))
        else:
            tiles = make_tiles(w, h, self.tile_size, self.tile_overlap)
            imgsz = self.tile_size

        all_polys, all_scores, all_classes = [], [], []
        oriented = False
        with self._infer_lock:
            for start in range(0, len(tiles), self.batch_size):
                chunk = tiles[start : start + self.batch_size]
                crops = [image_bgr[y0:y1, x0:x1] for x0, y0, x1, y1 in chunk]
                for (x0, y0, _, _), result in zip(chunk, self._predict(crops, conf, imgsz)):
                    parsed = self._parse_result(result, x0, y0)
                    if parsed is None:
                        continue
                    polys, scores, classes, is_obb = parsed
                    oriented = oriented or is_obb
                    all_polys.append(polys)
                    all_scores.append(scores)
                    all_classes.append(classes)

        if not all_polys:
            return []
        polys = np.concatenate(all_polys)
        scores = np.concatenate(all_scores)
        classes = np.concatenate(all_classes)

        if len(tiles) > 1:  # merge duplicates from overlapping tiles
            envelopes = np.stack(
                [polys[:, :, 0].min(1), polys[:, :, 1].min(1), polys[:, :, 0].max(1), polys[:, :, 1].max(1)], axis=1
            )
            keep = class_aware_nms(envelopes, scores, classes, self.iou)
        else:
            keep = np.argsort(-scores, kind="stable")

        names = self.class_names
        polys[:, :, 0] = np.clip(polys[:, :, 0], 0, w)
        polys[:, :, 1] = np.clip(polys[:, :, 1], 0, h)
        return [
            Detection(
                label=str(names.get(int(classes[i]), int(classes[i]))),
                confidence=float(scores[i]),
                polygon=polys[i].round(2).tolist(),
                class_id=int(classes[i]),
                oriented=oriented,
            )
            for i in keep
        ]
