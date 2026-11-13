import type { Feature, FeatureCollection, Polygon } from "geojson";

/** [lat, lng] */
export type LatLng = [number, number];
/** Top-left, top-right, bottom-right, bottom-left. */
export type Corners = [LatLng, LatLng, LatLng, LatLng];

export interface DetectionProperties {
  id: number;
  class_name: string;
  confidence: number;
  center_lat: number;
  center_lng: number;
  area_m2: number;
  pixel_bbox: [number, number, number, number];
  oriented: boolean;
  color?: string;
}

export type DetectionFeature = Feature<Polygon, DetectionProperties>;

export interface AnalysisMetadata {
  total_detections: number;
  class_counts: Record<string, number>;
  mean_confidence: number | null;
  frame_dimensions: { width: number; height: number };
  corners: LatLng[];
  footprint: Polygon;
  footprint_area_m2: number;
  ground_sample_distance_m: number;
  processing_seconds: number;
}

export interface AnalysisResult extends FeatureCollection<Polygon, DetectionProperties> {
  metadata: AnalysisMetadata;
}

export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Job {
  job_id: string;
  status: JobStatus;
  created_at: number;
  updated_at: number;
  queue_position?: number;
  error?: string;
  data?: AnalysisResult;
  meta: { filename?: string; size_bytes?: number; georef_source?: string };
}

export interface Health {
  status: string;
  version: string;
  model: { weights: string; loaded: boolean; error: string | null };
}

export interface GeoRefResponse {
  corners: LatLng[] | null;
  width: number | null;
  height: number | null;
  crs: string | null;
  reason: string | null;
}
