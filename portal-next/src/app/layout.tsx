import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TradersUtopia Portal',
  description: 'Affiliate commission tracking and management portal',
  robots: 'noindex, nofollow', // Private portal, no indexing
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <div id="app-root">{children}</div>
      </body>
    </html>
  );
}
