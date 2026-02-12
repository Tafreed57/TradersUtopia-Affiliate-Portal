/**
 * Google OAuth Callback
 *
 * GET /api/auth/google/callback
 *
 * Handles the redirect from Google after user consents.
 * Exchanges the authorization code for user info, then:
 * - If user exists and is ACTIVE/COMPLETED: auto-link Google, create session, redirect to dashboard
 * - If user exists but is PENDING: redirect to login with "pending" message
 * - If user doesn't exist: create a PENDING request, redirect to login with "request submitted" message
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/config';
import { createSession } from '@/lib/services/session.service';
import { logger } from '@/lib/utils/logger';

const log = logger.child({ service: 'google-auth' });

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string; // Google user ID
  email: string;
  email_verified: boolean;
  name: string;
  given_name: string;
  family_name?: string;
  picture?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const baseUrl = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000');

  // Handle OAuth errors
  if (error) {
    log.error('Google OAuth error', { error });
    return NextResponse.redirect(`${baseUrl}/login?error=google_denied`);
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/login?error=no_code`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${baseUrl}/login?error=google_not_configured`);
  }

  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  try {
    // Step 1: Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      log.error('Token exchange failed', { status: tokenResponse.status, error: errorText });
      return NextResponse.redirect(`${baseUrl}/login?error=token_exchange_failed`);
    }

    const tokenData: GoogleTokenResponse = await tokenResponse.json();

    // Step 2: Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoResponse.ok) {
      log.error('Failed to get user info');
      return NextResponse.redirect(`${baseUrl}/login?error=userinfo_failed`);
    }

    const googleUser: GoogleUserInfo = await userInfoResponse.json();
    const googleEmail = normalizeEmail(googleUser.email);
    const googleId = googleUser.sub;
    const firstName = googleUser.given_name || googleUser.name || '';
    const lastName = googleUser.family_name || '';

    log.info('Google auth: user info received', { email: googleEmail, name: `${firstName} ${lastName}` });

    // Step 3: Check if user exists in our database
    let user = await prisma.user.findUnique({
      where: { aliasEmail: googleEmail },
    });

    // Also check by googleId in case they changed their email
    if (!user && googleId) {
      user = await prisma.user.findFirst({
        where: { googleId },
      });
    }

    if (user) {
      // User exists — check their status
      const status = user.accountStatus;

      // Link Google ID if not already linked
      if (!user.googleId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { googleId },
        });
      }

      if (status === 'ACTIVE' || status === 'COMPLETED') {
        // Active user — create session and redirect to dashboard
        log.info('Google auth: existing active user, creating session', { email: googleEmail });

        const sessionResult = await createSession(googleEmail);

        if (sessionResult.success && sessionResult.token) {
          // Redirect to dashboard with token in URL (the login page will store it)
          const response = NextResponse.redirect(`${baseUrl}/login?google_token=${sessionResult.token}`);
          return response;
        }

        return NextResponse.redirect(`${baseUrl}/login?error=session_failed`);
      }

      if (status === 'PENDING') {
        return NextResponse.redirect(`${baseUrl}/login?google_status=pending&email=${encodeURIComponent(googleEmail)}`);
      }

      if (status === 'APPROVED') {
        // Approved but hasn't set password yet — they can now use Google to bypass password
        log.info('Google auth: approved user signing in via Google, activating', { email: googleEmail });

        // Activate the account
        await prisma.user.update({
          where: { id: user.id },
          data: {
            accountStatus: 'ACTIVE',
            completedAt: new Date(),
          },
        });

        const sessionResult = await createSession(googleEmail);
        if (sessionResult.success && sessionResult.token) {
          return NextResponse.redirect(`${baseUrl}/login?google_token=${sessionResult.token}`);
        }

        return NextResponse.redirect(`${baseUrl}/login?error=session_failed`);
      }

      if (status === 'REJECTED') {
        return NextResponse.redirect(`${baseUrl}/login?google_status=rejected&email=${encodeURIComponent(googleEmail)}`);
      }

      // Unknown status
      return NextResponse.redirect(`${baseUrl}/login?error=unknown_status`);
    }

    // Step 4: User doesn't exist — create a PENDING request
    log.info('Google auth: new user, creating pending request', { email: googleEmail, name: `${firstName} ${lastName}` });

    await prisma.user.create({
      data: {
        aliasEmail: googleEmail,
        email: googleEmail,
        firstName: firstName || null,
        lastName: lastName || null,
        googleId,
        accountStatus: 'PENDING',
        requestedAt: new Date(),
        requestedPortalType: 'affiliate',
      },
    });

    return NextResponse.redirect(
      `${baseUrl}/login?google_status=request_submitted&email=${encodeURIComponent(googleEmail)}`
    );
  } catch (error) {
    log.error('Google auth callback error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.redirect(`${baseUrl}/login?error=google_auth_failed`);
  }
}
