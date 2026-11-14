/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Docker image sets NEXT_STANDALONE=1 to get a self-contained server in .next/standalone.
  ...(process.env.NEXT_STANDALONE ? { output: "standalone" } : {}),
};

export default nextConfig;
