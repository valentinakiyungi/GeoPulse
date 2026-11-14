import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoPulse AI",
  description: "Detect objects in aerial and satellite imagery and see them on a live map as GeoJSON.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 font-sans antialiased">{children}</body>
    </html>
  );
}
