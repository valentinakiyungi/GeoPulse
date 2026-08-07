import numpy as np
from typing import Dict, List, Tuple

class GeoMapper:
    """
    Transforms image bounding box pixel coordinates to real-world WGS84 GPS coordinates
    using 4-corner geo-referencing affine transformation.
    """
    def __init__(self, top_left_gps: Tuple[float, float], bottom_right_gps: Tuple[float, float], img_width: int, img_height: int):
        self.min_lat, self.min_lng = bottom_right_gps[0], top_left_gps[1]
        self.max_lat, self.max_lng = top_left_gps[0], bottom_right_gps[1]
        self.img_w = img_width
        self.img_h = img_height

    def pixel_to_gps(self, pixel_x: float, pixel_y: float) -> Tuple[float, float]:
        lng = self.min_lng + (pixel_x / self.img_w) * (self.max_lng - self.min_lng)
        lat = self.max_lat - (pixel_y / self.img_h) * (self.max_lat - self.min_lat)
        return round(lat, 6), round(lng, 6)

    def bbox_to_geojson_polygon(self, bbox: List[float]) -> Dict:
        x1, y1, x2, y2 = bbox
        nw_lat, nw_lng = self.pixel_to_gps(x1, y1)
        ne_lat, ne_lng = self.pixel_to_gps(x2, y1)
        se_lat, se_lng = self.pixel_to_gps(x2, y2)
        sw_lat, sw_lng = self.pixel_to_gps(x1, y2)

        return {
            "type": "Polygon",
            "coordinates": [[
                [nw_lng, nw_lat],
                [ne_lng, ne_lat],
                [se_lng, se_lat],
                [sw_lng, sw_lat],
                [nw_lng, nw_lat]
            ]]
        }
