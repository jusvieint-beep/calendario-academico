import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // exceljs usa módulos de Node: se carga solo en el servidor, sin empaquetar.
  serverExternalPackages: ['exceljs'],
  eslint: { ignoreDuringBuilds: true },
  // El chequeo de tipos se ejecuta con `npm run typecheck`. No bloquea el despliegue
  // en Vercel para que un aviso de tipos de una librería no detenga la publicación.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' }
        ]
      }
    ];
  }
};

export default nextConfig;
