import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Silence the multiple-lockfiles workspace-root warning
  outputFileTracingRoot: path.join(__dirname),

  webpack: (config) => {
    // pdf-parse references a canvas module and test files that don't exist in Next.js
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },

  // Allow larger file uploads (10 MB)
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
