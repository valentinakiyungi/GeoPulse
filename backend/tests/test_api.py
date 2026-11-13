import json
import time

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402
from tests.conftest import BR, CORNERS, TL, FakeDetector, make_test_image  # noqa: E402


@pytest.fixture
def client():
    app = create_app(detector=FakeDetector())
    with TestClient(app) as c:
        yield c


def _poll(client, job_id, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/v1/vision/results/{job_id}").json()
        if body["status"] in ("COMPLETED", "FAILED"):
            return body
        time.sleep(0.02)
    raise AssertionError("timeout")


def test_health(client):
    assert client.get("/health").json()["status"] == "healthy"
    assert client.get("/api/v1/vision/model").json()["weights"] == "fake"


def test_analyze_with_bounds(client):
    files = {"file": ("frame.png", make_test_image(), "image/png")}
    data = {"top_left_gps": json.dumps(TL), "bottom_right_gps": json.dumps(BR)}
    r = client.post("/api/v1/vision/analyze", files=files, data=data)
    assert r.status_code == 202, r.text
    job = _poll(client, r.json()["job_id"])
    assert job["status"] == "COMPLETED"
    assert job["data"]["metadata"]["total_detections"] == 2
    assert job["meta"]["filename"] == "frame.png"
    assert client.get("/api/v1/vision/jobs").json()["jobs"][0]["job_id"] == job["job_id"]


def test_analyze_with_corners_and_filter(client):
    files = {"file": ("frame.png", make_test_image(), "image/png")}
    data = {"corners": json.dumps(CORNERS), "classes": "storage tank", "confidence": "0.5"}
    r = client.post("/api/v1/vision/analyze", files=files, data=data)
    job = _poll(client, r.json()["job_id"])
    assert job["data"]["metadata"]["class_counts"] == {"storage tank": 1}


def test_bad_requests(client):
    png = make_test_image()
    r = client.post("/api/v1/vision/analyze", files={"file": ("f.png", png, "image/png")})
    assert r.status_code == 400 and "geo-reference" in r.json()["detail"]
    r = client.post(
        "/api/v1/vision/analyze",
        files={"file": ("f.png", png, "image/png")},
        data={"corners": "[[1,2]]"},
    )
    assert r.status_code == 400
    r = client.post(
        "/api/v1/vision/analyze",
        files={"file": ("f.png", png, "image/png")},
        data={"top_left_gps": json.dumps(BR), "bottom_right_gps": json.dumps(TL)},
    )
    assert r.status_code == 400
    assert client.get("/api/v1/vision/results/nope").status_code == 404


def test_corrupt_image_fails_job(client):
    r = client.post(
        "/api/v1/vision/analyze",
        files={"file": ("f.png", b"garbage", "image/png")},
        data={"corners": json.dumps(CORNERS)},
    )
    job = _poll(client, r.json()["job_id"])
    assert job["status"] == "FAILED" and "decode" in job["error"]
