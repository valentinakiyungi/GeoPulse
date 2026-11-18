/** @type {import('next').NextConfig} */

// GITHUB_PAGES=true builds a fully static site into ./out (see .github/workflows/deploy-pages.yml).
const isPages = process.env.GITHUB_PAGES === "true";
// Project sites live under /<repo-name>, e.g. https://user.github.io/GeoPulse.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (isPages ? "/GeoPulse" : "");

const nextConfig = {
  reactStrictMode: true,
  ...(basePath ? { basePath } : {}),
  ...(isPages ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : {}),
  // The Docker image sets NEXT_STANDALONE=1 to get a self-contained server in .next/standalone.
  ...(process.env.NEXT_STANDALONE ? { output: "standalone" } : {}),
  env: { GEOPULSE_BASE_PATH: basePath },
};

export default nextConfig;
