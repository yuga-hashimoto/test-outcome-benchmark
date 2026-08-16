import type { NextConfig } from 'next';

/**
 * `TOB_STATIC=1` produces a fully pre-rendered site in `apps/web/out`, readable
 * from any static host. Every page is a snapshot of the database at build time,
 * which is what a finished benchmark is — there is nothing to compute per
 * request. Without the flag the app runs as a normal server that reflects the
 * database live, which is what you want while iterating locally.
 */
const isStatic = process.env['TOB_STATIC'] === '1';

/**
 * GitHub Pages serves a project site from `/<repo>`, so every asset and link
 * has to be prefixed. Hosts that serve from the domain root (Netlify,
 * Cloudflare Pages) need no prefix, hence the opt-in.
 */
const basePath = process.env['TOB_BASE_PATH'] ?? '';

const nextConfig: NextConfig = {
  transpilePackages: ['@tob/core', '@tob/db', '@tob/providers', '@tob/runner'],
  serverExternalPackages: ['better-sqlite3'],
  ...(isStatic ? { output: 'export' as const, images: { unoptimized: true } } : {}),
  ...(basePath === '' ? {} : { basePath, assetPrefix: basePath }),
  /** Static hosts serve `/path/` far more reliably than `/path`. */
  trailingSlash: isStatic,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
