import io

import cv2
import numpy as np
import pytest
from PIL import Image
from PIL.TiffImagePlugin import ImageFileDirectory_v2

from app.services.imaging import ImageDecodeError, decode_image, read_georeference
from app.services.tiling import class_aware_nms, make_tiles, nms


# ------------------------------------------------------------------- tiling
def test_tiles_cover_whole_image():
    w, h, t = 2500, 1700, 1024
    tiles = make_tiles(w, h, t, 0.2)
    covered = np.zeros((h, w), dtype=bool)
    for x0, y0, x1, y1 in tiles:
        assert x1 - x0 <= t and y1 - y0 <= t
        covered[y0:y1, x0:x1] = True
    assert covered.all()


def test_small_image_single_tile():
    assert make_tiles(500, 400, 1024, 0.2) == [(0, 0, 500, 400)]


def test_nms_suppresses_overlaps():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=float)
    scores = np.array([0.8, 0.9, 0.5])
    assert nms(boxes, scores, 0.5).tolist() == [1, 2]


def test_class_aware_nms_keeps_other_classes():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11]], dtype=float)
    scores = np.array([0.8, 0.9])
    assert sorted(class_aware_nms(boxes, scores, np.array([0, 1]), 0.5).tolist()) == [0, 1]
    assert class_aware_nms(boxes, scores, np.array([0, 0]), 0.5).tolist() == [1]
    assert class_aware_nms(np.empty((0, 4)), np.empty(0), np.empty(0), 0.5).tolist() == []


# ------------------------------------------------------------------ decoding
def test_decode_variants():
    gray = np.full((20, 30), 100, np.uint8)
    for arr, ext in [(gray, ".png"), (np.zeros((20, 30, 4), np.uint8), ".png"), (np.zeros((20, 30, 3), np.uint8), ".jpg")]:
        ok, buf = cv2.imencode(ext, arr)
        img = decode_image(buf.tobytes())
        assert img.shape == (20, 30, 3) and img.dtype == np.uint8

    sixteen = (np.arange(600, dtype=np.uint16).reshape(20, 30) * 50)
    ok, buf = cv2.imencode(".tiff", sixteen)
    img = decode_image(buf.tobytes())
    assert img.dtype == np.uint8 and img.max() == 255 and img.min() == 0


def test_decode_errors():
    with pytest.raises(ImageDecodeError):
        decode_image(b"")
    with pytest.raises(ImageDecodeError):
        decode_image(b"definitely not an image")


# ------------------------------------------------------------------ GeoTIFF
def _geotiff(model_type: int, epsg: int, tiepoint, scale, w=200, h=100) -> bytes:
    ifd = ImageFileDirectory_v2()
    crs_key = 2048 if model_type == 2 else 3072
    ifd[34735] = (1, 1, 0, 3, 1024, 0, 1, model_type, 1025, 0, 1, 1, crs_key, 0, 1, epsg)
    ifd.tagtype[34735] = 3  # SHORT
    ifd[33922] = tuple(float(v) for v in tiepoint)
    ifd.tagtype[33922] = 12  # DOUBLE
    ifd[33550] = tuple(float(v) for v in scale)
    ifd.tagtype[33550] = 12
    buf = io.BytesIO()
    Image.new("RGB", (w, h)).save(buf, format="TIFF", tiffinfo=ifd)
    return buf.getvalue()


def test_geotiff_wgs84():
    data = _geotiff(2, 4326, (0, 0, 0, 55.27, 25.20, 0), (0.0001, 0.0001, 0))
    ref = read_georeference(data)
    assert ref.reason is None, ref.reason
    assert ref.crs == "EPSG:4326"
    tl, tr, br, bl = ref.corners
    assert tl == pytest.approx((25.20, 55.27))
    assert tr == pytest.approx((25.20, 55.29))
    assert br == pytest.approx((25.19, 55.29))
    assert bl == pytest.approx((25.19, 55.27))
    # and the decoder still reads it as an image
    assert decode_image(data).shape == (100, 200, 3)


def test_geotiff_web_mercator():
    # Web Mercator origin -> (0, 0)
    data = _geotiff(1, 3857, (0, 0, 0, 0.0, 0.0, 0), (10.0, 10.0, 0))
    ref = read_georeference(data)
    assert ref.crs == "EPSG:3857"
    assert ref.corners[0] == pytest.approx((0.0, 0.0), abs=1e-9)
    lat, lng = ref.corners[2]
    assert lng == pytest.approx(2000 / 6378137 * 180 / np.pi, rel=1e-6)
    assert lat < 0


def test_geotiff_unsupported_and_plain():
    ref = read_georeference(_geotiff(1, 32640, (0, 0, 0, 500000, 2800000, 0), (1, 1, 0)))
    assert ref.corners is None and "32640" in ref.reason
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, format="PNG")
    assert read_georeference(buf.getvalue()).corners is None
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, format="TIFF")
    assert "geo-keys" in read_georeference(buf.getvalue()).reason
