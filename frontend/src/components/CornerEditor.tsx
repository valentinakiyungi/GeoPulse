"use client";

import { useEffect, useState } from "react";
import { Crosshair, Eraser, Maximize2 } from "lucide-react";

import type { Corners, LatLng } from "@/lib/types";
import { cornersValid } from "@/lib/geo";

const LABELS = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];

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
  onChange: (corners: Corners | null, source: string | null) => void;
  onUseMapView: () => void;
  onFitMap: () => void;
}

export default function CornerEditor({ corners, source, onChange, onUseMapView, onFitMap }: Props) {
  const [fields, setFields] = useState<string[]>(() => toFields(corners));

  // Sync when corners are set from outside (map view, GeoTIFF, history).
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
    onChange(parseFields(next), "manual");
  };

  const incomplete = fields.some((f) => f.trim() !== "") && !parseFields(fields);

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-400">
        Tell GeoPulse where the image sits on Earth. Pan and zoom the map so the image&apos;s area fills the view and
        click <span className="text-slate-200">Use map view</span>, upload a GeoTIFF, or type the corner coordinates.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onUseMapView} className="btn-secondary">
          <Crosshair className="h-3.5 w-3.5" /> Use map view
        </button>
        <button type="button" onClick={onFitMap} disabled={!corners} className="btn-secondary">
          <Maximize2 className="h-3.5 w-3.5" /> Zoom to area
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="grid grid-cols-[84px_1fr_1fr] gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
          <span />
          <span>Latitude</span>
          <span>Longitude</span>
        </div>
        {LABELS.map((label, i) => (
          <div key={label} className="grid grid-cols-[84px_1fr_1fr] items-center gap-1.5">
            <span className="text-xs text-slate-400">{label}</span>
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
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={incomplete ? "text-amber-400" : corners ? "text-emerald-400" : "text-slate-500"}>
          {incomplete ? "Enter valid coordinates for all four corners" : corners ? `Set from ${source ?? "manual entry"}` : "Not set"}
        </span>
        {fields.some((f) => f) && (
          <button
            type="button"
            className="flex items-center gap-1 text-slate-500 hover:text-slate-300"
            onClick={() => {
              setFields(toFields(null));
              onChange(null, null);
            }}
          >
            <Eraser className="h-3 w-3" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
