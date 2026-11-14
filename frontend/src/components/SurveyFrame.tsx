"use client";

import type { ScreenRect } from "@/components/MapView";

interface Props {
  rect: ScreenRect;
  dims: { width: number; height: number } | null;
}

/** The orange frame the user lines the image area up inside. Purely visual: clicks pass through to the map. */
export default function SurveyFrame({ rect, dims }: Props) {
  const tick = "absolute h-5 w-5 border-marker";
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {/* Dim everything outside the frame. */}
      <div
        className="absolute rounded-[2px]"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgba(11, 34, 41, 0.45)",
          outline: "1.5px dashed rgba(255, 138, 61, 0.9)",
          outlineOffset: "-1px",
        }}
      >
        <span className={`${tick} -left-1 -top-1 border-l-[3px] border-t-[3px]`} />
        <span className={`${tick} -right-1 -top-1 border-r-[3px] border-t-[3px]`} />
        <span className={`${tick} -bottom-1 -right-1 border-b-[3px] border-r-[3px]`} />
        <span className={`${tick} -bottom-1 -left-1 border-b-[3px] border-l-[3px]`} />
        {/* Centre crosshair */}
        <span className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-marker/80" />
        <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-marker/80" />
        {dims && (
          <span className="absolute -top-7 left-0 rounded bg-marker px-1.5 py-0.5 font-mono text-[11px] font-medium text-marker-ink">
            {dims.width} × {dims.height} px
          </span>
        )}
      </div>
    </div>
  );
}
