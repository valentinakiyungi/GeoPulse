import time

import pytest

from app.services.jobs import COMPLETED, FAILED, JobStore
from app.services.vision_engine import UrbanVisionEngine
from tests.conftest import BR, CORNERS, TL, make_test_image


def test_pipeline_produces_geojson(fake_detector):
    engine = UrbanVisionEngine(fake_detector)
    out = engine.process_aerial_frame(make_test_image(), CORNERS)
    assert out["type"] == "FeatureCollection"
    md = out["metadata"]
    assert md["total_detections"] == 2
    assert md["class_counts"] == {"small vehicle": 1, "storage tank": 1}
    assert md["frame_dimensions"] == {"width": 400, "height": 300}
    assert md["ground_sample_distance_m"] > 0

    for f in out["features"]:
        ring = f["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1]
        for lng, lat in ring:
            assert BR[0] - 1e-9 <= lat <= TL[0] + 1e-9
            assert TL[1] - 1e-9 <= lng <= BR[1] + 1e-9
        assert f["properties"]["area_m2"] > 0

    # The small box at pixel (50..80, 40..60) is in the north-west of the frame.
    small = next(f for f in out["features"] if f["properties"]["class_name"] == "small vehicle")
    p = small["properties"]
    assert p["center_lng"] == pytest.approx(TL[1] + (65 / 400) * (BR[1] - TL[1]), abs=1e-6)
    assert p["center_lat"] == pytest.approx(TL[0] - (50 / 300) * (TL[0] - BR[0]), abs=1e-6)


def test_pipeline_class_filter(fake_detector):
    engine = UrbanVisionEngine(fake_detector)
    out = engine.process_aerial_frame(make_test_image(), CORNERS, classes=["Storage Tank"])
    assert [f["properties"]["class_name"] for f in out["features"]] == ["storage tank"]


def _wait(store, job_id, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = store.get(job_id)
        if job["status"] in (COMPLETED, FAILED):
            return job
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_job_store_success_and_failure():
    store = JobStore()
    ok = store.submit(lambda: {"answer": 42}, meta={"filename": "a.png"})
    bad = store.submit(lambda: 1 / 0)
    assert _wait(store, ok)["data"] == {"answer": 42}
    failed = _wait(store, bad)
    assert failed["status"] == FAILED and "division" in failed["error"]
    listed = store.list()
    assert [j["job_id"] for j in listed] == [bad, ok]
    assert all("data" not in j for j in listed)
    assert store.delete(ok) and store.get(ok) is None
    assert store.get("missing") is None
    store.shutdown()


def test_job_store_evicts_old_jobs():
    store = JobStore(max_jobs=3)
    ids = [store.submit(lambda i=i: {"i": i}) for i in range(3)]
    for j in ids:
        _wait(store, j)
    newest = store.submit(lambda: {"i": 3})
    assert store.get(ids[0]) is None  # oldest finished job evicted
    assert _wait(store, newest)["data"] == {"i": 3}
    store.shutdown()
