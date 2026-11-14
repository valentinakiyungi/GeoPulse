"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, ChevronUp, Loader2, Map as MapIcon, Satellite, ScanSearch, Square } from "lucide-react";

import BackendStatus from "@/components/BackendStatus";
import CornerEditor from "@/components/CornerEditor";
import ImageInput from "@/components/ImageInput";
import JobHistory from "@/components/JobHistory";
import ResultsPanel from "@/components/ResultsPanel";
import SurveyFrame from "@/components/SurveyFrame";
import type { Basemap, MapHandle, ScreenRect } from "@/components/MapView";
import { getJob, readGeoReference, submitAnalysis, waitForJob } from "@/lib/api";
import { cornersValid, downloadJson, withColors } from "@/lib/geo";
import type { AnalysisResult, Corners } from "@/lib/types";

// MapLibre needs `window`, so the map is rendered on the client only.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-petrol-900" />,
});

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "queued"; position?: number }
  | { kind: "processing" }
  | { kind: "error"; message: string };

type Snap = "peek" | "half" | "full";
const SNAP_HEIGHT: Record<Snap, string> = { peek: "8.75rem", half: "56%", full: "calc(100% - 0.5rem)" };

const BROWSER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];
const MAP_TOP_CLEARANCE = 64; // keeps the frame clear of the map's top controls
const DESKTOP_QUERY = "(min-width: 1024px)";

function isTiff(file: File) {
  return file.type === "image/tiff" || /\.tiff?$/i.test(file.name);
}

/** Rough check that the corner quad has the same aspect ratio as the image. */
function aspectMismatch(corners: Corners | null, dims: { width: number; height: number } | null): boolean {
  if (!cornersValid(corners) || !dims) return false;
  const lat0 = corners.reduce((s, c) => s + c[0], 0) / 4;
  const toM = ([lat, lng]: [number, number]) => [lng * 111_320 * Math.cos((lat0 * Math.PI) / 180), lat * 110_540];
  const [tl, tr, br, bl] = corners.map(toM);
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const geoAspect = (dist(tl, tr) + dist(bl, br)) / (dist(tl, bl) + dist(tr, br));
  const ratio = geoAspect / (dims.width / dims.height);
  return ratio > 1.2 || ratio < 1 / 1.2;
}

function PulseMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden>
      <circle cx="16" cy="16" r="14" fill="none" stroke="#1E4C58" strokeWidth="2" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#5ED1C4" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.5" fill="#FF8A3D" />
      <path d="M16 0v6M16 26v6M0 16h6M26 16h6" stroke="#8FB0AE" strokeWidth="2" />
    </svg>
  );
}

export default function Dashboard() {
  const mapRef = useRef<MapHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  // ----------------------------------------------------------------- state
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [corners, setCorners] = useState<Corners | null>(null);
  const [cornerSource, setCornerSource] = useState<string | null>(null);
  const [framing, setFraming] = useState(false);

  const [confidence, setConfidence] = useState(0.25);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [resultName, setResultName] = useState("geopulse");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const [hiddenClasses, setHiddenClasses] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showImage, setShowImage] = useState(true);
  const [imageOpacity, setImageOpacity] = useState(0.85);
  const [basemap, setBasemap] = useState<Basemap>("satellite");

  // ---------------------------------------------------- layout measurement
  const [isDesktop, setIsDesktop] = useState(true);
  const [snap, setSnap] = useState<Snap>("half");
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0, overlap: 0 });

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const measure = useCallback(() => {
    const mapEl = mapBoxRef.current;
    const sheetEl = sheetRef.current;
    if (!mapEl) return;
    const m = mapEl.getBoundingClientRect();
    let overlap = 0;
    if (sheetEl) {
      const s = sheetEl.getBoundingClientRect();
      const sideBySide = s.right <= m.left + 1 || s.left >= m.right - 1;
      if (!sideBySide) overlap = Math.max(0, m.bottom - s.top);
    }
    setBox((b) => (b.w === m.width && b.h === m.height && b.overlap === overlap ? b : { w: m.width, h: m.height, overlap }));
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (mapBoxRef.current) ro.observe(mapBoxRef.current);
    if (sheetRef.current) ro.observe(sheetRef.current);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const fitPadding = useMemo(
    () => ({ top: MAP_TOP_CLEARANCE, bottom: box.overlap + 24, left: 24, right: 24 }),
    [box.overlap],
  );

  /** The on-screen survey frame: the image's aspect ratio, fitted to the visible map area. */
  const frameRect: ScreenRect | null = useMemo(() => {
    const availW = box.w - 32;
    const availH = box.h - box.overlap - MAP_TOP_CLEARANCE - 24;
    if (availW < 40 || availH < 40) return null;
    const aspect = dims ? dims.width / dims.height : availW / availH;
    let width = availW;
    let height = width / aspect;
    if (height > availH) {
      height = availH;
      width = height * aspect;
    }
    return {
      x: Math.round((box.w - width) / 2),
      y: Math.round(MAP_TOP_CLEARANCE + (availH - height) / 2),
      width: Math.round(width),
      height: Math.round(height),
    };
  }, [box, dims]);

  // ------------------------------------------------------------- lifecycle
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!framing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFraming(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [framing]);

  const busy = phase.kind === "uploading" || phase.kind === "queued" || phase.kind === "processing";

  const setCornersFrom = useCallback((c: Corners | null, source: string | null) => {
    setCorners(c);
    setCornerSource(c ? source : null);
  }, []);

  const startFraming = () => {
    setFraming(true);
    if (!isDesktop) setSnap("peek");
  };

  const confirmFrame = () => {
    if (!frameRect) return;
    const c = mapRef.current?.getCornersForRect(frameRect);
    if (!c) return;
    setCornersFrom(c, "the map frame");
    setFraming(false);
    if (!isDesktop) setSnap("half");
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setResult(null);
    setSelectedId(null);
    setActiveJobId(null);
    setPhase({ kind: "idle" });
    setNotice(null);
    setDims(null);
    setCornersFrom(null, null);

    const previewable = BROWSER_IMAGE_TYPES.includes(f.type);
    const url = previewable ? URL.createObjectURL(f) : null;
    setImageUrl(url);
    if (url) {
      const img = new Image();
      img.onload = () => setDims({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = url;
    }

    if (isTiff(f)) {
      try {
        const ref = await readGeoReference(f);
        if (ref.width && ref.height) setDims({ width: ref.width, height: ref.height });
        if (ref.corners && ref.corners.length === 4) {
          const c = ref.corners as Corners;
          setCornersFrom(c, `the GeoTIFF (${ref.crs ?? "WGS84"})`);
          setFraming(false);
          mapRef.current?.fitCorners(c);
          setNotice("Location read from the GeoTIFF. Browsers can't display TIFFs, so there's no image preview on the map.");
          return;
        }
        setNotice(`This TIFF has no usable location (${ref.reason ?? "unknown reason"}). Frame it on the map instead.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    }
    startFraming();
  };

  const runAnalysis = async () => {
    if (!file || !cornersValid(corners)) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase({ kind: "uploading" });
    setResult(null);
    setSelectedId(null);
    setHiddenClasses([]);
    try {
      const { job_id } = await submitAnalysis(file, corners, confidence);
      setActiveJobId(job_id);
      setHistoryKey((k) => k + 1);
      const job = await waitForJob(job_id, {
        signal: controller.signal,
        onUpdate: (j) =>
          setPhase(j.status === "PENDING" ? { kind: "queued", position: j.queue_position } : { kind: "processing" }),
      });
      if (job.status === "FAILED" || !job.data) {
        setPhase({ kind: "error", message: job.error ?? "The analysis failed without an error message." });
      } else {
        setResult(withColors(job.data));
        setResultName(file.name.replace(/\.[^.]+$/, ""));
        setPhase({ kind: "idle" });
        mapRef.current?.fitCorners(corners);
        if (!isDesktop) setSnap("half");
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setHistoryKey((k) => k + 1);
    }
  };

  const stopWaiting = () => {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  };

  const openJob = async (jobId: string) => {
    try {
      const job = await getJob(jobId);
      if (!job.data) return;
      const c = job.data.metadata.corners as Corners;
      setResult(withColors(job.data));
      setResultName((job.meta.filename ?? "geopulse").replace(/\.[^.]+$/, ""));
      setActiveJobId(jobId);
      setSelectedId(null);
      setHiddenClasses([]);
      setFile(null);
      setImageUrl(null);
      setDims(job.data.metadata.frame_dimensions);
      setNotice(null);
      setFraming(false);
      setCornersFrom(c, "a saved analysis");
      mapRef.current?.fitCorners(c);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const selectFeature = (id: number | null) => {
    setSelectedId(id);
    if (id == null || !result) return;
    const f = result.features.find((x) => x.properties.id === id);
    if (f) mapRef.current?.flyTo(f.properties.center_lat, f.properties.center_lng);
  };

  // ------------------------------------------------------ bottom-sheet drag
  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sheetRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: sheetRef.current.offsetHeight, moved: false };
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    const parentH = sheetRef.current?.parentElement?.clientHeight ?? 0;
    if (!d || !parentH) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setDragHeight(Math.min(parentH - 8, Math.max(96, d.startH + dy)));
  };
  const onHandleUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const parentH = sheetRef.current?.parentElement?.clientHeight ?? 0;
    if (!d) return;
    if (!d.moved || dragHeight == null || !parentH) {
      setDragHeight(null);
      setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));
      return;
    }
    const targets: [Snap, number][] = [
      ["peek", 140],
      ["half", parentH * 0.56],
      ["full", parentH - 8],
    ];
    const nearest = targets.reduce((a, b) => (Math.abs(b[1] - dragHeight) < Math.abs(a[1] - dragHeight) ? b : a));
    setSnap(nearest[0]);
    setDragHeight(null);
  };

  // ---------------------------------------------------------------- render
  const mismatch = useMemo(() => !framing && aspectMismatch(corners, dims), [framing, corners, dims]);
  const canRun = !!file && cornersValid(corners) && !busy && !framing;

  const statusText =
    phase.kind === "uploading"
      ? "Uploading the image"
      : phase.kind === "queued"
        ? `Waiting in the queue${phase.position ? ` (position ${phase.position})` : ""}`
        : phase.kind === "processing"
          ? "Finding objects and placing them on the map. The first run also downloads the model."
          : null;

  const sheetSummary = busy
    ? "Analysis running"
    : framing
      ? "Line the image area up in the frame"
      : result
        ? `${result.metadata.total_detections.toLocaleString()} ${result.metadata.total_detections === 1 ? "object" : "objects"} found`
        : file
          ? "Ready when the area is set"
          : "Start with an image";

  const sheetHeight = dragHeight != null ? `${dragHeight}px` : SNAP_HEIGHT[snap];

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-petrol-950 text-mist">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-petrol-700 px-4 py-2.5 lg:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <PulseMark />
          <div className="min-w-0">
            <h1 className="wordmark text-xl font-bold leading-none text-mist">GeoPulse</h1>
            <p className="mt-1 hidden truncate text-xs text-mist-muted sm:block">
              Find objects in aerial imagery and see exactly where they are
            </p>
          </div>
        </div>
        <BackendStatus />
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar on desktop, bottom sheet on phones and tablets. */}
        <aside
          ref={sheetRef}
          style={{ "--sheet-h": sheetHeight } as CSSProperties}
          onTransitionEnd={measure}
          className={`absolute inset-x-0 bottom-0 z-20 flex h-[var(--sheet-h)] flex-col rounded-t-2xl border-t border-petrol-600 bg-petrol-900 shadow-[0_-16px_40px_rgba(4,18,22,0.55)] ${
            dragHeight == null ? "transition-[height] duration-300 ease-out" : ""
          } lg:static lg:z-auto lg:h-auto lg:w-[400px] lg:shrink-0 lg:rounded-none lg:border-r lg:border-t-0 lg:shadow-none`}
        >
          <button
            type="button"
            className="flex w-full shrink-0 touch-none select-none flex-col items-center gap-2 px-4 pb-2 pt-2.5 lg:hidden"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            aria-label={`Panel: ${sheetSummary}. Tap to resize.`}
          >
            <span className="h-1 w-10 rounded-full bg-petrol-600" />
            <span className="flex w-full items-center justify-between text-sm font-medium text-mist">
              <span className="flex items-center gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin text-marker" />}
                {sheetSummary}
              </span>
              <ChevronUp className={`h-4 w-4 text-mist-muted transition-transform ${snap === "full" ? "rotate-180" : ""}`} />
            </span>
          </button>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-petrol-700 pb-[env(safe-area-inset-bottom)] lg:border-t-0"
          >
            <section className="section">
              <h2 className="section-title">
                <span className="step">1</span> Image
              </h2>
              <ImageInput file={file} dims={dims} onFile={handleFile} disabled={busy} />
              {notice && <p className="mt-2.5 text-[13px] leading-relaxed text-mist-muted">{notice}</p>}
            </section>

            <section className="section">
              <h2 className="section-title">
                <span className="step">2</span> Location
              </h2>
              <CornerEditor
                corners={corners}
                source={cornerSource}
                framing={framing}
                onChange={setCornersFrom}
                onFrame={startFraming}
                onFitMap={() => corners && mapRef.current?.fitCorners(corners)}
              />
              {mismatch && (
                <p className="mt-3 flex gap-2 text-[13px] leading-relaxed text-marker">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  This area has different proportions from the image, so detections will be stretched. Reframe it on
                  the map to fix this.
                </p>
              )}
            </section>

            <section className="section">
              <h2 className="section-title">
                <span className="step">3</span> Detect
              </h2>
              <label htmlFor="confidence" className="mb-1.5 flex justify-between text-[13px] text-mist-muted">
                <span>Minimum confidence</span>
                <span className="font-mono text-mist">{Math.round(confidence * 100)}%</span>
              </label>
              <input
                id="confidence"
                type="range"
                min={0.05}
                max={0.9}
                step={0.05}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="h-6 w-full"
                disabled={busy}
              />
              <p className="mb-3 text-xs text-mist-faint">Lower it to find more objects, raise it to keep only sure ones.</p>
              {busy ? (
                <button type="button" onClick={stopWaiting} className="btn-secondary w-full">
                  <Square className="h-4 w-4" /> Stop waiting
                </button>
              ) : (
                <button type="button" onClick={runAnalysis} disabled={!canRun} className="btn-primary w-full">
                  <ScanSearch className="h-4 w-4" /> Run analysis
                </button>
              )}
              {!busy && !canRun && (
                <p className="mt-2 text-[13px] text-mist-faint">
                  {!file ? "Choose an image first." : framing ? "Set the area on the map first." : "Set the image's location first."}
                </p>
              )}
              {statusText && (
                <p className="mt-3 flex gap-2 text-[13px] leading-relaxed text-mist">
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-marker" /> {statusText}
                </p>
              )}
              {phase.kind === "error" && (
                <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-alert/40 bg-alert/10 p-3 text-[13px] leading-relaxed text-mist">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-alert" /> {phase.message}
                </p>
              )}
            </section>

            {result && (
              <section ref={resultsRef} className="section scroll-mt-2">
                <h2 className="section-title">Results</h2>
                <ResultsPanel
                  result={result}
                  hiddenClasses={hiddenClasses}
                  onToggleClass={(name) =>
                    setHiddenClasses((h) => (h.includes(name) ? h.filter((x) => x !== name) : [...h, name]))
                  }
                  selectedId={selectedId}
                  onSelect={selectFeature}
                  onDownload={() => downloadJson(result, `${resultName}.geojson`)}
                />
              </section>
            )}

            <section className="section">
              <h2 className="section-title">Recent analyses</h2>
              <JobHistory refreshKey={historyKey} activeJobId={activeJobId} onOpen={openJob} />
            </section>
          </div>
        </aside>

        <div ref={mapBoxRef} className="relative min-w-0 flex-1">
          <MapView
            handleRef={mapRef}
            fitPadding={fitPadding}
            result={result}
            hiddenClasses={hiddenClasses}
            selectedId={selectedId}
            onSelect={setSelectedId}
            corners={framing ? null : corners}
            imageUrl={imageUrl}
            showImage={showImage}
            imageOpacity={imageOpacity}
            basemap={basemap}
          />

          {framing && frameRect && <SurveyFrame rect={frameRect} dims={dims} />}

          <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
            <div className="map-chip flex overflow-hidden text-[13px]" role="group" aria-label="Base map">
              {(
                [
                  ["satellite", "Satellite", Satellite],
                  ["streets", "Streets", MapIcon],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={basemap === key}
                  onClick={() => setBasemap(key)}
                  className={`flex min-h-[36px] items-center gap-1.5 px-3 ${
                    basemap === key ? "bg-petrol-700 text-mist" : "text-mist-muted hover:text-mist"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            {!framing && imageUrl && cornersValid(corners) && (
              <div className="map-chip px-3 py-2 text-[13px] text-mist">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} className="h-4 w-4 accent-marker" />
                  Show my image
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={imageOpacity}
                  onChange={(e) => setImageOpacity(Number(e.target.value))}
                  disabled={!showImage}
                  className="mt-1 w-36"
                  aria-label="Image opacity"
                />
              </div>
            )}
          </div>

          {framing && (
            <div
              className="absolute inset-x-3 z-20 flex justify-center transition-[bottom] duration-300"
              style={{ bottom: box.overlap + 12 }}
            >
              <div className="map-chip flex w-full max-w-md items-center gap-2 p-2">
                <p className="flex-1 px-1.5 text-[13px] leading-snug text-mist">Move and zoom until the image area fills the frame</p>
                <button type="button" onClick={() => setFraming(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="button" onClick={confirmFrame} disabled={!frameRect} className="btn-primary min-h-[40px] px-4">
                  Set area
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
