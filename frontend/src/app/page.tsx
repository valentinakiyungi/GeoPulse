"use client";

import { useState } from "react";
import MapView from "../components/MapView";
import axios from "axios";
import { Upload, Layers, Activity } from "lucide-react";

export default function Dashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [geoJsonResults, setGeoJsonResults] = useState<any | null>(null);
  const [metadata, setMetadata] = useState<any | null>(null);

  const handleUploadAndAnalyze = async () => {
    if (!file) return;
    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("top_left_gps", JSON.stringify([25.2048, 55.2708]));
    formData.append("bottom_right_gps", JSON.stringify([25.1972, 55.2796]));

    try {
      const initRes = await axios.post("http://localhost:8000/api/v1/vision/analyze", formData);
      const jobId = initRes.data.job_id;

      const interval = setInterval(async () => {
        const pollRes = await axios.get("http://localhost:8000/api/v1/vision/results/" + jobId);
        if (pollRes.data.status === "COMPLETED") {
          clearInterval(interval);
          setGeoJsonResults(pollRes.data.data);
          setMetadata(pollRes.data.data.metadata);
          setLoading(false);
        }
      }, 1500);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <header className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-400 flex items-center gap-2">
            <Layers className="w-6 h-6" /> GeoPulse AI Engine
          </h1>
          <p className="text-sm text-slate-400">
            Spatial Computer Vision & Smart City Analytics Engine
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          FastAPI & YOLOv8 Online
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-lg font-semibold mb-4 text-slate-200">Ingest Imagery</h2>
            <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500 transition rounded-xl p-6 text-center cursor-pointer">
              <input 
                type="file" 
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                accept="image/*"
                className="hidden" 
                id="file-input"
              />
              <label htmlFor="file-input" className="cursor-pointer space-y-2 block">
                <Upload className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-medium">{file ? file.name : "Select Satellite / Drone Frame"}</p>
                <p className="text-xs text-slate-500">Supports GeoTIFF, PNG, JPG</p>
              </label>
            </div>

            <button
              onClick={handleUploadAndAnalyze}
              disabled={!file || loading}
              className="mt-4 w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-medium py-2.5 rounded-lg transition text-sm flex justify-center items-center gap-2"
            >
              {loading ? <Activity className="w-4 h-4 animate-spin" /> : "Execute Vision Analytics"}
            </button>
          </div>

          {metadata && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-lg font-semibold mb-3 text-slate-200">Detection Summary</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <p className="text-xs text-slate-500">Total Detections</p>
                  <p className="text-xl font-bold text-emerald-400">{metadata.total_detections}</p>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <p className="text-xs text-slate-500">Resolution</p>
                  <p className="text-sm font-bold text-slate-300">
                    {metadata.frame_dimensions.width}x{metadata.frame_dimensions.height}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-8">
          <MapView geoJsonData={geoJsonResults} />
        </div>
      </div>
    </main>
  );
}
