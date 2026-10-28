import type { NextConfig } from "next";

/** Silicon Hills moved to its own repo and deployment: github.com/abhidotbandi/silicon-hills-atlas. */
const ATLAS_URL = "https://silicon-hills.vercel.app";

const nextConfig: NextConfig = {
  // Old /atlas links, deep links included (query strings carry over), go to the atlas's new home.
  async redirects() {
    return [
      { source: "/atlas", destination: `${ATLAS_URL}/atlas`, permanent: false },
      { source: "/atlas/:path*", destination: `${ATLAS_URL}/atlas/:path*`, permanent: false },
    ];
  },
};

export default nextConfig;
