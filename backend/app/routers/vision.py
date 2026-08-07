import json
import uuid
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, HTTPException
from app.services.vision_engine import UrbanVisionEngine

router = APIRouter(prefix="/api/v1/vision", tags=["Geospatial Vision"])
vision_engine = UrbanVisionEngine()
job_results_db = {}

def async_process_frame(job_id: str, file_bytes: bytes, top_left: list, bottom_right: list):
    try:
        geojson_res = vision_engine.process_aerial_frame(file_bytes, top_left, bottom_right)
        job_results_db[job_id] = {"status": "COMPLETED", "data": geojson_res}
    except Exception as e:
        job_results_db[job_id] = {"status": "FAILED", "error": str(e)}

@router.post("/analyze")
async def analyze_aerial_imagery(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    top_left_gps: str = Form(...),
    bottom_right_gps: str = Form(...)
):
    try:
        tl = json.loads(top_left_gps)
        br = json.loads(bottom_right_gps)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid GPS format.")

    file_bytes = await file.read()
    job_id = str(uuid.uuid4())
    job_results_db[job_id] = {"status": "PROCESSING"}

    background_tasks.add_task(async_process_frame, job_id, file_bytes, tl, br)
    return {"job_id": job_id, "status": "PROCESSING"}

@router.get("/results/{job_id}")
async def get_detection_results(job_id: str):
    if job_id not in job_results_db:
        raise HTTPException(status_code=404, detail="Job ID not found.")
    return job_results_db[job_id]
