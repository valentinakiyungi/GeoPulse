"use client";

import { Download, Eye, EyeOff } from "lucide-react";

import type { AnalysisResult } from "@/lib/types";
import { classColor, formatArea } from "@/lib/geo";

interface Props {
  result: AnalysisResult;
  hiddenClasses: string[];
  onToggleClass: (name: string) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDownload: () => void;
}

const MAX_ROWS = 250;

function formatGsd(m: number) {
  return m < 1 ? `${(m * 100).toFixed(1)} cm/px` : `${m.toFixed(2)} m/px`;
}

export default function ResultsPanel({ result, hiddenClasses, onToggleClass, selectedId, onSelect, onDownload }: Props) {
  const md = result.metadata;
  const visible = result.features.filter((f) => !hiddenClasses.includes(f.properties.class_name));

  const facts = [
    { label: "Mean confidence", value: md.mean_confidence != null ? `${(md.mean_confidence * 100).toFixed(1)}%` : "n/a" },
    { label: "Ground resolution", value: formatGsd(md.ground_sample_distance_m) },
    { label: "Area covered", value: formatArea(md.footprint_area_m2) },
    { label: "Frame size", value: `${md.frame_dimensions.width} × ${md.frame_dimensions.height}` },
    { label: "Processing time", value: `${md.processing_seconds.toFixed(2)} s` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <p>
          <span className="block font-mono text-4xl font-medium leading-none text-mist">
            {md.total_detections.toLocaleString()}
          </span>
          <span className="mt-1 block text-[13px] text-mist-muted">
            {md.total_detections === 1 ? "object found" : "objects found"}
          </span>
        </p>
        <button type="button" onClick={onDownload} className="btn-secondary">
          <Download className="h-4 w-4" /> GeoJSON
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-petrol-700 py-3">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-mist-faint">{f.label}</dt>
            <dd className="font-mono text-[13px] text-mist">{f.value}</dd>
          </div>
        ))}
      </dl>

      {md.total_detections === 0 ? (
        <p className="text-[13px] leading-relaxed text-mist-muted">
          Nothing was detected. Lower the confidence threshold and run it again, and check that the image is a
          straight-down aerial view. The default model finds vehicles, planes, ships, storage tanks, pools,
          sports courts, bridges and harbours.
        </p>
      ) : (
        <>
          <div>
            <h3 className="mb-1.5 text-[13px] font-medium text-mist-muted">Show on map</h3>
            <ul>
              {Object.entries(md.class_counts).map(([name, count]) => {
                const hidden = hiddenClasses.includes(name);
                return (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => onToggleClass(name)}
                      aria-pressed={!hidden}
                      className="flex min-h-[40px] w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-petrol-800"
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-[3px] border border-black/20"
                        style={{ background: classColor(name), opacity: hidden ? 0.2 : 1 }}
                      />
                      <span className={`flex-1 first-letter:uppercase ${hidden ? "text-mist-faint line-through" : "text-mist"}`}>
                        {name}
                      </span>
                      <span className="font-mono text-xs text-mist-muted">{count}</span>
                      {hidden ? <EyeOff className="h-4 w-4 text-mist-faint" /> : <Eye className="h-4 w-4 text-mist-muted" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-1.5 text-[13px] font-medium text-mist-muted">
              Objects{visible.length > MAX_ROWS && <span className="text-mist-faint">, highest confidence first (top {MAX_ROWS})</span>}
            </h3>
            <ul className="max-h-72 overflow-y-auto overscroll-contain pr-1">
              {visible.slice(0, MAX_ROWS).map((f) => {
                const p = f.properties;
                const active = selectedId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      className={`flex min-h-[36px] w-full items-center gap-3 rounded-md px-2 text-left text-[13px] ${
                        active ? "bg-petrol-700" : "hover:bg-petrol-800"
                      }`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: classColor(p.class_name) }} />
                      <span className="flex-1 truncate text-mist first-letter:uppercase">{p.class_name}</span>
                      <span className="font-mono text-xs text-mist-faint">{formatArea(p.area_m2)}</span>
                      <span className="w-10 text-right font-mono text-xs text-mist-muted">{(p.confidence * 100).toFixed(0)}%</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
