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
  const open = () => !disabled && inputRef.current?.click();

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={file ? `Replace image ${file.name}` : "Choose an image"}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
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
      className={`flex cursor-pointer items-center gap-3.5 rounded-xl border border-dashed p-4 transition-colors ${
        dragging ? "border-marker bg-marker/10" : "border-petrol-600 bg-petrol-950/40 hover:border-mist-faint"
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
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${file ? "bg-marker/15 text-marker" : "bg-petrol-800 text-mist-muted"}`}
      >
        {file ? <ImageIcon className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
      </span>
      {file ? (
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-mist">{file.name}</span>
          <span className="block text-xs text-mist-faint">
            {formatBytes(file.size)}
            {dims ? `, ${dims.width} × ${dims.height} px` : ""}. Tap to replace.
          </span>
        </span>
      ) : (
        <span className="min-w-0">
          <span className="block text-sm font-medium text-mist">Choose a satellite or drone image</span>
          <span className="block text-xs text-mist-faint">JPEG, PNG, WebP or GeoTIFF. You can also drop it here.</span>
        </span>
      )}
    </div>
  );
}
