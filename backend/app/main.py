"""GeoPulse AI Engine — FastAPI application entry point.

Run with:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import settings
from app.routers import vision
from app.services.detector import Detector, YoloDetector
from app.services.jobs import JobStore
from app.services.vision_engine import UrbanVisionEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("geopulse")


def create_app(detector: Optional[Detector] = None) -> FastAPI:
    detector = detector or YoloDetector(
        weights=settings.model_weights,
        confidence=settings.confidence,
        iou=settings.iou,
        tile_size=settings.tile_size,
        tile_overlap=settings.tile_overlap,
        device=settings.device,
    )
    jobs = JobStore(max_jobs=settings.max_jobs, ttl_seconds=settings.job_ttl_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.warmup and hasattr(detector, "load"):
            # Load (and download, if needed) the model in the background at startup.
            def _warm():
                try:
                    detector.load()
                    log.info("Model ready")
                except Exception as exc:  # surfaced via /health and /model
                    log.error("Model warmup failed: %s", exc)

            threading.Thread(target=_warm, daemon=True).start()
        yield
        jobs.shutdown()

    app = FastAPI(
        title="GeoPulse AI Engine",
        version=__version__,
        description="Aerial object detection projected to WGS84 GeoJSON.",
        lifespan=lifespan,
    )
    app.state.detector = detector
    app.state.engine = UrbanVisionEngine(detector)
    app.state.jobs = jobs

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins) or ["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(vision.router)

    @app.get("/")
    def root():
        return {"message": "GeoPulse AI Engine API is running", "docs": "/docs", "version": __version__}

    @app.get("/health")
    def health_check():
        info = detector.info()
        return {
            "status": "healthy",
            "service": "GeoPulse AI Engine",
            "version": __version__,
            "model": {"weights": info.get("weights"), "loaded": info.get("loaded"), "error": info.get("error")},
        }

    return app


app = create_app()
