import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackBuildWorker: false,
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  allowedDevOrigins: [
    'ais-dev-ypmwpx3fedypwckng2sfii-280445036461.europe-west3.run.app',
    'ais-pre-ypmwpx3fedypwckng2sfii-280445036461.europe-west3.run.app',
    'localhost:3000',
  ],
};
export default nextConfig;
