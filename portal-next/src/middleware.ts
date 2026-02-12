/**
 * Next.js Middleware
 *
 * Uses Clerk's clerkMiddleware() for auth state and applies security headers.
 * File must be named middleware.ts (Next.js ≤15). See Clerk App Router quickstart.
 */

import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Security headers applied to all responses
 */
const securityHeaders: Record<string, string> = {
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-XSS-Protection': '1; mode=block',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * Content Security Policy (CSP) – includes Clerk domains for OAuth and API
 */
const cspDirectives: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://*.clerk.accounts.dev', 'https://*.clerk.com'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'https://*.clerk.accounts.dev', 'https://*.clerk.com'],
  'connect-src': [
    "'self'",
    'https://api.getrewardful.com',
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
    'https://accounts.google.com',
    'https://oauth2.googleapis.com',
  ],
  'frame-src': ["'self'", 'https://*.clerk.accounts.dev', 'https://*.clerk.com', 'https://accounts.google.com'],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'", 'https://*.clerk.accounts.dev', 'https://accounts.google.com'],
};

function buildCsp(): string {
  return Object.entries(cspDirectives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

export default clerkMiddleware((_auth, request: NextRequest) => {
  const response = NextResponse.next();

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  const csp = buildCsp();
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Content-Security-Policy', csp);
  } else {
    response.headers.set('Content-Security-Policy-Report-Only', csp);
  }

  response.headers.set('X-Request-ID', crypto.randomUUID());

  return response;
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files (Clerk quickstart pattern)
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
