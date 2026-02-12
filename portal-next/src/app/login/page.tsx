'use client';

/**
 * Login Page
 *
 * Carbon copy of legacy Login.html:
 * - Dark navy gradient background
 * - Floating logo icon with shield SVG
 * - Glassmorphism login card
 * - Auto session check on load
 * - Pre-fill email from URL param
 * - Legacy email detection
 * - Links to request access and check status
 */

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import { gs, setStoredToken, gsCall } from '@/lib/client/gs-compat';
import { useUser, useClerk } from '@clerk/nextjs';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading, login } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [highlightNewHere, setHighlightNewHere] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Clerk hooks for Google sign-in
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
  const clerk = useClerk();

  // Pre-fill email from URL param
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) setEmail(emailParam);
  }, [searchParams]);

  // Redirect if already authenticated (our session system)
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setMessage({ text: 'Welcome back! Redirecting...', type: 'success' });
      router.push('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  // Handle Clerk Google sign-in completion
  // When Clerk authenticates a user, we check our DB and create/link the account
  useEffect(() => {
    if (!clerkLoaded || !clerkUser || googleLoading) return;
    if (isAuthenticated) return; // Already logged in with our system

    const handleClerkUser = async () => {
      setGoogleLoading(true);
      const clerkEmail = clerkUser.primaryEmailAddress?.emailAddress;
      const firstName = clerkUser.firstName || '';
      const lastName = clerkUser.lastName || '';
      const googleId = clerkUser.id;

      if (!clerkEmail) {
        setMessage({ text: 'No email found in Google account.', type: 'error' });
        setGoogleLoading(false);
        return;
      }

      showMessage('Signing in with Google...', 'info');

      try {
        // Call our backend to handle the Google sign-in logic
        const result = await gsCall<{
          success: boolean;
          token?: string;
          status?: string;
          error?: string;
        }>('handleGoogleSignIn', clerkEmail, firstName, lastName, googleId);

        if (result.success && result.token) {
          setStoredToken(result.token);
          showMessage('Signed in with Google! Redirecting...', 'success');
          setTimeout(() => router.push('/dashboard'), 500);
        } else if (result.status === 'pending') {
          showMessage('Your account request is pending admin approval.', 'info');
        } else if (result.status === 'request_submitted') {
          showMessage('Account request submitted! An admin will review shortly.', 'success');
        } else if (result.status === 'rejected') {
          showMessage('Your account request has been rejected. Contact an admin.', 'error');
        } else {
          showMessage(result.error || 'Google sign-in failed.', 'error');
        }
      } catch (err) {
        showMessage(err instanceof Error ? err.message : 'Google sign-in failed.', 'error');
      } finally {
        setGoogleLoading(false);
        // Sign out of Clerk (we use our own session system)
        try { await clerk.signOut(); } catch { /* ok */ }
      }
    };

    handleClerkUser();
  }, [clerkLoaded, clerkUser, clerkUser?.id, isAuthenticated, googleLoading, clerk, router]);

  const showMessage = (text: string, type: 'error' | 'success' | 'info') => {
    setMessage({ text, type });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      showMessage('Please enter a valid email address', 'error');
      return;
    }
    if (!password) {
      showMessage('Please enter your password', 'error');
      return;
    }

    setIsSubmitting(true);
    showMessage('Verifying credentials...', 'info');

    try {
      const result = await login(trimmedEmail, password);

      if (result.success) {
        showMessage('Login successful! Redirecting...', 'success');
        setTimeout(() => {
          router.push('/dashboard');
        }, 500);
      } else {
        setIsSubmitting(false);
        const error = result.error || 'Login failed';

        // Check for specific error conditions
        if (error.includes('no password') || error.includes('need') || error.includes('request access')) {
          showMessage(error, 'error');
          setHighlightNewHere(true);
        } else if (error.includes('pending')) {
          showMessage(error, 'info');
        } else if (error.includes('rejected')) {
          showMessage(error, 'error');
        } else {
          showMessage(error, 'error');
        }
      }
    } catch {
      setIsSubmitting(false);
      showMessage('Connection error. Please try again.', 'error');
    }
  };

  const handleNewHere = () => {
    const trimmedEmail = email.trim();
    const url = trimmedEmail
      ? `/set-password?email=${encodeURIComponent(trimmedEmail)}`
      : '/set-password';
    router.push(url);
  };

  const handleCheckStatus = () => {
    const trimmedEmail = email.trim();
    const url = trimmedEmail
      ? `/set-password?checkstatus=1&email=${encodeURIComponent(trimmedEmail)}`
      : '/set-password?checkstatus=1';
    router.push(url);
  };

  // Show checking session state
  if (isLoading) {
    return (
      <div className="page-bg">
        <div className="bg-decoration">
          <div className="bg-circle bg-circle-1" />
          <div className="bg-circle bg-circle-2" />
        </div>
        <div className="login-container">
          <div className="logo-section">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24">
                <path
                  d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V7.89l7-3.11v8.2z"
                  fill="white"
                />
              </svg>
            </div>
            <h1>Traders Utopia</h1>
            <p className="subtitle">Checking session...</p>
          </div>
        </div>
        <style jsx>{`${loginStyles}`}</style>
      </div>
    );
  }

  return (
    <div className="page-bg">
      <div className="bg-decoration">
        <div className="bg-circle bg-circle-1" />
        <div className="bg-circle bg-circle-2" />
      </div>

      <div className="login-container">
        <div className="logo-section">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path
                d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V7.89l7-3.11v8.2z"
                fill="white"
              />
            </svg>
          </div>
          <h1>Traders Utopia</h1>
          <p className="subtitle">Sign in to access your portal</p>
        </div>

        <div className="login-card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <div className="input-wrapper">
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
                <svg className="input-icon" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
                </svg>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="input-wrapper">
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <svg className="input-icon" viewBox="0 0 24 24">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                </svg>
              </div>
            </div>

            <button type="submit" className="login-btn" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <span className="spinner-inline" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {message && (
            <div className={`msg ${message.type}`}>
              {message.text}
            </div>
          )}

          {/* Google Sign-In */}
          <div className="google-divider">
            <span className="google-divider-line" />
            <span className="google-divider-text">or</span>
            <span className="google-divider-line" />
          </div>

          <button
            type="button"
            className="google-btn"
            disabled={googleLoading}
            onClick={() => {
              if (!clerk.loaded) {
                showMessage('Google sign-in is loading. Please wait a moment and try again.', 'info');
                return;
              }
              // Open Clerk's sign-in modal. Since only Google is enabled,
              // it shows just the Google option. After auth, useUser() fires
              // and our useEffect handles the rest.
              clerk.openSignIn({
                forceRedirectUrl: '/login',
                fallbackRedirectUrl: '/login',
              });
            }}
          >
            {googleLoading ? (
              <>
                <span className="spinner-inline" />
                Signing in...
              </>
            ) : (
              <>
                <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Sign in with Google
              </>
            )}
          </button>

          <div className="links-section">
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); handleNewHere(); }}
              className={highlightNewHere ? 'highlighted' : ''}
            >
              New here? Request access
            </a>
            <span className="divider">|</span>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); handleCheckStatus(); }}
            >
              Check request status
            </a>
          </div>
        </div>

        <div className="footer">
          &copy; {new Date().getFullYear()} Traders Utopia. All rights reserved.
        </div>
      </div>
      <style jsx>{`${loginStyles}`}</style>
    </div>
  );
}

const loginStyles = `
  .page-bg {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    padding: 20px;
    font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif;
  }

  .bg-decoration {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
  }

  .bg-circle {
    position: absolute;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(233, 69, 96, 0.1), rgba(255, 107, 107, 0.05));
  }

  .bg-circle-1 {
    width: 600px;
    height: 600px;
    top: -300px;
    right: -200px;
  }

  .bg-circle-2 {
    width: 400px;
    height: 400px;
    bottom: -150px;
    left: -100px;
  }

  .login-container {
    width: 100%;
    max-width: 440px;
    animation: slideIn 0.6s ease-out;
    position: relative;
    z-index: 1;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(40px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .logo-section {
    text-align: center;
    margin-bottom: 40px;
  }

  .logo-icon {
    width: 100px;
    height: 100px;
    margin: 0 auto 24px;
    background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%);
    border-radius: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 16px 48px rgba(233, 69, 96, 0.4);
    animation: float 3s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }

  .logo-icon svg {
    width: 55px;
    height: 55px;
  }

  h1 {
    font-size: 36px;
    font-weight: 800;
    color: white;
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }

  .subtitle {
    font-size: 16px;
    color: rgba(255, 255, 255, 0.6);
    font-weight: 400;
  }

  .login-card {
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    padding: 40px 32px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
  }

  .form-group {
    margin-bottom: 24px;
  }

  label {
    display: block;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 10px;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .input-wrapper {
    position: relative;
  }

  .input-icon {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    fill: rgba(255, 255, 255, 0.4);
    transition: fill 0.3s;
  }

  input[type="email"],
  input[type="password"],
  input[type="text"] {
    width: 100%;
    padding: 18px 18px 18px 52px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    font-size: 16px;
    background: rgba(0, 0, 0, 0.3);
    color: white;
    transition: all 0.3s ease;
    -webkit-appearance: none;
    font-family: inherit;
  }

  input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  input:focus {
    outline: none;
    border-color: #e94560;
    background: rgba(0, 0, 0, 0.5);
    box-shadow: 0 0 0 4px rgba(233, 69, 96, 0.2);
  }

  .input-wrapper:focus-within .input-icon {
    fill: #e94560;
  }

  .login-btn {
    width: 100%;
    padding: 18px;
    border: none;
    border-radius: 14px;
    background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%);
    color: white;
    font-size: 17px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 32px rgba(233, 69, 96, 0.35);
    text-transform: uppercase;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
  }

  .login-btn:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 12px 40px rgba(233, 69, 96, 0.5);
  }

  .login-btn:active:not(:disabled) {
    transform: translateY(-1px);
  }

  .login-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .spinner-inline {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: white;
    animation: spin 0.8s linear infinite;
    margin-right: 8px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .msg {
    margin-top: 20px;
    padding: 16px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
  }

  .msg.error {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
  }

  .msg.success {
    background: rgba(16, 185, 129, 0.2);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: #6ee7b7;
  }

  .msg.info {
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: #93c5fd;
  }

  /* Google Sign-In */
  .google-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 0;
  }
  .google-divider-line {
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
  }
  .google-divider-text {
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .google-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 14px 20px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-radius: 14px;
    color: rgba(255, 255, 255, 0.85);
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.3s ease;
    text-decoration: none;
  }
  .google-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }
  .google-icon {
    flex-shrink: 0;
  }

  .links-section {
    margin-top: 20px;
    text-align: center;
  }

  .links-section a {
    color: rgba(255, 255, 255, 0.6);
    text-decoration: none;
    font-size: 14px;
    transition: color 0.3s;
    cursor: pointer;
  }

  .links-section a:hover {
    color: #e94560;
  }

  .links-section a.highlighted {
    color: #e94560;
    font-weight: bold;
  }

  .divider {
    color: rgba(255, 255, 255, 0.3);
    margin: 0 10px;
  }

  .footer {
    text-align: center;
    margin-top: 40px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
  }

  @media (max-width: 480px) {
    .login-container {
      max-width: 100%;
    }

    .login-card {
      padding: 32px 24px;
    }

    h1 {
      font-size: 28px;
    }

    .logo-icon {
      width: 80px;
      height: 80px;
    }

    .logo-icon svg {
      width: 45px;
      height: 45px;
    }
  }
`;

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }} />}>
      <LoginContent />
    </Suspense>
  );
}
