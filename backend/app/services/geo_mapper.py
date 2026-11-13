"""Pixel <-> WGS84 geo-referencing.

An image is geo-referenced by the GPS position of its four corners. From those four
correspondences we solve a projective transform (homography), which handles rotated,
skewed and slightly oblique frames — not just north-up rectangles. When the four
corners form a parallelogram the homography reduces exactly to an affine transform.

Coordinates are given as (lat, lng) on input, and emitted as [lng, lat] in GeoJSON.
"""

from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple

import numpy as np

LatLng = Tuple[float, float]
EARTH_RADIUS_M = 6_371_008.8


def _solve_homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Solve the 3x3 homography H with H @ [x, y, 1] ~ [u, v, 1] from 4 point pairs."""
    a = np.zeros((8, 8), dtype=np.float64)
    b = np.zeros(8, dtype=np.float64)
    for i, ((x, y), (u, v)) in enumerate(zip(src, dst)):
        a[2 * i] = [x, y, 1, 0, 0, 0, -u * x, -u * y]
        a[2 * i + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y]
        b[2 * i] = u
        b[2 * i + 1] = v
    try:
        h = np.linalg.solve(a, b)
    except np.linalg.LinAlgError as exc:  # collinear / duplicated corners
        raise ValueError("Corner coordinates are degenerate (three or more are collinear).") from exc
    return np.append(h, 1.0).reshape(3, 3)


class GeoMapper:
    """Projects image pixel coordinates to WGS84 latitude/longitude."""

    def __init__(
        self,
        corners: Sequence[LatLng],
        img_width: int,
        img_height: int,
    ) -> None:
        """
        Args:
            corners: GPS (lat, lng) of the image's top-left, top-right, bottom-right and
                bottom-left corners, in that order.
            img_width / img_height: image size in pixels.
        """
        if len(corners) != 4:
            raise ValueError("Exactly four corners are required (TL, TR, BR, BL).")
        if img_width <= 0 or img_height <= 0:
            raise ValueError("Image dimensions must be positive.")
        for lat, lng in corners:
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
                raise ValueError(f"Invalid GPS coordinate: ({lat}, {lng}).")

        self.corners: List[LatLng] = [(float(lat), float(lng)) for lat, lng in corners]
        self.img_w = int(img_width)
        self.img_h = int(img_height)

        # Work in a local frame (offset from the first corner) for numerical stability.
        self._origin_lng = self.corners[0][1]
        self._origin_lat = self.corners[0][0]
        src = np.array(
            [[0, 0], [self.img_w, 0], [self.img_w, self.img_h], [0, self.img_h]], dtype=np.float64
        )
        dst = np.array(
            [[lng - self._origin_lng, lat - self._origin_lat] for lat, lng in self.corners],
            dtype=np.float64,
        )
        self._h = _solve_homography(src, dst)
        self._h_inv = np.linalg.inv(self._h)

    # ------------------------------------------------------------------ factories
    @classmethod
    def from_bounds(
        cls, top_left: LatLng, bottom_right: LatLng, img_width: int, img_height: int
    ) -> "GeoMapper":
        """North-up image described by its top-left and bottom-right corners."""
        (n, w), (s, e) = top_left, bottom_right
        if n <= s:
            raise ValueError("Top-left latitude must be north of (greater than) bottom-right latitude.")
        if w >= e:
            raise ValueError("Top-left longitude must be west of (less than) bottom-right longitude.")
        return cls([(n, w), (n, e), (s, e), (s, w)], img_width, img_height)

    # ---------------------------------------------------------------- projection
    def pixels_to_gps(self, points: np.ndarray) -> np.ndarray:
        """Vectorised: (N, 2) pixel [x, y] -> (N, 2) [lat, lng]."""
        pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
        homog = np.hstack([pts, np.ones((len(pts), 1))]) @ self._h.T
        lng = homog[:, 0] / homog[:, 2] + self._origin_lng
        lat = homog[:, 1] / homog[:, 2] + self._origin_lat
        return np.stack([lat, lng], axis=1)

    def pixel_to_gps(self, pixel_x: float, pixel_y: float) -> LatLng:
        lat, lng = self.pixels_to_gps(np.array([[pixel_x, pixel_y]]))[0]
        return round(float(lat), 7), round(float(lng), 7)

    def gps_to_pixel(self, lat: float, lng: float) -> Tuple[float, float]:
        vec = self._h_inv @ np.array([lng - self._origin_lng, lat - self._origin_lat, 1.0])
        return float(vec[0] / vec[2]), float(vec[1] / vec[2])

    # ------------------------------------------------------------------- GeoJSON
    def polygon_to_geojson(self, pixel_points: Sequence[Sequence[float]]) -> Dict:
        """Pixel polygon (list of [x, y]) -> closed GeoJSON Polygon."""
        latlng = self.pixels_to_gps(np.asarray(pixel_points, dtype=np.float64))
        ring = [[round(float(lng), 7), round(float(lat), 7)] for lat, lng in latlng]
        ring.append(ring[0])
        return {"type": "Polygon", "coordinates": [ring]}

    def bbox_to_geojson_polygon(self, bbox: Sequence[float]) -> Dict:
        """Axis-aligned pixel box [x1, y1, x2, y2] -> GeoJSON Polygon."""
        x1, y1, x2, y2 = bbox
        return self.polygon_to_geojson([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])

    def footprint_geojson(self) -> Dict:
        ring = [[lng, lat] for lat, lng in self.corners]
        ring.append(ring[0])
        return {"type": "Polygon", "coordinates": [ring]}

    # ----------------------------------------------------------------- metrics
    def ground_sample_distance(self) -> float:
        """Approximate metres per pixel, averaged over the image edges."""
        tl, tr, br, bl = self.corners
        width_m = (haversine_m(tl, tr) + haversine_m(bl, br)) / 2
        height_m = (haversine_m(tl, bl) + haversine_m(tr, br)) / 2
        return (width_m / self.img_w + height_m / self.img_h) / 2

    def footprint_area_m2(self) -> float:
        return polygon_area_m2(self.corners)


def haversine_m(a: LatLng, b: LatLng) -> float:
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def polygon_area_m2(latlngs: Sequence[LatLng]) -> float:
    """Area of a small polygon (lat, lng vertices) using a local equirectangular projection."""
    if len(latlngs) < 3:
        return 0.0
    lat0 = math.radians(sum(p[0] for p in latlngs) / len(latlngs))
    xs = [math.radians(lng) * math.cos(lat0) * EARTH_RADIUS_M for _, lng in latlngs]
    ys = [math.radians(lat) * EARTH_RADIUS_M for lat, _ in latlngs]
    area = 0.0
    for i in range(len(xs)):
        j = (i + 1) % len(xs)
        area += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(area) / 2.0
