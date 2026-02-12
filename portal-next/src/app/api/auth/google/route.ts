/**
 * Google OAuth Initiation
 *
 * GET /api/auth/google
 * Redirects the user to Google's OAuth consent screen.
 */

import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(
      new URL('/login?error=google_not_configured', process.env.NEXTAUTH_URL || 'http://localhost:3000')
    );
  }

  // Determine the redirect URI based on environment
  const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account', // Always show account picker
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(googleAuthUrl);
}
