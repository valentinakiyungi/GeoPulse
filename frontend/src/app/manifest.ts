import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GeoPulse",
    short_name: "GeoPulse",
    description: "Find objects in aerial imagery and see exactly where they are on the map.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B2229",
    theme_color: "#0B2229",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
