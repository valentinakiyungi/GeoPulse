"""Detection + geo-projection pipeline: image bytes in, GeoJSON FeatureCollection out."""

from __future__ import annotations

import time
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from app.services.detector import Detector
from app.services.geo_mapper import GeoMapper, polygon_area_m2
from app.services.imaging import decode_image

LatLng = Tuple[float, float]


class UrbanVisionEngine:
    def __init__(self, detector: Detector) -> None:
        self.detector = detector

    def process_aerial_frame(
        self,
        image_bytes: bytes,
        corners: Sequence[LatLng],
        confidence: Optional[float] = None,
        classes: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        """
        Args:
            image_bytes: encoded image.
            corners: (lat, lng) of the TL, TR, BR, BL image corners.
            confidence: optional per-request confidence threshold.
            classes: optional whitelist of class names to keep.
        """
        started = time.perf_counter()
        img = decode_image(image_bytes)
        height, width = img.shape[:2]
        mapper = GeoMapper(corners, width, height)

        detections = self.detector.detect(img, confidence=confidence)
        if classes:
            wanted = {c.strip().lower() for c in classes if c.strip()}
            detections = [d for d in detections if d.label.lower() in wanted]

        features: List[Dict[str, Any]] = []
        for idx, det in enumerate(detections):
            geometry = mapper.polygon_to_geojson(det.polygon)
            ring = geometry["coordinates"][0][:-1]
            center_lat, center_lng = mapper.pixel_to_gps(*det.center)
            features.append(
                {
                    "type": "Feature",
                    "id": idx,
                    "geometry": geometry,
                    "properties": {
                        "id": idx,
                        "class_name": det.label,
                        "confidence": round(det.confidence, 4),
                        "center_lat": center_lat,
                        "center_lng": center_lng,
                        "area_m2": round(polygon_area_m2([(lat, lng) for lng, lat in ring]), 2),
                        "pixel_bbox": [round(v, 1) for v in det.bbox],
                        "oriented": det.oriented,
                    },
                }
            )

        counts = Counter(f["properties"]["class_name"] for f in features)
        confidences = [f["properties"]["confidence"] for f in features]
        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "total_detections": len(features),
                "class_counts": dict(counts.most_common()),
                "mean_confidence": round(float(np.mean(confidences)), 4) if confidences else None,
                "frame_dimensions": {"width": width, "height": height},
                "corners": [list(c) for c in mapper.corners],
                "footprint": mapper.footprint_geojson(),
                "footprint_area_m2": round(mapper.footprint_area_m2(), 1),
                "ground_sample_distance_m": round(mapper.ground_sample_distance(), 4),
                "processing_seconds": round(time.perf_counter() - started, 3),
            },
        }
