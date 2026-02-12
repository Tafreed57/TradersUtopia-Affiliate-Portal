'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

/**
 * SSO Callback Page
 *
 * Clerk requires this page to handle the OAuth callback after the user
 * authenticates with Google (or any other OAuth provider). After processing,
 * Clerk redirects to the redirectUrlComplete (/login).
 */
export default function SSOCallbackPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        color: 'rgba(255,255,255,0.6)',
        fontFamily: "'Segoe UI', system-ui, -apple-system, Arial, sans-serif",
      }}
    >
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
