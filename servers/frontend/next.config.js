/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  turbopack: { root: __dirname },

  // dynamically build a list of allowed dev origins from the machine's
  // network interfaces.  this avoids hard-coding specific addresses.
  allowedDevOrigins: (() => {
    const origins: string[] = [];
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
    } catch {
      // ignore failures
    }
    // always allow localhost variants
    origins.push('http://localhost:5000', 'http://127.0.0.1:5000');
    return origins;
  })(),

  async rewrites() {
    const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
