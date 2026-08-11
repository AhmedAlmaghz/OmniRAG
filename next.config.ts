import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
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
