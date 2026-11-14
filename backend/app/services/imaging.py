"""Image decoding and GeoTIFF geo-reference extraction."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np

LatLng = Tuple[float, float]


class ImageDecodeError(ValueError):
    pass


def decode_image(data: bytes) -> np.ndarray:
    """Decode any OpenCV-readable image (JPEG, PNG, TIFF/GeoTIFF, WebP, BMP) to 8-bit BGR."""
    if not data:
        raise ImageDecodeError("The uploaded file is empty.")
    buf = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_UNCHANGED)
    if img is None:
        img = _decode_with_pillow(data)
    if img is None:
        raise ImageDecodeError("Could not decode the image. Supported: JPEG, PNG, TIFF/GeoTIFF, WebP, BMP.")

    # Bit depth: stretch 16-bit / float imagery (common in satellite products) to 8-bit.
    if img.dtype != np.uint8:
        img = img.astype(np.float64)
        finite = img[np.isfinite(img)]
        if finite.size == 0:
            raise ImageDecodeError("Image contains no valid pixel values.")
        lo, hi = np.percentile(finite, [1, 99])
        if hi <= lo:
            hi = lo + 1
        img = np.nan_to_num(np.clip((img - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)

    # Channels: grayscale -> BGR, BGRA -> BGR, multispectral -> first three bands.
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 1:
        img = cv2.cvtColor(img[:, :, 0], cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    elif img.shape[2] > 4:
        img = np.ascontiguousarray(img[:, :, :3])
    return img


def _decode_with_pillow(data: bytes) -> Optional[np.ndarray]:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGB")
            return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


# --------------------------------------------------------------------- GeoTIFF
TAG_MODEL_PIXEL_SCALE = 33550
TAG_MODEL_TIEPOINT = 33922
TAG_MODEL_TRANSFORMATION = 34264
TAG_GEO_KEY_DIRECTORY = 34735

KEY_MODEL_TYPE = 1024  # 1 = projected, 2 = geographic
KEY_GEOGRAPHIC_TYPE = 2048
KEY_PROJECTED_CS_TYPE = 3072
KEY_RASTER_TYPE = 1025  # 1 = PixelIsArea, 2 = PixelIsPoint

WGS84_LIKE_GEOGRAPHIC = {4326, 4269, 4258}  # WGS84, NAD83, ETRS89 — sub-metre apart
WEB_MERCATOR = {3857, 900913, 3785, 102100}


@dataclass
class GeoReference:
    corners: Optional[List[LatLng]]  # TL, TR, BR, BL as (lat, lng)
    width: Optional[int] = None
    height: Optional[int] = None
    crs: Optional[str] = None
    reason: Optional[str] = None  # why corners could not be extracted


def _mercator_to_latlng(x: float, y: float) -> LatLng:
    r = 6378137.0
    lng = math.degrees(x / r)
    lat = math.degrees(2 * math.atan(math.exp(y / r)) - math.pi / 2)
    return lat, lng


def _parse_geokeys(raw) -> dict:
    vals = [int(v) for v in raw]
    keys = {}
    if len(vals) < 4:
        return keys
    count = vals[3]
    for i in range(count):
        base = 4 + i * 4
        if base + 3 >= len(vals):
            break
        key_id, location, _count, value = vals[base : base + 4]
        if location == 0:  # value stored inline
            keys[key_id] = value
    return keys


def read_georeference(data: bytes) -> GeoReference:
    """Extract WGS84 corner coordinates from a GeoTIFF, if it carries them.

    Supports geographic CRSs (EPSG:4326 and close relatives) and Web Mercator (EPSG:3857),
    using tie-point + pixel-scale or a full model transformation matrix.
    """
    try:
        from PIL import Image, TiffImagePlugin  # noqa: F401
    except ImportError:  # pragma: no cover
        return GeoReference(None, reason="Pillow is not installed.")

    try:
        im = Image.open(io.BytesIO(data))
        if im.format != "TIFF":
            return GeoReference(None, reason="Not a TIFF file.")
        tags = im.tag_v2
        width, height = im.size
    except Exception:
        return GeoReference(None, reason="Could not read TIFF metadata.")

    geokeys = _parse_geokeys(tags.get(TAG_GEO_KEY_DIRECTORY, ())) if TAG_GEO_KEY_DIRECTORY in tags else {}
    if not geokeys:
        return GeoReference(None, width, height, reason="TIFF has no GeoTIFF geo-keys.")

    model_type = geokeys.get(KEY_MODEL_TYPE)
    if model_type == 2:
        epsg = geokeys.get(KEY_GEOGRAPHIC_TYPE, 4326)
        if epsg not in WGS84_LIKE_GEOGRAPHIC and epsg != 32767:  # 32767 = user-defined, assume WGS84
            return GeoReference(None, width, height, f"EPSG:{epsg}", f"Unsupported geographic CRS EPSG:{epsg}.")
        to_latlng = lambda x, y: (y, x)  # noqa: E731
        crs = f"EPSG:{epsg if epsg != 32767 else 4326}"
    elif model_type == 1:
        epsg = geokeys.get(KEY_PROJECTED_CS_TYPE)
        if epsg not in WEB_MERCATOR:
            return GeoReference(
                None, width, height, f"EPSG:{epsg}",
                f"Projected CRS EPSG:{epsg} is not supported; reproject to EPSG:4326 "
                "(e.g. `gdalwarp -t_srs EPSG:4326 in.tif out.tif`) or enter corners manually.",
            )
        to_latlng = _mercator_to_latlng
        crs = "EPSG:3857"
    else:
        return GeoReference(None, width, height, reason="GeoTIFF model type is not set.")

    # PixelIsPoint rasters reference pixel centres; shift by half a pixel so corners are edges.
    half = 0.5 if geokeys.get(KEY_RASTER_TYPE) == 2 else 0.0

    if TAG_MODEL_TRANSFORMATION in tags:
        m = [float(v) for v in tags[TAG_MODEL_TRANSFORMATION]]
        if len(m) < 8:
            return GeoReference(None, width, height, crs, "Malformed ModelTransformation tag.")

        def model(i: float, j: float) -> Tuple[float, float]:
            i, j = i - half, j - half
            return m[0] * i + m[1] * j + m[3], m[4] * i + m[5] * j + m[7]

    elif TAG_MODEL_TIEPOINT in tags and TAG_MODEL_PIXEL_SCALE in tags:
        tp = [float(v) for v in tags[TAG_MODEL_TIEPOINT]]
        sc = [float(v) for v in tags[TAG_MODEL_PIXEL_SCALE]]
        if len(tp) < 6 or len(sc) < 2:
            return GeoReference(None, width, height, crs, "Malformed tie-point / pixel-scale tags.")
        ti, tj, _, tx, ty, _ = tp[:6]
        sx, sy = sc[0], sc[1]

        def model(i: float, j: float) -> Tuple[float, float]:
            i, j = i - half, j - half
            return tx + (i - ti) * sx, ty - (j - tj) * sy

    else:
        return GeoReference(None, width, height, crs, "GeoTIFF has no tie-point or transformation tags.")

    pixel_corners = [(0, 0), (width, 0), (width, height), (0, height)]
    corners = []
    for i, j in pixel_corners:
        lat, lng = to_latlng(*model(i, j))
        corners.append((round(lat, 8), round(lng, 8)))
    if not all(-90 <= lat <= 90 and -180 <= lng <= 180 for lat, lng in corners):
        return GeoReference(None, width, height, crs, "GeoTIFF coordinates are out of WGS84 range.")
    return GeoReference(corners, width, height, crs)
