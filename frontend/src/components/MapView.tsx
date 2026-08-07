"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

interface MapViewProps {
  geoJsonData: any | null;
}

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "pk.eyJ1IjoibWFwYm94Y2xpZW50IiwiYSI6ImNsd3F1eXN6bDBpNzEya3BoYnY0ZjZmbzMifQ.sample";

export default function MapView({ geoJsonData }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [55.2742, 25.2010],
      zoom: 15,
      pitch: 45
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
  }, []);

  useEffect(() => {
    if (!map.current || !geoJsonData) return;

    const sourceId = "geopulse-detections-source";
    const layerId = "geopulse-detections-layer";

    if (map.current.getSource(sourceId)) {
      (map.current.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geoJsonData);
    } else {
      map.current.addSource(sourceId, {
        type: "geojson",
        data: geoJsonData
      });

      map.current.addLayer({
        id: layerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#00FF66",
          "fill-opacity": 0.4
        }
      });

      map.current.addLayer({
        id: `${layerId}-stroke`,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#00FF66",
          "line-width": 2
        }
      });
    }
  }, [geoJsonData]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-[85vh] rounded-xl overflow-hidden border border-slate-800" />
    </div>
  );
}
