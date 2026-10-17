import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Security headers on every page. No full Content-Security-Policy yet (the
 * document viewers load PDF.js workers, blobs and Office for the web); framing
 * is limited to the portal itself.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // A private portal: no page (client upload links included) is indexed.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // @hsdg/contracts ships TS source consumed directly by the app.
  transpilePackages: ['@hsdg/contracts'],
  // A second dev server (e.g. Playwright's, on another API URL) needs its own
  // build dir: NEXT_PUBLIC_* values are inlined into the shared chunks.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Produce a self-contained server for a lean production container image
  // (Docker/Render). Vercel builds its own output, so skip it there.
  // The tracing root is the monorepo root so workspace deps are included.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
