import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a fully static site to `out/` — there is no server runtime at all,
  // so no file can ever be sent anywhere for processing.
  output: "export",
  // Emit `/tools/merge/index.html` so any static host resolves routes.
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
