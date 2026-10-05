import type { NextConfig } from "next";

import path from "path";

// Side effect: throws (fails the build) when a pilot build has API mocking on.
import "./lib/pilot-scope";

const nextConfig: NextConfig = {
  transpilePackages: ["@rescom/schemas"],
  turbopack: {
    root: path.resolve(__dirname, "../../.."),
  },
  async rewrites() {
    const apiBaseUrl = process.env.RESCOM_API_URL ?? "http://localhost:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
};

export default nextConfig;
