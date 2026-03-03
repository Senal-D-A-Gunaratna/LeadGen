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
  // The `experimental.allowedDevOrigins` key was not recognized by our
  // version of Next.js (the warning appeared when starting `next dev`).
  // In recent releases the property is now a top-level option, so we
  // compute its value dynamically here.  We also add a rewrite rule to
  // tunnel every `/api/*` request through to the backend so that the
  // frontend doesn't return 404s for API paths during development.
  
  // `os.networkInterfaces()` lets us enumerate the machine's non-internal
  // IPv4 addresses.  Add each one on port 5000 so that clients visiting the
  // site via the LAN address are allowed to proxy requests back to the
  // backend.
  allowedDevOrigins: (() => {
    const origins = [
      'http://localhost:5000',
      'http://127.0.0.1:5000',
    ];
    try {
      const os = require('os');
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) {
            origins.push(`http://${net.address}:5000`);
          }
        }
      }
    } catch (e) {
      // if os.networkInterfaces() fails for some reason just ignore it
    }
    return origins;
  })(),
  
  async rewrites() {
    // forward all /api requests to the real backend in development and
    // production (the backend URL can be configured via BACKEND_URL)
    const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
