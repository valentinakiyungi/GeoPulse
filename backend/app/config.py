"""Runtime configuration, read from environment variables (or a backend/.env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader so we don't need python-dotenv. Existing env vars win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _resolve_weights(value: str) -> str:
    """Relative weight names live in backend/models/ so downloads never land in the repo root."""
    path = Path(value).expanduser()
    if path.is_absolute():
        return str(path)
    if len(path.parts) == 1:
        return str(BACKEND_DIR / "models" / path)
    return str(BACKEND_DIR / path)


@dataclass(frozen=True)
class Settings:
    # Model. The default is YOLOv8 oriented-bounding-box trained on DOTA, an aerial
    # imagery dataset (planes, ships, vehicles, storage tanks, pools, courts...).
    # Any Ultralytics detection or OBB weights work, e.g. "yolov8s-obb.pt" or "yolov8n.pt".
    model_weights: str = field(
        default_factory=lambda: _resolve_weights(os.getenv("GEOPULSE_MODEL", "yolov8n-obb.pt"))
    )
    device: str = field(default_factory=lambda: os.getenv("GEOPULSE_DEVICE", ""))  # "", "cpu", "0", "mps"
    confidence: float = field(default_factory=lambda: _env_float("GEOPULSE_CONFIDENCE", 0.25))
    iou: float = field(default_factory=lambda: _env_float("GEOPULSE_IOU", 0.45))
    tile_size: int = field(default_factory=lambda: _env_int("GEOPULSE_TILE_SIZE", 1024))
    tile_overlap: float = field(default_factory=lambda: _env_float("GEOPULSE_TILE_OVERLAP", 0.2))
    max_upload_mb: int = field(default_factory=lambda: _env_int("GEOPULSE_MAX_UPLOAD_MB", 100))
    max_jobs: int = field(default_factory=lambda: _env_int("GEOPULSE_MAX_JOBS", 200))
    job_ttl_seconds: int = field(default_factory=lambda: _env_int("GEOPULSE_JOB_TTL_SECONDS", 6 * 3600))
    warmup: bool = field(default_factory=lambda: _env_bool("GEOPULSE_WARMUP", False))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv("GEOPULSE_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
            if o.strip()
        )
    )


_load_dotenv(BACKEND_DIR / ".env")
settings = Settings()
