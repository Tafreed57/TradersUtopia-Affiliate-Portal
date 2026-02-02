'use client';

/**
 * Set Password Page
 *
 * Allows users to set or reset their password.
 */

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { gs } from '@/lib/client/gs-compat';

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Pre-fill email from query param
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(emailParam);
    }
  }, [searchParams]);

  // Handle password set
  const handleSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Client-side validation
    if (!email) {
      setError('Email is required');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (!/[a-zA-Z]/.test(password)) {
      setError('Password must contain at least one letter');
      return;
    }

    if (!/[0-9]/.test(password)) {
      setError('Password must contain at least one number');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const result = await gs.setApprovedAccountPassword(email, password, confirmPassword);

      if (result.success) {
        setSuccess('Password set successfully! You can now log in.');
        setTimeout(() => {
          router.push('/login');
        }, 2000);
      } else {
        setError(result.error || 'Failed to set password');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="card">
        <div className="card-header">
          <h1>Set Your Password</h1>
          <p>Create a password to access the TradersUtopia Portal</p>
        </div>

        <form onSubmit={handleSetPassword} className="form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">New Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <div className="hint">
              Password must be at least 8 characters with at least one letter and one number.
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              type="password"
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Confirm your password"
              autoComplete="new-password"
            />
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Setting Password...' : 'Set Password'}
          </button>

          <div className="form-footer">
            <Link href="/login">Back to Login</Link>
          </div>
        </form>
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

        .card {
          background: rgba(26, 26, 46, 0.95);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          width: 100%;
          max-width: 450px;
          overflow: hidden;
        }

        .card-header {
          text-align: center;
          padding: 2rem 2rem 1rem;
          background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
        }

        .card-header h1 {
          color: #00d4ff;
          font-size: 1.5rem;
          margin: 0 0 0.5rem;
        }

        .card-header p {
          color: #a0a0a0;
          margin: 0;
          font-size: 0.9rem;
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

        .hint {
          color: #888;
          font-size: 0.8rem;
          margin-top: 0.5rem;
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

        .success-message {
          background: rgba(68, 170, 68, 0.1);
          border: 1px solid rgba(68, 170, 68, 0.3);
          color: #6fcf6f;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          font-size: 0.9rem;
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

        .form-footer {
          text-align: center;
          margin-top: 1.5rem;
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

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0f0f1a' }} />}>
      <SetPasswordContent />
    </Suspense>
  );
}
