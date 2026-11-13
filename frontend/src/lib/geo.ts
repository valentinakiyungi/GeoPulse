import type { AnalysisResult, Corners, LatLng } from "./types";

// Bright enough to read over satellite imagery; orange is kept back for the image footprint.
const PALETTE = [
  "#5ED1C4", "#F7E05B", "#FF6FA8", "#7CC0FF", "#B8F26B", "#C79BFF",
  "#FFB4E1", "#54E8A0", "#FFD0A0", "#9FE7FF", "#E9F57A", "#FF8FA0",
];

/** Stable colour per class name. */
export function classColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Attach a colour to every feature so the map can style by class. */
export function withColors(result: AnalysisResult): AnalysisResult {
  return {
    ...result,
    features: result.features.map((f) => ({
      ...f,
      properties: { ...f.properties, color: classColor(f.properties.class_name) },
    })),
  };
}

export function isValidLatLng([lat, lng]: LatLng): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function cornersValid(c: Corners | null): c is Corners {
  if (!c || c.length !== 4 || !c.every(isValidLatLng)) return false;
  // Reject degenerate quads (zero area).
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [y1, x1] = c[i];
    const [y2, x2] = c[(i + 1) % 4];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) > 1e-12;
}

/** Corners as [lng, lat] for MapLibre image sources / GeoJSON. */
export function cornersToLngLat(c: Corners): [[number, number], [number, number], [number, number], [number, number]] {
  return c.map(([lat, lng]) => [lng, lat]) as [[number, number], [number, number], [number, number], [number, number]];
}

export function cornersBounds(c: Corners): [[number, number], [number, number]] {
  const lats = c.map((p) => p[0]);
  const lngs = c.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha`;
  return `${m2.toFixed(m2 < 10 ? 1 : 0)} m²`;
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
