/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @hsdg/contracts ships TS source consumed directly by the app.
  transpilePackages: ['@hsdg/contracts'],
};

export default nextConfig;
