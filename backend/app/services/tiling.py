"""Sliced inference helpers for large aerial frames.

High-resolution drone / satellite frames contain many small objects. Downscaling the
whole frame to the model's input size makes them vanish, so we cut the frame into
overlapping tiles, detect per tile, shift the results back and merge duplicates with
class-aware non-maximum suppression.
"""

from __future__ import annotations

from typing import List, Tuple

import numpy as np

Tile = Tuple[int, int, int, int]  # x0, y0, x1, y1


def _axis_starts(length: int, tile: int, stride: int) -> List[int]:
    if length <= tile:
        return [0]
    starts = list(range(0, length - tile + 1, stride))
    if starts[-1] + tile < length:
        starts.append(length - tile)  # make sure the far edge is covered
    return starts


def make_tiles(width: int, height: int, tile_size: int, overlap: float) -> List[Tile]:
    """Cover a width x height image with overlapping tile_size windows."""
    if tile_size <= 0:
        raise ValueError("tile_size must be positive")
    overlap = min(max(overlap, 0.0), 0.9)
    stride = max(1, int(round(tile_size * (1.0 - overlap))))
    tiles: List[Tile] = []
    for y0 in _axis_starts(height, tile_size, stride):
        for x0 in _axis_starts(width, tile_size, stride):
            tiles.append((x0, y0, min(x0 + tile_size, width), min(y0 + tile_size, height)))
    return tiles


def nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> np.ndarray:
    """Plain NMS on (N, 4) xyxy boxes. Returns kept indices, highest score first."""
    if len(boxes) == 0:
        return np.empty(0, dtype=np.int64)
    boxes = boxes.astype(np.float64)
    x1, y1, x2, y2 = boxes.T
    areas = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    order = np.argsort(-scores, kind="stable")
    keep: List[int] = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        union = areas[i] + areas[rest] - inter
        iou = np.where(union > 0, inter / np.maximum(union, 1e-12), 0.0)
        order = rest[iou <= iou_threshold]
    return np.array(keep, dtype=np.int64)


def class_aware_nms(
    boxes: np.ndarray, scores: np.ndarray, class_ids: np.ndarray, iou_threshold: float
) -> np.ndarray:
    """NMS applied independently per class. Returns kept indices sorted by score."""
    keep: List[int] = []
    for cls in np.unique(class_ids):
        idx = np.flatnonzero(class_ids == cls)
        keep.extend(idx[nms(boxes[idx], scores[idx], iou_threshold)].tolist())
    keep_arr = np.array(keep, dtype=np.int64)
    return keep_arr[np.argsort(-scores[keep_arr], kind="stable")] if len(keep_arr) else keep_arr
