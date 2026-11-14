"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Layers, Loader2, Map as MapIcon, Satellite, ScanSearch, Square } from "lucide-react";

import BackendStatus from "@/components/BackendStatus";
import CornerEditor from "@/components/CornerEditor";
import ImageInput from "@/components/ImageInput";
import JobHistory from "@/components/JobHistory";
import ResultsPanel from "@/components/ResultsPanel";
import type { Basemap, MapHandle } from "@/components/MapView";
import { ApiError, getJob, readGeoReference, submitAnalysis, waitForJob } from "@/lib/api";
import { cornersValid, downloadJson, withColors } from "@/lib/geo";
import type { AnalysisResult, Corners } from "@/lib/types";

// MapLibre needs `window`, so the map is rendered on the client only.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-slate-900" />,
});

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "queued"; position?: number }
  | { kind: "processing" }
  | { kind: "error"; message: string };

const BROWSER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];

function isTiff(file: File) {
  return file.type === "image/tiff" || /\.tiff?$/i.test(file.name);
}

/** Rough check that the corner quad has the same aspect ratio as the image. */
function aspectMismatch(corners: Corners | null, dims: { width: number; height: number } | null): boolean {
  if (!cornersValid(corners) || !dims) return false;
  const toM = ([lat, lng]: [number, number], lat0: number) => [lng * 111_320 * Math.cos((lat0 * Math.PI) / 180), lat * 110_540];
  const lat0 = corners.reduce((s, c) => s + c[0], 0) / 4;
  const [tl, tr, br, bl] = corners.map((c) => toM(c, lat0));
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const geoAspect = (dist(tl, tr) + dist(bl, br)) / (dist(tl, bl) + dist(tr, br));
  const imgAspect = dims.width / dims.height;
  const ratio = geoAspect / imgAspect;
  return ratio > 1.2 || ratio < 1 / 1.2;
}

export default function Dashboard() {
  const mapRef = useRef<MapHandle>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [corners, setCorners] = useState<Corners | null>(null);
  const [cornerSource, setCornerSource] = useState<string | null>(null);

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

  const busy = phase.kind === "uploading" || phase.kind === "queued" || phase.kind === "processing";

  // Release object URLs and stop polling on unmount / change.
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const setCornersFrom = useCallback((c: Corners | null, source: string | null) => {
    setCorners(c);
    setCornerSource(c ? source : null);
  }, []);

  const handleFile = useCallback(
    async (f: File) => {
      setFile(f);
      setResult(null);
      setSelectedId(null);
      setActiveJobId(null);
      setPhase({ kind: "idle" });
      setNotice(null);
      setDims(null);

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
            setCornersFrom(c, `GeoTIFF (${ref.crs ?? "WGS84"})`);
            mapRef.current?.fitCorners(c);
            setNotice("Geo-reference read from the GeoTIFF. The map preview overlay isn't available for TIFF files.");
          } else {
            setNotice(`No usable geo-reference in this TIFF: ${ref.reason ?? "unknown"} Set the corners below.`);
          }
        } catch (err) {
          setNotice(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [setCornersFrom],
  );

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
        setPhase({ kind: "error", message: job.error ?? "Analysis failed." });
      } else {
        setResult(withColors(job.data));
        setResultName(file.name.replace(/\.[^.]+$/, ""));
        setPhase({ kind: "idle" });
        mapRef.current?.fitCorners(corners);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase({ kind: "error", message: err instanceof ApiError || err instanceof Error ? err.message : String(err) });
    } finally {
      setHistoryKey((k) => k + 1);
    }
  };

  const cancel = () => {
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
      setCornersFrom(c, "saved analysis");
      mapRef.current?.fitCorners(c);
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

  const mismatch = useMemo(() => aspectMismatch(corners, dims), [corners, dims]);
  const canRun = !!file && cornersValid(corners) && !busy;

  const statusText =
    phase.kind === "uploading"
      ? "Uploading image…"
      : phase.kind === "queued"
        ? `Queued${phase.position ? ` (position ${phase.position})` : ""}…`
        : phase.kind === "processing"
          ? "Detecting objects and projecting to GPS… (the first run also downloads the model)"
          : null;

  return (
    <main className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-emerald-400">
            <Layers className="h-5 w-5" /> GeoPulse AI
          </h1>
          <p className="text-xs text-slate-400">Aerial object detection, projected onto the map</p>
        </div>
        <BackendStatus />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 space-y-4 overflow-y-auto border-slate-800 p-4 lg:w-[380px] lg:border-r">
          <section className="panel">
            <h2 className="panel-title">1 · Image</h2>
            <ImageInput file={file} dims={dims} onFile={handleFile} disabled={busy} />
            {notice && <p className="mt-2 text-xs text-slate-400">{notice}</p>}
          </section>

          <section className="panel">
            <h2 className="panel-title">2 · Geo-reference</h2>
            <CornerEditor
              corners={corners}
              source={cornerSource}
              onChange={setCornersFrom}
              onUseMapView={() => {
                const c = mapRef.current?.getViewCorners();
                if (c) setCornersFrom(c, "map view");
              }}
              onFitMap={() => corners && mapRef.current?.fitCorners(corners)}
            />
            {mismatch && (
              <p className="mt-2 flex gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The corners don&apos;t match the image&apos;s aspect ratio, so results will be stretched. Resize the
                browser window or adjust the corners.
              </p>
            )}
          </section>

          <section className="panel">
            <h2 className="panel-title">3 · Detect</h2>
            <label className="mb-1 flex justify-between text-xs text-slate-400">
              <span>Confidence threshold</span>
              <span className="font-mono text-slate-200">{confidence.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0.05}
              max={0.9}
              step={0.05}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="w-full accent-emerald-500"
              disabled={busy}
            />
            {busy ? (
              <button type="button" onClick={cancel} className="btn-secondary mt-3 w-full">
                <Square className="h-3.5 w-3.5" /> Stop waiting
              </button>
            ) : (
              <button type="button" onClick={runAnalysis} disabled={!canRun} className="btn-primary mt-3 w-full">
                <ScanSearch className="h-4 w-4" /> Run analysis
              </button>
            )}
            {!busy && !canRun && (
              <p className="mt-2 text-xs text-slate-500">
                {!file ? "Choose an image first." : "Set the image's corner coordinates first."}
              </p>
            )}
            {statusText && (
              <p className="mt-2 flex items-center gap-2 text-xs text-sky-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {statusText}
              </p>
            )}
            {phase.kind === "error" && (
              <p className="mt-2 flex gap-1.5 rounded-md border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {phase.message}
              </p>
            )}
          </section>

          {result && (
            <section className="panel">
              <h2 className="panel-title">Results</h2>
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

          <section className="panel">
            <h2 className="panel-title">Recent analyses</h2>
            <JobHistory refreshKey={historyKey} activeJobId={activeJobId} onOpen={openJob} />
          </section>
        </aside>

        <div className="relative min-h-[60vh] flex-1">
          <MapView
            handleRef={mapRef}
            result={result}
            hiddenClasses={hiddenClasses}
            selectedId={selectedId}
            onSelect={setSelectedId}
            corners={corners}
            imageUrl={imageUrl}
            showImage={showImage}
            imageOpacity={imageOpacity}
            basemap={basemap}
          />

          <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-700 bg-slate-900/90 text-xs backdrop-blur">
              <button
                type="button"
                onClick={() => setBasemap("satellite")}
                className={`flex items-center gap-1.5 px-3 py-1.5 ${basemap === "satellite" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                <Satellite className="h-3.5 w-3.5" /> Satellite
              </button>
              <button
                type="button"
                onClick={() => setBasemap("streets")}
                className={`flex items-center gap-1.5 px-3 py-1.5 ${basemap === "streets" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                <MapIcon className="h-3.5 w-3.5" /> Streets
              </button>
            </div>
            {imageUrl && cornersValid(corners) && (
              <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300 backdrop-blur">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} className="accent-emerald-500" />
                  Image overlay
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={imageOpacity}
                  onChange={(e) => setImageOpacity(Number(e.target.value))}
                  disabled={!showImage}
                  className="mt-1 w-36 accent-emerald-500"
                  aria-label="Overlay opacity"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
