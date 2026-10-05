import type { Metadata, Viewport } from 'next';
import { Urbanist } from 'next/font/google';
import { APP_NAME } from '@/lib/env';
import { themeInitScript } from '@/lib/theme';
import './globals.css';

const urbanist = Urbanist({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-urbanist', display: 'swap' });

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Sesiones, grabaciones y entregas académicas en un calendario claro y actualizado.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#131313'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={urbanist.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
