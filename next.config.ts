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
    '*.run.app',
    '*.europe-west1.run.app',
    '*.europe-west3.run.app',
    'localhost:3000',
    '0.0.0.0:3000',
  ],
};
export default nextConfig;
