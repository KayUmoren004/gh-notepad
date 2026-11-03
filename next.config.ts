import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

// Keeps esbuild, which bundles the service worker (app/serwist/[path]/route.ts), out of the server bundle.
export default withSerwist(nextConfig);
