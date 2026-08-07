import cv2
import numpy as np
from ultralytics import YOLO
from typing import Dict, Any, List
from app.services.geo_mapper import GeoMapper

class UrbanVisionEngine:
    def __init__(self, model_weights: str = "yolov8n.pt"):
        self.model = YOLO(model_weights)

    def process_aerial_frame(
        self, 
        image_bytes: bytes, 
        top_left_gps: List[float], 
        bottom_right_gps: List[float]
    ) -> Dict[str, Any]:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        height, width, _ = img.shape

        mapper = GeoMapper(
            top_left_gps=(top_left_gps[0], top_left_gps[1]),
            bottom_right_gps=(bottom_right_gps[0], bottom_right_gps[1]),
            img_width=width,
            img_height=height
        )

        results = self.model(img, conf=0.25)[0]
        features: List[Dict] = []
        object_counts: Dict[str, int] = {}

        for box in results.boxes:
            cls_id = int(box.cls[0])
            label = self.model.names[cls_id]
            confidence = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()

            geometry = mapper.bbox_to_geojson_polygon(xyxy)
            cx = (xyxy[0] + xyxy[2]) / 2.0
            cy = (xyxy[1] + xyxy[3]) / 2.0
            center_lat, center_lng = mapper.pixel_to_gps(cx, cy)

            feature = {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "class_name": label,
                    "confidence": round(confidence, 3),
                    "center_lat": center_lat,
                    "center_lng": center_lng
                }
            }
            features.append(feature)
            object_counts[label] = object_counts.get(label, 0) + 1

        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "total_detections": len(features),
                "class_counts": object_counts,
                "frame_dimensions": {"width": width, "height": height}
            }
        }
