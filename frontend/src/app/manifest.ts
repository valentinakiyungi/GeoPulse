import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = process.env.GEOPULSE_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GeoPulse",
    short_name: "GeoPulse",
    description: "Find objects in aerial imagery and see exactly where they are on the map.",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#0B2229",
    theme_color: "#0B2229",
    icons: [
      { src: `${base}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
