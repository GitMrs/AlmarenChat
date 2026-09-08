import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  serverExternalPackages: ['@earendil-works/pi-coding-agent', '@prisma/adapter-better-sqlite3', 'better-sqlite3'],
};

export default nextConfig;
