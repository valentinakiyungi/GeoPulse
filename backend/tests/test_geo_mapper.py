import math

import numpy as np
import pytest

from app.services.geo_mapper import GeoMapper, haversine_m, polygon_area_m2
from tests.conftest import BR, CORNERS, TL


def test_corners_map_exactly():
    m = GeoMapper(CORNERS, 1000, 800)
    for (px, py), (lat, lng) in zip([(0, 0), (1000, 0), (1000, 800), (0, 800)], CORNERS):
        got = m.pixel_to_gps(px, py)
        assert got == pytest.approx((lat, lng), abs=1e-7)


def test_north_up_matches_linear_interpolation():
    m = GeoMapper.from_bounds(TL, BR, 1000, 800)
    lat, lng = m.pixel_to_gps(250, 600)
    assert lng == pytest.approx(TL[1] + 0.25 * (BR[1] - TL[1]), abs=1e-7)
    assert lat == pytest.approx(TL[0] - 0.75 * (TL[0] - BR[0]), abs=1e-7)


def test_rotated_frame_round_trip():
    # A frame rotated ~30 degrees: corners are not axis-aligned.
    c = (25.2, 55.27)
    ang = math.radians(30)
    half_w, half_h = 0.004, 0.003

    def rot(dx, dy):
        return (c[0] + dx * math.sin(ang) + dy * math.cos(ang), c[1] + dx * math.cos(ang) - dy * math.sin(ang))

    corners = [rot(-half_w, half_h), rot(half_w, half_h), rot(half_w, -half_h), rot(-half_w, -half_h)]
    m = GeoMapper(corners, 1200, 900)
    # centre pixel -> centre coordinate
    assert m.pixel_to_gps(600, 450) == pytest.approx(c, abs=1e-7)
    # inverse projection
    for px, py in [(10, 20), (600, 450), (1111, 888)]:
        lat, lng = m.pixel_to_gps(px, py)
        bx, by = m.gps_to_pixel(lat, lng)
        assert (bx, by) == pytest.approx((px, py), abs=0.05)


def test_geojson_polygon_is_closed_lnglat():
    m = GeoMapper.from_bounds(TL, BR, 100, 100)
    poly = m.bbox_to_geojson_polygon([0, 0, 50, 50])
    ring = poly["coordinates"][0]
    assert poly["type"] == "Polygon"
    assert ring[0] == ring[-1] and len(ring) == 5
    assert ring[0] == pytest.approx([TL[1], TL[0]])  # [lng, lat]


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        GeoMapper(CORNERS[:3], 10, 10)
    with pytest.raises(ValueError):
        GeoMapper([(0, 0), (0, 0), (0, 0), (0, 0)], 10, 10)
    with pytest.raises(ValueError):
        GeoMapper([(95, 0), (0, 1), (1, 1), (1, 0)], 10, 10)
    with pytest.raises(ValueError):
        GeoMapper.from_bounds(BR, TL, 10, 10)  # swapped


def test_metrics_reasonable():
    m = GeoMapper.from_bounds(TL, BR, 1000, 800)
    width_m = haversine_m(TL, (TL[0], BR[1]))
    height_m = haversine_m(TL, (BR[0], TL[1]))
    assert 870 < width_m < 900  # 0.0088 deg lng at 25.2N
    assert 840 < height_m < 850  # 0.0076 deg lat
    assert m.footprint_area_m2() == pytest.approx(width_m * height_m, rel=0.01)
    assert m.ground_sample_distance() == pytest.approx((width_m / 1000 + height_m / 800) / 2, rel=0.01)
    assert polygon_area_m2([(0, 0), (0, 0)]) == 0.0


def test_vectorised_matches_scalar():
    m = GeoMapper(CORNERS, 640, 480)
    pts = np.array([[1, 2], [300, 200], [639, 479]])
    vec = m.pixels_to_gps(pts)
    for (x, y), row in zip(pts, vec):
        assert tuple(row) == pytest.approx(m.pixel_to_gps(x, y), abs=1e-7)
