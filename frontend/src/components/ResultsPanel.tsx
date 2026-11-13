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

export default function ResultsPanel({ result, hiddenClasses, onToggleClass, selectedId, onSelect, onDownload }: Props) {
  const md = result.metadata;
  const visible = result.features.filter((f) => !hiddenClasses.includes(f.properties.class_name));

  const stats = [
    { label: "Detections", value: md.total_detections.toLocaleString() },
    { label: "Mean confidence", value: md.mean_confidence != null ? `${(md.mean_confidence * 100).toFixed(1)}%` : "—" },
    { label: "Ground resolution", value: `${md.ground_sample_distance_m < 1 ? (md.ground_sample_distance_m * 100).toFixed(1) + " cm" : md.ground_sample_distance_m.toFixed(2) + " m"}/px` },
    { label: "Area covered", value: formatArea(md.footprint_area_m2) },
    { label: "Frame", value: `${md.frame_dimensions.width}×${md.frame_dimensions.height}` },
    { label: "Processing", value: `${md.processing_seconds.toFixed(2)} s` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{s.label}</p>
            <p className="font-mono text-sm text-slate-100">{s.value}</p>
          </div>
        ))}
      </div>

      {md.total_detections === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
          No objects found. Try lowering the confidence threshold, or check that the image is a top-down aerial
          view. The default model detects DOTA classes such as vehicles, planes, ships, storage tanks and pools.
        </p>
      ) : (
        <>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">Classes</p>
            <ul className="space-y-1">
              {Object.entries(md.class_counts).map(([name, count]) => {
                const hidden = hiddenClasses.includes(name);
                return (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => onToggleClass(name)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-800/60"
                    >
                      <span className="h-3 w-3 rounded-sm" style={{ background: classColor(name), opacity: hidden ? 0.25 : 1 }} />
                      <span className={`flex-1 capitalize ${hidden ? "text-slate-600 line-through" : "text-slate-200"}`}>{name}</span>
                      <span className="font-mono text-xs text-slate-400">{count}</span>
                      {hidden ? <EyeOff className="h-3.5 w-3.5 text-slate-600" /> : <Eye className="h-3.5 w-3.5 text-slate-500" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">
              Objects {visible.length > MAX_ROWS && <span className="text-slate-600">(top {MAX_ROWS})</span>}
            </p>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
              {visible.slice(0, MAX_ROWS).map((f) => {
                const p = f.properties;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${
                        selectedId === p.id ? "bg-slate-700/70" : "hover:bg-slate-800/60"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: classColor(p.class_name) }} />
                      <span className="flex-1 truncate capitalize text-slate-300">{p.class_name}</span>
                      <span className="font-mono text-slate-500">{formatArea(p.area_m2)}</span>
                      <span className="w-12 text-right font-mono text-slate-400">{(p.confidence * 100).toFixed(0)}%</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <button type="button" onClick={onDownload} className="btn-secondary w-full">
        <Download className="h-3.5 w-3.5" /> Download GeoJSON
      </button>
    </div>
  );
}
