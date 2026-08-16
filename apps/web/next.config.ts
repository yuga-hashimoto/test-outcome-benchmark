import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /** Workspace packages ship TypeScript source, so Next compiles them itself. */
  transpilePackages: ['@tob/core', '@tob/db', '@tob/providers', '@tob/runner'],
  /** better-sqlite3 is a native module and must not be bundled. */
  serverExternalPackages: ['better-sqlite3'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
