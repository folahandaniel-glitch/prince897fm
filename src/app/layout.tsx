import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { PwaBoot } from '@/components/pwa';

export const metadata: Metadata = {
  title: { default: 'WorkSuite', template: '%s · WorkSuite' },
  description: 'Configurable enterprise workforce platform',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false }, // authenticated application: not for search engines
  appleWebApp: { capable: true, title: 'WorkSuite', statusBarStyle: 'default' },
  icons: { icon: '/icons/prince-192.png', apple: '/icons/prince-apple-180.png' },
};
export const viewport: Viewport = { themeColor: '#111111', width: 'device-width', initialScale: 1 };

const themeInit = `try{var t=localStorage.getItem('ws-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined; // set per request in middleware: scripts run only with this nonce
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:p-3">Skip to content</a>
        {children}
        <PwaBoot />
      </body>
    </html>
  );
}
