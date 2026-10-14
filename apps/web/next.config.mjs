import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
