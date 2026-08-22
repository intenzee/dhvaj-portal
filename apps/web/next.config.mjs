import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @hsdg/contracts ships TS source consumed directly by the app.
  transpilePackages: ['@hsdg/contracts'],
  // Produce a self-contained server for a lean production container image.
  // The tracing root is the monorepo root so workspace deps are included.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
