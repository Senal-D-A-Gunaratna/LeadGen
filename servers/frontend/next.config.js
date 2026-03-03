/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // `eslint` config in next.config is no longer supported by newer Next.js versions.
  // Keep linting configuration in separate ESLint config files or run `next lint`.
  // Set Turbopack root explicitly to avoid incorrect root inference when multiple lockfiles exist.
  turbopack: {
    // Turbopack expects an absolute path for `root`.
    root: __dirname,
  },
  experimental: {
    // allow server-side fetches to the backend during development
    allowedDevOrigins: [
      'http://localhost:5000',
      'http://127.0.0.1:5000',
    ],
  },
};

module.exports = nextConfig;
