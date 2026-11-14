"use client";

import { useEffect, useState } from "react";
import { Eraser, Frame, Maximize2 } from "lucide-react";

import type { Corners, LatLng } from "@/lib/types";
import { cornersValid } from "@/lib/geo";

const LABELS = ["Top left", "Top right", "Bottom right", "Bottom left"];

function toFields(c: Corners | null): string[] {
  if (!c) return Array(8).fill("");
  return c.flatMap(([lat, lng]) => [lat.toFixed(7), lng.toFixed(7)]);
}

function parseFields(fields: string[]): Corners | null {
  const nums = fields.map((f) => (f.trim() === "" ? NaN : Number(f)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const c = [0, 1, 2, 3].map((i) => [nums[i * 2], nums[i * 2 + 1]] as LatLng) as Corners;
  return cornersValid(c) ? c : null;
}

interface Props {
  corners: Corners | null;
  source: string | null;
  framing: boolean;
  onChange: (corners: Corners | null, source: string | null) => void;
  onFrame: () => void;
  onFitMap: () => void;
}

export default function CornerEditor({ corners, source, framing, onChange, onFrame, onFitMap }: Props) {
  const [fields, setFields] = useState<string[]>(() => toFields(corners));
  const [showFields, setShowFields] = useState(false);

  // Sync when corners are set from outside (map frame, GeoTIFF, history).
  useEffect(() => {
    if (corners && JSON.stringify(parseFields(fields)) !== JSON.stringify(corners)) {
      setFields(toFields(corners));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corners]);

  const update = (idx: number, value: string) => {
    const next = [...fields];
    next[idx] = value;
    setFields(next);
    onChange(parseFields(next), "manual entry");
  };

  const incomplete = fields.some((f) => f.trim() !== "") && !parseFields(fields);

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-mist-muted">
        {framing
          ? "Move the map until the area your image shows fills the orange frame, then tap Set area."
          : "Mark where the image sits on Earth. Line it up inside a frame on the map, upload a GeoTIFF, or type the corner coordinates."}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onFrame} disabled={framing} className="btn-secondary">
          <Frame className="h-4 w-4" /> {corners ? "Reframe on map" : "Frame on map"}
        </button>
        <button type="button" onClick={onFitMap} disabled={!corners} className="btn-secondary">
          <Maximize2 className="h-4 w-4" /> Zoom to area
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className={incomplete ? "text-marker" : corners ? "text-contour" : "text-mist-faint"}>
          {incomplete ? "Enter valid coordinates for all four corners" : corners ? `Set from ${source ?? "manual entry"}` : "Area not set yet"}
        </span>
        <button
          type="button"
          onClick={() => setShowFields((v) => !v)}
          className="shrink-0 text-mist-muted underline decoration-petrol-600 underline-offset-4 hover:text-mist"
          aria-expanded={showFields}
        >
          {showFields ? "Hide coordinates" : "Edit coordinates"}
        </button>
      </div>

      {showFields && (
        <div className="space-y-2 rounded-lg border border-petrol-700 bg-petrol-950/50 p-3">
          <div className="grid grid-cols-[88px_1fr_1fr] gap-2 text-xs text-mist-faint">
            <span />
            <span>Latitude</span>
            <span>Longitude</span>
          </div>
          {LABELS.map((label, i) => (
            <div key={label} className="grid grid-cols-[88px_1fr_1fr] items-center gap-2">
              <span className="text-[13px] text-mist-muted">{label}</span>
              <input
                inputMode="decimal"
                className="input"
                placeholder="25.2048"
                value={fields[i * 2]}
                onChange={(e) => update(i * 2, e.target.value)}
                aria-label={`${label} latitude`}
              />
              <input
                inputMode="decimal"
                className="input"
                placeholder="55.2708"
                value={fields[i * 2 + 1]}
                onChange={(e) => update(i * 2 + 1, e.target.value)}
                aria-label={`${label} longitude`}
              />
            </div>
          ))}
          {fields.some((f) => f) && (
            <button
              type="button"
              className="flex items-center gap-1.5 pt-1 text-[13px] text-mist-muted hover:text-mist"
              onClick={() => {
                setFields(toFields(null));
                onChange(null, null);
              }}
            >
              <Eraser className="h-3.5 w-3.5" /> Clear coordinates
            </button>
          )}
        </div>
      )}
    </div>
  );
}
