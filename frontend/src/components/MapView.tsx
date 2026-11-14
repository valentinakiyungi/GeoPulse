"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import maplibregl from "maplibre-gl";
import type { FilterSpecification, GeoJSONSource, Map as MlMap, Popup, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import type { AnalysisResult, Corners, LatLng } from "@/lib/types";
import { cornersBounds, cornersToLngLat, cornersValid, formatArea } from "@/lib/geo";

export type Basemap = "satellite" | "streets";

export interface MapHandle {
  /** Geographic position of the four corners of the current map viewport (TL, TR, BR, BL). */
  getViewCorners(): Corners | null;
  fitCorners(corners: Corners): void;
  flyTo(lat: number, lng: number): void;
}

interface MapViewProps {
  /** Imperative handle (passed as a prop because next/dynamic does not forward refs). */
  handleRef?: Ref<MapHandle>;
  result: AnalysisResult | null;
  hiddenClasses: string[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  corners: Corners | null;
  imageUrl: string | null;
  showImage: boolean;
  imageOpacity: number;
  basemap: Basemap;
}

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

// Free, token-less imagery: Esri World Imagery + reference labels, and OpenStreetMap.
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    labels: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
    },
    streets: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "streets", type: "raster", source: "streets", layout: { visibility: "none" } },
    { id: "satellite", type: "raster", source: "satellite" },
    { id: "labels", type: "raster", source: "labels" },
  ],
};

const DEFAULT_CENTER: [number, number] = [55.2752, 25.201]; // Downtown Dubai

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default function MapView(props: MapViewProps) {
  const { handleRef, result, hiddenClasses, selectedId, onSelect, corners, imageUrl, showImage, imageOpacity, basemap } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);

  onSelectRef.current = onSelect;

  // ------------------------------------------------------------- init / teardown
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: DEFAULT_CENTER,
      zoom: 15,
      pitch: 0,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      map.addSource("footprint", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "footprint-line",
        type: "line",
        source: "footprint",
        paint: { "line-color": "#fbbf24", "line-width": 2, "line-dasharray": [2, 2] },
      });

      map.addSource("detections", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "det-fill",
        type: "fill",
        source: "detections",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "det-line",
        type: "line",
        source: "detections",
        paint: { "line-color": ["get", "color"], "line-width": 1.5 },
      });
      map.addLayer({
        id: "det-selected",
        type: "line",
        source: "detections",
        filter: ["==", ["get", "id"], -1],
        paint: { "line-color": "#ffffff", "line-width": 3 },
      });

      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["det-fill"] })[0];
        onSelectRef.current(hit ? Number(hit.properties?.id) : null);
      });
      map.on("mouseenter", "det-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "det-fill", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
    });

    return () => {
      setReady(false);
      const popup = popupRef.current;
      popupRef.current = null;
      popup?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------- imperative API
  useImperativeHandle(handleRef, () => ({
    getViewCorners() {
      const map = mapRef.current;
      const el = container.current;
      if (!map || !el) return null;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const pts: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
      return pts.map(([x, y]) => {
        const ll = map.unproject([x, y]);
        return [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))] as LatLng;
      }) as Corners;
    },
    fitCorners(c: Corners) {
      if (!mapRef.current || !cornersValid(c)) return;
      mapRef.current.fitBounds(cornersBounds(c), { padding: 48, duration: 800, pitch: 0, bearing: 0 });
    },
    flyTo(lat: number, lng: number) {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 18), duration: 700 });
    },
  }));

  // ---------------------------------------------------------------- basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sat = basemap === "satellite" ? "visible" : "none";
    map.setLayoutProperty("satellite", "visibility", sat);
    map.setLayoutProperty("labels", "visibility", sat);
    map.setLayoutProperty("streets", "visibility", basemap === "streets" ? "visible" : "none");
  }, [basemap, ready]);

  // -------------------------------------------------------------- detections
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("detections") as GeoJSONSource).setData((result ?? EMPTY_FC) as FeatureCollection);
  }, [result, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const filter: FilterSpecification | null = hiddenClasses.length
      ? ["!", ["in", ["get", "class_name"], ["literal", hiddenClasses]]]
      : null;
    map.setFilter("det-fill", filter);
    map.setFilter("det-line", filter);
  }, [hiddenClasses, ready]);

  // Selection highlight + popup.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("det-selected", ["==", ["get", "id"], selectedId ?? -1]);
    const previous = popupRef.current;
    popupRef.current = null; // detach first so its "close" event doesn't clear the new selection
    previous?.remove();
    const feature = selectedId == null ? undefined : result?.features.find((f) => f.properties.id === selectedId);
    if (!feature) return;
    const p = feature.properties;
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 8 })
      .setLngLat([p.center_lng, p.center_lat])
      .setHTML(
        `<div class="gp-popup"><strong>${escapeHtml(p.class_name)}</strong>
         <div>Confidence: ${(p.confidence * 100).toFixed(1)}%</div>
         <div>Area: ${formatArea(p.area_m2)}</div>
         <div class="gp-mono">${p.center_lat.toFixed(6)}, ${p.center_lng.toFixed(6)}</div></div>`,
      )
      .addTo(map);
    popupRef.current = popup;
    popup.on("close", () => {
      if (popupRef.current === popup) {
        popupRef.current = null;
        onSelectRef.current(null);
      }
    });
  }, [selectedId, result, ready]);

  // ------------------------------------------------------- footprint outline
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data: FeatureCollection = cornersValid(corners)
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: [...cornersToLngLat(corners), cornersToLngLat(corners)[0]] },
            },
          ],
        }
      : EMPTY_FC;
    (map.getSource("footprint") as GeoJSONSource).setData(data);
  }, [corners, ready]);

  // ---------------------------------------------------------- image overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer("overlay")) map.removeLayer("overlay");
    if (map.getSource("overlay")) map.removeSource("overlay");
    if (!showImage || !imageUrl || !cornersValid(corners)) return;
    map.addSource("overlay", { type: "image", url: imageUrl, coordinates: cornersToLngLat(corners) });
    map.addLayer(
      {
        id: "overlay",
        type: "raster",
        source: "overlay",
        paint: { "raster-opacity": imageOpacity, "raster-fade-duration": 0 },
      },
      "footprint-line",
    );
    // imageOpacity is applied by the effect below; excluded here to avoid reloading the image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, corners, showImage, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("overlay")) return;
    map.setPaintProperty("overlay", "raster-opacity", imageOpacity);
  }, [imageOpacity, ready]);

  return <div ref={container} className="absolute inset-0" />;
}
