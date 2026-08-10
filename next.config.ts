import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: [
    'ais-dev-67hlqsp5cnmy3xifm7muz4-208615452127.europe-west2.run.app',
    'ais-pre-67hlqsp5cnmy3xifm7muz4-208615452127.europe-west2.run.app',
    '*.europe-west2.run.app',
    '*.run.app',
  ],
};
export default nextConfig;
