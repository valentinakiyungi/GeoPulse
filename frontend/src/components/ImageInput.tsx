"use client";

import { useRef, useState } from "react";
import { ImageIcon, Upload } from "lucide-react";

interface Props {
  file: File | null;
  dims: { width: number; height: number } | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/tiff,.tif,.tiff,.jpg,.jpeg,.png,.webp,.bmp";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export default function ImageInput({ file, dims, onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !disabled) onFile(f);
      }}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition ${
        dragging ? "border-emerald-400 bg-emerald-500/5" : "border-slate-700 hover:border-emerald-500"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="space-y-1">
          <ImageIcon className="mx-auto h-7 w-7 text-emerald-400" />
          <p className="truncate text-sm font-medium text-slate-100">{file.name}</p>
          <p className="text-xs text-slate-500">
            {formatBytes(file.size)}
            {dims ? ` · ${dims.width}×${dims.height}px` : ""} · click to replace
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <Upload className="mx-auto h-7 w-7 text-slate-400" />
          <p className="text-sm font-medium text-slate-200">Drop a satellite or drone image</p>
          <p className="text-xs text-slate-500">JPEG · PNG · WebP · GeoTIFF (auto geo-referenced)</p>
        </div>
      )}
    </div>
  );
}
