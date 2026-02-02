/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Disable x-powered-by header for security
  poweredByHeader: false,

  // Environment variables available on the client
  // Note: Only NEXT_PUBLIC_ prefixed vars are exposed to browser
  env: {
    // App metadata
    APP_NAME: 'TradersUtopia Portal',
    APP_VERSION: '2.0.0',
  },

  // Redirect legacy GAS URLs to new paths
  async redirects() {
    return [
      // Legacy ?page= parameter redirects
      {
        source: '/',
        has: [{ type: 'query', key: 'page', value: 'login' }],
        destination: '/login',
        permanent: true,
      },
      {
        source: '/',
        has: [{ type: 'query', key: 'page', value: 'home' }],
        destination: '/dashboard',
        permanent: true,
      },
      {
        source: '/',
        has: [{ type: 'query', key: 'page', value: 'commission' }],
        destination: '/commission',
        permanent: true,
      },
      {
        source: '/',
        has: [{ type: 'query', key: 'page', value: 'teacher' }],
        destination: '/teacher',
        permanent: true,
      },
      {
        source: '/',
        has: [{ type: 'query', key: 'page', value: 'attendance' }],
        destination: '/student',
        permanent: true,
      },
      {
        source: '/',
        has: [{ type: 'query', key: 'page', value: 'set-password' }],
        destination: '/set-password',
        permanent: true,
      },
    ];
  },

  // Headers for security
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
