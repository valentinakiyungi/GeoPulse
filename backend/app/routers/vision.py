"""HTTP API for geospatial vision jobs."""

from __future__ import annotations

import json
import math
from typing import List, Optional, Tuple

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.config import settings
from app.services.geo_mapper import GeoMapper
from app.services.imaging import read_georeference

router = APIRouter(prefix="/api/v1/vision", tags=["Geospatial Vision"])

LatLng = Tuple[float, float]


# ----------------------------------------------------------------- helpers
def _parse_point(raw: str, name: str) -> LatLng:
    try:
        value = json.loads(raw)
        lat, lng = float(value[0]), float(value[1])
    except Exception:
        raise HTTPException(400, f"{name} must be a JSON array [lat, lng].")
    if not (math.isfinite(lat) and math.isfinite(lng)):
        raise HTTPException(400, f"{name} contains a non-finite number.")
    return lat, lng


def _parse_corners(raw: str) -> List[LatLng]:
    try:
        value = json.loads(raw)
        corners = [(float(p[0]), float(p[1])) for p in value]
    except Exception:
        raise HTTPException(400, "corners must be a JSON array of four [lat, lng] pairs (TL, TR, BR, BL).")
    if len(corners) != 4 or not all(math.isfinite(c) for p in corners for c in p):
        raise HTTPException(400, "corners must contain exactly four finite [lat, lng] pairs (TL, TR, BR, BL).")
    return corners


def _validate_corners(corners: List[LatLng]) -> None:
    try:
        GeoMapper(corners, 1000, 1000)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


async def _read_upload(file: UploadFile) -> bytes:
    limit = settings.max_upload_mb * 1024 * 1024
    chunks, size = [], 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, f"File exceeds the {settings.max_upload_mb} MB upload limit.")
        chunks.append(chunk)
    if size == 0:
        raise HTTPException(400, "The uploaded file is empty.")
    return b"".join(chunks)


# ---------------------------------------------------------------- endpoints
@router.post("/analyze", status_code=202)
async def analyze_aerial_imagery(
    request: Request,
    file: UploadFile = File(..., description="Aerial / satellite / drone image"),
    corners: Optional[str] = Form(None, description="JSON [[lat,lng] x4] for TL, TR, BR, BL"),
    top_left_gps: Optional[str] = Form(None, description="JSON [lat,lng] (north-up images)"),
    bottom_right_gps: Optional[str] = Form(None, description="JSON [lat,lng] (north-up images)"),
    confidence: Optional[float] = Form(None, ge=0.01, le=0.99),
    classes: Optional[str] = Form(None, description="Comma-separated class names to keep"),
):
    """Queue an image for detection + geo-projection. Returns a job id to poll.

    Geo-reference priority: `corners` > `top_left_gps`+`bottom_right_gps` > GeoTIFF tags.
    """
    file_bytes = await _read_upload(file)

    georef_source = "manual"
    if corners:
        corner_list = _parse_corners(corners)
    elif top_left_gps and bottom_right_gps:
        tl = _parse_point(top_left_gps, "top_left_gps")
        br = _parse_point(bottom_right_gps, "bottom_right_gps")
        corner_list = [tl, (tl[0], br[1]), br, (br[0], tl[1])]
    else:
        georef = read_georeference(file_bytes)
        if not georef.corners:
            raise HTTPException(
                400,
                "No geo-reference supplied. Send `corners` (or top_left_gps + bottom_right_gps), "
                f"or upload a GeoTIFF in EPSG:4326/3857. ({georef.reason})",
            )
        corner_list = georef.corners
        georef_source = f"geotiff ({georef.crs})"
    _validate_corners(corner_list)

    class_list = [c for c in (classes or "").split(",") if c.strip()] or None
    engine = request.app.state.engine
    job_id = request.app.state.jobs.submit(
        lambda: engine.process_aerial_frame(file_bytes, corner_list, confidence, class_list),
        meta={
            "filename": file.filename,
            "size_bytes": len(file_bytes),
            "georef_source": georef_source,
        },
    )
    return {"job_id": job_id, "status": "PENDING"}


@router.get("/results/{job_id}")
async def get_detection_results(job_id: str, request: Request):
    job = request.app.state.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job ID not found (it may have expired).")
    return job


@router.delete("/results/{job_id}", status_code=204)
async def delete_job(job_id: str, request: Request):
    if not request.app.state.jobs.delete(job_id):
        raise HTTPException(404, "Job not found or still running.")


@router.get("/jobs")
async def list_jobs(request: Request):
    return {"jobs": request.app.state.jobs.list()}


@router.post("/georef")
async def inspect_georeference(file: UploadFile = File(...)):
    """Read the corner coordinates embedded in a GeoTIFF, if any."""
    data = await _read_upload(file)
    georef = read_georeference(data)
    return {
        "corners": georef.corners,
        "width": georef.width,
        "height": georef.height,
        "crs": georef.crs,
        "reason": georef.reason,
    }


@router.get("/model")
async def model_info(request: Request):
    return request.app.state.detector.info()
