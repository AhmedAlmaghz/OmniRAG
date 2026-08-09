import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
};
export default nextConfig;
