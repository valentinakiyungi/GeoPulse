"""Exercise YoloDetector's tiling / parsing / merging with a fake Ultralytics model."""

import numpy as np

from app.services.detector import YoloDetector


class _T:
    """Minimal stand-in for a torch tensor."""

    def __init__(self, arr):
        self.arr = np.asarray(arr)

    def cpu(self):
        return self

    def numpy(self):
        return self.arr


class _Boxes:
    def __init__(self, xyxy, conf, cls):
        self.xyxy, self.conf, self.cls = _T(xyxy), _T(conf), _T(cls)

    def __len__(self):
        return len(self.conf.arr)


class _OBB:
    def __init__(self, polys, conf, cls):
        self.xyxyxyxy, self.conf, self.cls = _T(polys), _T(conf), _T(cls)

    def __len__(self):
        return len(self.conf.arr)


class _Result:
    def __init__(self, boxes=None, obb=None):
        self.boxes, self.obb = boxes, obb


class FakeYolo:
    """Detects white squares in each crop; emits OBB or axis-aligned results."""

    names = {0: "small vehicle", 1: "plane"}

    def __init__(self, oriented: bool):
        self.task = "obb" if oriented else "detect"
        self.oriented = oriented
        self.calls = []

    def predict(self, images, **kwargs):
        self.calls.append((len(images), kwargs))
        out = []
        for img in images:
            ys, xs = np.nonzero(img[:, :, 0] > 127)
            if len(xs) == 0:
                out.append(_Result(boxes=_Boxes(np.zeros((0, 4)), np.zeros(0), np.zeros(0))))
                continue
            x1, y1, x2, y2 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
            if self.oriented:
                poly = [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]]
                out.append(_Result(obb=_OBB(poly, [0.8], [1])))
            else:
                out.append(_Result(boxes=_Boxes([[x1, y1, x2, y2]], [0.7], [0])))
        return out


def _detector(model, tile=256):
    d = YoloDetector("fake.pt", tile_size=tile, tile_overlap=0.25, batch_size=3)
    d._model = model  # skip ultralytics loading
    return d


def test_single_pass_small_image():
    img = np.zeros((200, 300, 3), np.uint8)
    img[50:70, 100:140] = 255
    model = FakeYolo(oriented=False)
    dets = _detector(model).detect(img)
    assert len(model.calls) == 1 and model.calls[0][0] == 1
    assert model.calls[0][1]["imgsz"] % 32 == 0
    assert len(dets) == 1
    d = dets[0]
    assert d.label == "small vehicle" and not d.oriented
    assert d.bbox == [100, 50, 140, 70]


def test_tiled_obb_object_in_overlap_is_merged():
    # 800x600 frame -> tiled with 256px tiles. Object sits where several tiles overlap.
    img = np.zeros((600, 800, 3), np.uint8)
    img[200:215, 200:215] = 255
    model = FakeYolo(oriented=True)
    det = _detector(model)
    dets = det.detect(img, confidence=0.5)
    assert sum(n for n, _ in model.calls) > 4  # many tiles, batched
    assert all(n <= 3 for n, _ in model.calls)
    assert model.calls[0][1]["conf"] == 0.5
    assert len(dets) == 1  # duplicates from overlapping tiles merged by NMS
    d = dets[0]
    assert d.oriented and d.label == "plane"
    assert d.bbox == [200, 200, 215, 215]  # shifted back into full-frame coordinates
    assert d.center == [207.5, 207.5]


def test_no_detections():
    model = FakeYolo(oriented=True)
    assert _detector(model).detect(np.zeros((900, 900, 3), np.uint8)) == []


def test_info_without_model():
    d = YoloDetector("models/x.pt")
    info = d.info()
    assert info["loaded"] is False and info["classes"] == [] and info["error"] is None
