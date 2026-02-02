'use client';

/**
 * Login Page
 *
 * Handles user login, account status check, and access requests.
 * Preserves the legacy login flow with tabs for different states.
 */

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/hooks/useSession';
import { gs } from '@/lib/client/gs-compat';

type LoginTab = 'login' | 'check-status' | 'request-access';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, login } = useSession();

  // Tab state
  const [activeTab, setActiveTab] = useState<LoginTab>('login');

  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Check status form
  const [statusEmail, setStatusEmail] = useState('');
  const [statusResult, setStatusResult] = useState<{
    found: boolean;
    status?: string;
    message?: string;
    canSetPassword?: boolean;
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Request access form
  const [requestEmail, setRequestEmail] = useState('');
  const [requestFirstName, setRequestFirstName] = useState('');
  const [requestLastName, setRequestLastName] = useState('');
  const [requestResult, setRequestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
  } | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  // Handle login
  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const result = await login(loginEmail, loginPassword);
      if (result.success) {
        router.push('/dashboard');
      } else {
        setLoginError(result.error || 'Login failed');
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  // Handle status check
  const handleCheckStatus = async (e: FormEvent) => {
    e.preventDefault();
    setStatusResult(null);
    setStatusLoading(true);

    try {
      const result = await gs.checkAccountStatus(statusEmail);
      setStatusResult({
        found: result.status !== 'new',
        status: result.status,
        message: result.message,
        canSetPassword: result.canSetPassword,
      });
    } catch (error) {
      setStatusResult({
        found: false,
        message: error instanceof Error ? error.message : 'Error checking status',
      });
    } finally {
      setStatusLoading(false);
    }
  };

  // Handle access request
  const handleRequestAccess = async (e: FormEvent) => {
    e.preventDefault();
    setRequestResult(null);
    setRequestLoading(true);

    try {
      const result = await gs.requestAccountAccess(
        requestEmail,
        requestFirstName,
        requestLastName,
        'affiliate'
      );

      if (result.success) {
        setRequestResult({
          success: true,
          message: 'Your access request has been submitted! Please check back later.',
        });
      } else {
        setRequestResult({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      setRequestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Error submitting request',
      });
    } finally {
      setRequestLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="login-card">
        <div className="login-header">
          <h1>TradersUtopia Portal</h1>
          <p>Affiliate Commission & Student Management</p>
        </div>

        {/* Tab Navigation */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'login' ? 'active' : ''}`}
            onClick={() => setActiveTab('login')}
          >
            Login
          </button>
          <button
            className={`tab ${activeTab === 'check-status' ? 'active' : ''}`}
            onClick={() => setActiveTab('check-status')}
          >
            Check Status
          </button>
          <button
            className={`tab ${activeTab === 'request-access' ? 'active' : ''}`}
            onClick={() => setActiveTab('request-access')}
          >
            Request Access
          </button>
        </div>

        {/* Login Tab */}
        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className="form">
            <div className="form-group">
              <label htmlFor="login-email">Email</label>
              <input
                type="email"
                id="login-email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                placeholder="your@email.com"
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <input
                type="password"
                id="login-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                placeholder="Enter password"
                autoComplete="current-password"
              />
            </div>

            {loginError && <div className="error-message">{loginError}</div>}

            <button type="submit" className="btn btn-primary" disabled={loginLoading}>
              {loginLoading ? 'Logging in...' : 'Login'}
            </button>

            <div className="form-footer">
              <Link href="/set-password">Forgot password or need to set one?</Link>
            </div>
          </form>
        )}

        {/* Check Status Tab */}
        {activeTab === 'check-status' && (
          <form onSubmit={handleCheckStatus} className="form">
            <div className="form-group">
              <label htmlFor="status-email">Email</label>
              <input
                type="email"
                id="status-email"
                value={statusEmail}
                onChange={(e) => setStatusEmail(e.target.value)}
                required
                placeholder="your@email.com"
              />
            </div>

            <button type="submit" className="btn btn-secondary" disabled={statusLoading}>
              {statusLoading ? 'Checking...' : 'Check Status'}
            </button>

            {statusResult && (
              <div className={`status-result ${statusResult.found ? 'found' : 'not-found'}`}>
                <p className="status-message">{statusResult.message}</p>
                {statusResult.canSetPassword && (
                  <Link href={`/set-password?email=${encodeURIComponent(statusEmail)}`} className="btn btn-link">
                    Set Password
                  </Link>
                )}
              </div>
            )}
          </form>
        )}

        {/* Request Access Tab */}
        {activeTab === 'request-access' && (
          <form onSubmit={handleRequestAccess} className="form">
            <div className="form-group">
              <label htmlFor="request-email">Email *</label>
              <input
                type="email"
                id="request-email"
                value={requestEmail}
                onChange={(e) => setRequestEmail(e.target.value)}
                required
                placeholder="your@email.com"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="request-first-name">First Name</label>
                <input
                  type="text"
                  id="request-first-name"
                  value={requestFirstName}
                  onChange={(e) => setRequestFirstName(e.target.value)}
                  placeholder="Optional"
                />
              </div>

              <div className="form-group">
                <label htmlFor="request-last-name">Last Name</label>
                <input
                  type="text"
                  id="request-last-name"
                  value={requestLastName}
                  onChange={(e) => setRequestLastName(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={requestLoading}>
              {requestLoading ? 'Submitting...' : 'Request Access'}
            </button>

            {requestResult && (
              <div className={`status-result ${requestResult.success ? 'success' : 'error'}`}>
                <p>{requestResult.success ? requestResult.message : requestResult.error}</p>
              </div>
            )}
          </form>
        )}
      </div>

      <style jsx>{`
        .page-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
          padding: 2rem;
        }

        .loading {
          color: #e0e0e0;
          font-size: 1.2rem;
        }

        .login-card {
          background: rgba(26, 26, 46, 0.95);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          width: 100%;
          max-width: 450px;
          overflow: hidden;
        }

        .login-header {
          text-align: center;
          padding: 2rem 2rem 1rem;
          background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
        }

        .login-header h1 {
          color: #00d4ff;
          font-size: 1.8rem;
          margin: 0 0 0.5rem;
        }

        .login-header p {
          color: #a0a0a0;
          margin: 0;
          font-size: 0.9rem;
        }

        .tabs {
          display: flex;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .tab {
          flex: 1;
          padding: 1rem;
          background: transparent;
          border: none;
          color: #a0a0a0;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
        }

        .tab:hover {
          color: #e0e0e0;
          background: rgba(255, 255, 255, 0.05);
        }

        .tab.active {
          color: #00d4ff;
          border-bottom: 2px solid #00d4ff;
          margin-bottom: -1px;
        }

        .form {
          padding: 2rem;
        }

        .form-group {
          margin-bottom: 1.25rem;
        }

        .form-group label {
          display: block;
          color: #e0e0e0;
          margin-bottom: 0.5rem;
          font-size: 0.9rem;
        }

        .form-group input {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: #e0e0e0;
          font-size: 1rem;
          transition: all 0.2s;
        }

        .form-group input:focus {
          outline: none;
          border-color: #00d4ff;
          background: rgba(255, 255, 255, 0.08);
        }

        .form-group input::placeholder {
          color: #666;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .error-message {
          background: rgba(255, 68, 68, 0.1);
          border: 1px solid rgba(255, 68, 68, 0.3);
          color: #ff6b6b;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          font-size: 0.9rem;
        }

        .status-result {
          margin-top: 1rem;
          padding: 1rem;
          border-radius: 6px;
          text-align: center;
        }

        .status-result.found,
        .status-result.success {
          background: rgba(68, 170, 68, 0.1);
          border: 1px solid rgba(68, 170, 68, 0.3);
          color: #6fcf6f;
        }

        .status-result.not-found,
        .status-result.error {
          background: rgba(255, 170, 68, 0.1);
          border: 1px solid rgba(255, 170, 68, 0.3);
          color: #ffaa44;
        }

        .status-message {
          margin: 0 0 0.5rem;
        }

        .btn {
          width: 100%;
          padding: 0.875rem 1.5rem;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-primary {
          background: linear-gradient(135deg, #00d4ff 0%, #00b8e0 100%);
          color: #0f0f1a;
        }

        .btn-primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #00e5ff 0%, #00c8f0 100%);
          transform: translateY(-1px);
        }

        .btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
        }

        .btn-secondary:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.15);
        }

        .btn-link {
          display: inline-block;
          padding: 0.5rem 1rem;
          color: #00d4ff;
          text-decoration: none;
          font-size: 0.9rem;
        }

        .btn-link:hover {
          text-decoration: underline;
        }

        .form-footer {
          text-align: center;
          margin-top: 1rem;
        }

        .form-footer a {
          color: #00d4ff;
          text-decoration: none;
          font-size: 0.9rem;
        }

        .form-footer a:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
