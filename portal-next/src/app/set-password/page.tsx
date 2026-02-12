'use client';

/**
 * Set Password / Request Access Page
 *
 * Carbon copy of legacy SetPassword.html:
 * - Purple gradient background
 * - White frosted-glass container
 * - Multiple modes: request, token, approved, affiliate
 * - Check Status popup modal
 * - Password requirements display
 */

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { gs } from '@/lib/client/gs-compat';

type PageMode = 'request' | 'token' | 'approved' | 'affiliate';
type ViewState = 'form' | 'loading' | 'success' | 'pending' | 'alreadyPending' | 'rejected' | 'error';

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [pageMode, setPageMode] = useState<PageMode>('request');
  const [viewState, setViewState] = useState<ViewState>('form');
  const [loadingText, setLoadingText] = useState('Processing...');

  // Form state
  const [requestEmail, setRequestEmail] = useState('');
  const [passwordEmail, setPasswordEmail] = useState('');
  const [tokenEmail, setTokenEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Message state
  const [requestMsg, setRequestMsg] = useState<{ text: string; type: string } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<{ text: string; type: string } | null>(null);
  const [resultMessage, setResultMessage] = useState('');

  // Buttons disabled
  const [requestBtnDisabled, setRequestBtnDisabled] = useState(false);
  const [passwordBtnDisabled, setPasswordBtnDisabled] = useState(false);

  // Token from URL
  const [setupToken, setSetupToken] = useState<string | null>(null);

  // Status popup
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [statusEmail, setStatusEmail] = useState('');
  const [statusCheckEmail, setStatusCheckEmail] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<{ type: string; html: string } | null>(null);
  const [showStatusPasswordForm, setShowStatusPasswordForm] = useState(false);
  const [statusPassword, setStatusPassword] = useState('');
  const [statusConfirmPassword, setStatusConfirmPassword] = useState('');
  const [statusBtnDisabled, setStatusBtnDisabled] = useState(false);
  const [statusBtnText, setStatusBtnText] = useState('Check Status');
  const [statusSetBtnDisabled, setStatusSetBtnDisabled] = useState(false);
  const [statusSetBtnText, setStatusSetBtnText] = useState('Set Password & Continue');

  // Initialize on mount
  useEffect(() => {
    const token = searchParams.get('token');
    const emailParam = searchParams.get('email');
    const checkStatusFlag = searchParams.get('checkstatus');

    if (token) {
      setSetupToken(token);
      setPageMode('token');
      initTokenMode(token);
    } else {
      setPageMode('request');
      if (emailParam) {
        setRequestEmail(emailParam);
      }
      if (checkStatusFlag === '1') {
        setTimeout(() => {
          setShowStatusPopup(true);
          if (emailParam) setStatusEmail(emailParam);
        }, 300);
      }
    }
  }, [searchParams]);

  const initTokenMode = async (token: string) => {
    setViewState('loading');
    setLoadingText('Validating your link...');

    try {
      const result = await gs.validatePasswordSetupToken(token);
      if (result.valid && result.email) {
        setTokenEmail(result.email);
        setPageMode('token');
        setViewState('form');
      } else {
        setResultMessage(result.error || 'This link is no longer valid.');
        setViewState('error');
      }
    } catch {
      setResultMessage('An error occurred. Please try again or contact support.');
      setViewState('error');
    }
  };

  const initApprovedMode = (email: string, message: string) => {
    setPageMode('approved');
    setTokenEmail(email);
    setPasswordMsg({ text: message, type: 'success' });
    setViewState('form');
  };

  // Submit access request
  const submitAccessRequest = async () => {
    setRequestMsg(null);
    const email = requestEmail.trim();

    if (!email) {
      setRequestMsg({ text: 'Please enter your email address.', type: 'error' });
      return;
    }
    if (email.includes('%')) {
      setRequestMsg({ text: 'This appears to be an internal system email. Please use your regular email address (without the % symbol).', type: 'error' });
      return;
    }

    setRequestBtnDisabled(true);
    setViewState('loading');
    setLoadingText('Submitting your request...');

    try {
      const result = await gs.requestAccountAccess(email, '', '', 'affiliate');
      setViewState('form');
      setRequestBtnDisabled(false);

      if (result.success) {
        setViewState('pending');
      } else {
        const error = result.error || 'Failed to submit request.';
        // Check for special states in the error response
        if (error.includes('approved') || error.includes('set your password')) {
          initApprovedMode(email, error);
        } else if (error.includes('pending')) {
          setResultMessage(error);
          setViewState('alreadyPending');
        } else if (error.includes('rejected')) {
          setResultMessage(error);
          setViewState('rejected');
        } else {
          setRequestMsg({ text: error, type: 'error' });
        }
      }
    } catch {
      setViewState('form');
      setRequestMsg({ text: 'An error occurred. Please try again.', type: 'error' });
      setRequestBtnDisabled(false);
    }
  };

  // Submit password
  const submitPassword = async () => {
    setPasswordMsg(null);
    const email = (pageMode === 'token' || pageMode === 'approved') ? tokenEmail : passwordEmail.trim();

    if (!email) {
      setPasswordMsg({ text: 'Please enter your email address.', type: 'error' });
      return;
    }
    if (!password) {
      setPasswordMsg({ text: 'Please enter a password.', type: 'error' });
      return;
    }
    if (password.length < 8) {
      setPasswordMsg({ text: 'Password must be at least 8 characters.', type: 'error' });
      return;
    }
    if (!/[a-zA-Z]/.test(password)) {
      setPasswordMsg({ text: 'Password must contain at least one letter.', type: 'error' });
      return;
    }
    if (!/[0-9]/.test(password)) {
      setPasswordMsg({ text: 'Password must contain at least one number.', type: 'error' });
      return;
    }
    if (password !== confirmPassword) {
      setPasswordMsg({ text: 'Passwords do not match.', type: 'error' });
      return;
    }

    setPasswordBtnDisabled(true);
    setViewState('loading');
    setLoadingText('Setting your password...');

    try {
      let result;
      if (pageMode === 'token' && setupToken) {
        result = await gs.setPasswordWithToken(setupToken, password, confirmPassword);
      } else if (pageMode === 'approved') {
        result = await gs.setApprovedAccountPassword(email, password, confirmPassword);
      } else {
        result = await gs.setAffiliatePassword(email, password, confirmPassword);
      }

      if (result.success) {
        setViewState('success');
      } else {
        setViewState('form');
        setPasswordMsg({ text: result.error || 'Failed to set password.', type: 'error' });
        setPasswordBtnDisabled(false);
      }
    } catch {
      setViewState('form');
      setPasswordMsg({ text: 'An error occurred. Please try again.', type: 'error' });
      setPasswordBtnDisabled(false);
    }
  };

  // Status popup functions
  const checkStatus = async () => {
    const email = statusEmail.trim();
    if (!email || !email.includes('@')) {
      setStatusResult({ type: 'error', html: 'Please enter a valid email address.' });
      return;
    }

    setStatusBtnDisabled(true);
    setStatusBtnText('Checking...');

    try {
      const result = await gs.getRequestStatus(email);
      setStatusBtnDisabled(false);
      setStatusBtnText('Check Status');

      if (!result.found) {
        setStatusResult({ type: 'notfound', html: result.message || 'No request found for this email.' });
        setShowStatusPasswordForm(false);
      } else {
        setStatusCheckEmail(email);
        const status = result.status || '';
        let details = '';
        if (result.firstName) details += `<br/><small>Name: ${result.firstName} ${result.lastName || ''}</small>`;
        if (result.requestedAt) details += `<br/><small>Requested: ${new Date(result.requestedAt).toLocaleDateString()}</small>`;

        if (status === 'PENDING') {
          setStatusResult({ type: 'pending', html: (result.message || 'Your request is pending approval.') + details });
          setShowStatusPasswordForm(false);
        } else if (status === 'APPROVED' || status === 'ADMIN') {
          setStatusResult({ type: 'approved', html: (result.message || 'Your account is approved!') + details });
          setShowStatusPasswordForm(true);
        } else if (status === 'ACTIVE' || status === 'COMPLETED') {
          setStatusResult({ type: 'active', html: (result.message || 'Your account is active. You can log in.') + details });
          setShowStatusPasswordForm(false);
        } else if (status === 'REJECTED') {
          setStatusResult({ type: 'rejected', html: (result.message || 'Your request was not approved.') + details });
          setShowStatusPasswordForm(false);
        } else {
          setStatusResult({ type: 'info', html: result.message || 'Unknown status.' });
          setShowStatusPasswordForm(false);
        }
      }
    } catch {
      setStatusBtnDisabled(false);
      setStatusBtnText('Check Status');
      setStatusResult({ type: 'error', html: 'An error occurred. Please try again.' });
    }
  };

  const setPasswordFromPopup = async () => {
    if (!statusCheckEmail) {
      setStatusResult({ type: 'error', html: 'Please check your status first.' });
      return;
    }
    if (!statusPassword) {
      setStatusResult({ type: 'error', html: 'Please enter a password.' });
      return;
    }
    if (statusPassword.length < 8) {
      setStatusResult({ type: 'error', html: 'Password must be at least 8 characters.' });
      return;
    }
    if (!/[a-zA-Z]/.test(statusPassword)) {
      setStatusResult({ type: 'error', html: 'Password must contain at least one letter.' });
      return;
    }
    if (!/[0-9]/.test(statusPassword)) {
      setStatusResult({ type: 'error', html: 'Password must contain at least one number.' });
      return;
    }
    if (statusPassword !== statusConfirmPassword) {
      setStatusResult({ type: 'error', html: 'Passwords do not match.' });
      return;
    }

    setStatusSetBtnDisabled(true);
    setStatusSetBtnText('Setting password...');

    try {
      const result = await gs.setApprovedAccountPassword(statusCheckEmail, statusPassword, statusConfirmPassword);
      setStatusSetBtnDisabled(false);
      setStatusSetBtnText('Set Password & Continue');

      if (result.success) {
        setShowStatusPasswordForm(false);
        setStatusResult({ type: 'success', html: 'Password set successfully!' });
        setTimeout(() => {
          setShowStatusPopup(false);
          router.push(`/login?email=${encodeURIComponent(statusCheckEmail!)}`);
        }, 1500);
      } else {
        setStatusResult({ type: 'error', html: result.error || 'Failed to set password.' });
      }
    } catch {
      setStatusSetBtnDisabled(false);
      setStatusSetBtnText('Set Password & Continue');
      setStatusResult({ type: 'error', html: 'An error occurred. Please try again.' });
    }
  };

  const goBack = () => router.push('/login');
  const goLogin = () => {
    const email = tokenEmail || passwordEmail.trim();
    router.push(email ? `/login?email=${encodeURIComponent(email)}` : '/login');
  };

  const getStatusBg = (type: string) => {
    switch (type) {
      case 'pending': return '#fef3c7';
      case 'approved': case 'success': return '#dcfce7';
      case 'active': return '#dbeafe';
      case 'rejected': case 'error': return '#fee2e2';
      case 'notfound': return '#f1f5f9';
      default: return '#f1f5f9';
    }
  };
  const getStatusColor = (type: string) => {
    switch (type) {
      case 'pending': return '#92400e';
      case 'approved': case 'success': return '#166534';
      case 'active': return '#1e40af';
      case 'rejected': case 'error': return '#991b1b';
      case 'notfound': return '#475569';
      default: return '#475569';
    }
  };
  const getStatusIcon = (type: string) => {
    switch (type) {
      case 'pending': return '\u23F3';
      case 'approved': case 'success': return '\u2705';
      case 'active': return '\uD83D\uDC64';
      case 'rejected': return '\u274C';
      case 'error': return '\u26A0\uFE0F';
      case 'notfound': return '\uD83D\uDD0D';
      default: return '\u2139\uFE0F';
    }
  };

  const pageTitle = (pageMode === 'token' || pageMode === 'approved') ? 'Set Your Password' : 'Request Access';
  const pageSubtitle = (pageMode === 'token' || pageMode === 'approved') ? 'Complete your account setup' : 'Create your account';

  return (
    <div className="page-bg">
      <div className="container">
        {/* Logo */}
        <div className="logo-section">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path
                d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"
                fill="white"
              />
            </svg>
          </div>
          <h1>{viewState === 'form' || viewState === 'loading' ? pageTitle : ''}</h1>
          {viewState === 'form' && <p className="subtitle">{pageSubtitle}</p>}
          <p className="back-to-login">
            <a href="#" onClick={(e) => { e.preventDefault(); goBack(); }}>&larr; Back to Login</a>
          </p>
        </div>

        {/* Loading */}
        {viewState === 'loading' && (
          <div className="loading-section">
            <div className="spinner" />
            <p>{loadingText}</p>
          </div>
        )}

        {/* Request Access Form */}
        {viewState === 'form' && pageMode === 'request' && (
          <div className="form-content">
            {requestMsg && (
              <div className={`message ${requestMsg.type}`}>{requestMsg.text}</div>
            )}

            <div className="form-group">
              <label>Email Address *</label>
              <input
                type="email"
                value={requestEmail}
                onChange={(e) => setRequestEmail(e.target.value)}
                placeholder="Enter your email address"
                autoComplete="email"
              />
              <p className="field-hint">Use your regular email address (not an internal system email with % symbol)</p>
            </div>

            <div className="info-box">
              <p>After your request is approved, return here to set your password. No email is sent.</p>
            </div>

            <button
              className="btn-main"
              onClick={submitAccessRequest}
              disabled={requestBtnDisabled}
            >
              Request Access
            </button>

            <div className="status-link">
              <a href="#" onClick={(e) => { e.preventDefault(); setShowStatusPopup(true); if (requestEmail) setStatusEmail(requestEmail); }}>
                Already requested? <span className="highlight">Check your status &rarr;</span>
              </a>
            </div>

            <div className="back-link">
              <a href="#" onClick={(e) => { e.preventDefault(); goBack(); }}>&larr; Back to login</a>
            </div>
          </div>
        )}

        {/* Password Form */}
        {viewState === 'form' && (pageMode === 'token' || pageMode === 'approved' || pageMode === 'affiliate') && (
          <div className="form-content">
            {passwordMsg && (
              <div className={`message ${passwordMsg.type}`}>{passwordMsg.text}</div>
            )}

            {(pageMode === 'token' || pageMode === 'approved') && tokenEmail && (
              <div className="info-box">
                <p>Setting password for: <span className="email-display">{tokenEmail}</span></p>
              </div>
            )}

            {pageMode === 'affiliate' && (
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  value={passwordEmail}
                  onChange={(e) => setPasswordEmail(e.target.value)}
                  placeholder="Enter your email address"
                  autoComplete="email"
                />
              </div>
            )}

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                autoComplete="new-password"
              />
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
              />
            </div>

            <div className="password-requirements">
              <strong>Password requirements:</strong>
              <ul>
                <li>At least 8 characters</li>
                <li>At least one letter (a-z, A-Z)</li>
                <li>At least one number (0-9)</li>
              </ul>
            </div>

            <button
              className="btn-main"
              onClick={submitPassword}
              disabled={passwordBtnDisabled}
            >
              Set Password
            </button>

            <div className="back-link">
              <a href="#" onClick={(e) => { e.preventDefault(); goBack(); }}>&larr; Back to login</a>
            </div>
          </div>
        )}

        {/* Success */}
        {viewState === 'success' && (
          <div className="result-content">
            <div className="result-icon success-icon">
              <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="white" /></svg>
            </div>
            <h2>Password Set Successfully!</h2>
            <p className="result-desc">You can now log in with your email and password.</p>
            <button className="btn-main" onClick={goLogin}>Continue to Login &rarr;</button>
          </div>
        )}

        {/* Pending */}
        {viewState === 'pending' && (
          <div className="result-content">
            <div className="result-icon pending-icon">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="white" /></svg>
            </div>
            <h2>Request Submitted!</h2>
            <p className="result-desc">Your access request has been submitted. Please check back here after an administrator approves your account to set your password.</p>
            <button className="btn-secondary" onClick={goBack}>&larr; Back to Login</button>
          </div>
        )}

        {/* Already Pending */}
        {viewState === 'alreadyPending' && (
          <div className="result-content">
            <div className="result-icon pending-icon">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="white" /></svg>
            </div>
            <h2>Pending Approval</h2>
            <p className="result-desc">{resultMessage || 'Your account is still pending approval. Please check back later.'}</p>
            <button className="btn-secondary" onClick={goBack}>&larr; Back to Login</button>
          </div>
        )}

        {/* Rejected */}
        {viewState === 'rejected' && (
          <div className="result-content">
            <div className="result-icon error-icon">
              <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="white" /></svg>
            </div>
            <h2>Access Not Approved</h2>
            <p className="result-desc">{resultMessage || 'Your access request was not approved. Please contact an administrator.'}</p>
            <button className="btn-secondary" onClick={goBack}>&larr; Back to Login</button>
          </div>
        )}

        {/* Error */}
        {viewState === 'error' && (
          <div className="result-content">
            <div className="result-icon error-icon">
              <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="white" /></svg>
            </div>
            <h2>Link Expired or Invalid</h2>
            <p className="result-desc">{resultMessage || 'This password setup link is no longer valid.'}</p>
            <button className="btn-secondary" onClick={goBack}>&larr; Back to Login</button>
          </div>
        )}
      </div>

      {/* Status Popup Modal */}
      {showStatusPopup && (
        <div className="popup-overlay" onClick={() => setShowStatusPopup(false)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
              <div>
                <h3>Check Request Status</h3>
                <p className="popup-subtitle">Enter the email you used when requesting access</p>
              </div>
              <button className="popup-close" onClick={() => setShowStatusPopup(false)}>&times;</button>
            </div>
            <div className="popup-body">
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  value={statusEmail}
                  onChange={(e) => setStatusEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <button className="btn-check" onClick={checkStatus} disabled={statusBtnDisabled}>
                {statusBtnText}
              </button>

              {statusResult && (
                <div
                  className="status-result-box"
                  style={{ background: getStatusBg(statusResult.type), color: getStatusColor(statusResult.type) }}
                >
                  <span className="status-icon">{getStatusIcon(statusResult.type)}</span>
                  <span dangerouslySetInnerHTML={{ __html: statusResult.html }} />
                </div>
              )}

              {showStatusPasswordForm && (
                <div className="popup-password-section">
                  <h4>Set Your Password</h4>
                  <div className="form-group">
                    <label>New Password</label>
                    <input
                      type="password"
                      value={statusPassword}
                      onChange={(e) => setStatusPassword(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                  </div>
                  <div className="form-group">
                    <label>Confirm Password</label>
                    <input
                      type="password"
                      value={statusConfirmPassword}
                      onChange={(e) => setStatusConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                    />
                  </div>
                  <button className="btn-green" onClick={setPasswordFromPopup} disabled={statusSetBtnDisabled}>
                    {statusSetBtnText}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .page-bg {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px 10px;
        }

        .container {
          max-width: 500px;
          width: calc(100% - 20px);
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 24px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          padding: 40px 30px;
          animation: fadeIn 0.6s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .logo-section {
          text-align: center;
          margin-bottom: 30px;
        }

        .logo-icon {
          width: 70px;
          height: 70px;
          margin: 0 auto 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
        }

        .logo-icon svg { width: 36px; height: 36px; }

        h1 {
          font-size: 28px;
          font-weight: 700;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 8px;
        }

        .subtitle { color: #64748b; font-size: 15px; margin: 0; }

        .back-to-login { margin-top: 8px; }
        .back-to-login a { color: #667eea; font-size: 13px; text-decoration: none; }
        .back-to-login a:hover { text-decoration: underline; }

        .form-content { }

        .form-group { margin-bottom: 20px; }
        .form-group label {
          display: block; font-weight: 600; color: #475569;
          margin-bottom: 8px; font-size: 15px;
        }

        .form-group input {
          width: 100%; padding: 16px; border: 2px solid #e2e8f0;
          border-radius: 12px; font-size: 16px; transition: all 0.3s ease;
          background: white; -webkit-appearance: none; font-family: inherit;
        }

        .form-group input:focus {
          outline: none; border-color: #667eea;
          box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        }

        .field-hint { font-size: 12px; color: #64748b; margin-top: 6px; }

        .info-box {
          background: #f8fafc; border-radius: 12px; padding: 16px;
          margin-bottom: 20px; border-left: 4px solid #667eea;
        }
        .info-box p { color: #475569; font-size: 14px; margin: 0; }
        .email-display { font-weight: 600; color: #667eea; }

        .password-requirements {
          font-size: 13px; color: #64748b; margin-top: 8px; margin-bottom: 20px;
          padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #667eea;
        }
        .password-requirements ul { margin: 8px 0 0 20px; }
        .password-requirements li { margin: 4px 0; }

        .message { padding: 14px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 14px; font-weight: 500; }
        .message.error { background: #fef2f2; color: #dc2626; border-left: 4px solid #dc2626; }
        .message.success { background: #f0fdf4; color: #16a34a; border-left: 4px solid #16a34a; }
        .message.info { background: #eff6ff; color: #2563eb; border-left: 4px solid #2563eb; }

        .btn-main {
          width: 100%; padding: 16px 24px; border-radius: 12px; border: none;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white; cursor: pointer; font-size: 16px; font-weight: 600;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3); margin-top: 10px; font-family: inherit;
        }
        .btn-main:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4); }
        .btn-main:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }

        .btn-secondary {
          width: 100%; padding: 16px 24px; border-radius: 12px; border: none;
          background: linear-gradient(135deg, #64748b 0%, #475569 100%);
          color: white; cursor: pointer; font-size: 16px; font-weight: 600;
          transition: all 0.3s ease; margin-top: 10px; font-family: inherit;
        }
        .btn-secondary:hover { transform: translateY(-2px); }

        .status-link { margin-top: 12px; text-align: center; }
        .status-link a { color: #64748b; font-size: 14px; text-decoration: none; }
        .highlight { color: #e94560; font-weight: 600; }

        .back-link { text-align: center; margin-top: 20px; }
        .back-link a { color: #667eea; text-decoration: none; font-weight: 600; font-size: 14px; }
        .back-link a:hover { text-decoration: underline; }

        .loading-section { text-align: center; padding: 20px; }
        .spinner {
          width: 40px; height: 40px; border: 4px solid #e2e8f0;
          border-top-color: #667eea; border-radius: 50%;
          animation: spin 1s linear infinite; margin: 0 auto 12px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .loading-section p { color: #64748b; font-size: 15px; }

        .result-content { text-align: center; padding: 20px 0; }
        .result-icon {
          width: 80px; height: 80px; margin: 0 auto 20px;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
        }
        .result-icon svg { width: 40px; height: 40px; }
        .success-icon { background: linear-gradient(135deg, #10b981 0%, #059669 100%); }
        .pending-icon { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
        .error-icon { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
        .result-content h2 { color: #1e293b; margin-bottom: 12px; font-size: 22px; }
        .result-desc { color: #64748b; margin-bottom: 24px; font-size: 15px; line-height: 1.5; }

        /* Status Popup */
        .popup-overlay {
          position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);
          z-index: 9999; padding: 20px; overflow-y: auto; display: flex;
          align-items: flex-start; justify-content: center; padding-top: 60px;
        }
        .popup-card {
          width: 100%; max-width: 440px; max-height: 85vh; overflow-y: auto;
          background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        .popup-header {
          padding: 20px; border-bottom: 1px solid #e2e8f0;
          display: flex; justify-content: space-between; align-items: center;
        }
        .popup-header h3 { margin: 0; color: #1e293b; font-size: 18px; }
        .popup-subtitle { margin: 6px 0 0; color: #64748b; font-size: 13px; }
        .popup-close {
          background: none; border: none; font-size: 28px; cursor: pointer;
          color: #64748b; padding: 0; line-height: 1;
        }
        .popup-body { padding: 20px; }
        .popup-body .form-group { margin-bottom: 16px; }
        .popup-body .form-group input { padding: 12px; border-radius: 8px; font-size: 14px; }

        .btn-check {
          width: 100%; padding: 14px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: white; border: none; border-radius: 8px; cursor: pointer;
          font-size: 15px; font-weight: 600; font-family: inherit;
        }
        .btn-check:disabled { opacity: 0.6; cursor: not-allowed; }

        .status-result-box {
          margin-top: 20px; padding: 16px; border-radius: 12px;
          display: flex; align-items: flex-start; gap: 12px; font-size: 14px; font-weight: 500;
        }
        .status-icon { font-size: 24px; flex-shrink: 0; }

        .popup-password-section {
          margin-top: 20px; padding-top: 20px; border-top: 2px solid #e2e8f0;
        }
        .popup-password-section h4 { margin: 0 0 16px; color: #16a34a; font-size: 16px; }
        .popup-password-section .form-group { margin-bottom: 12px; }

        .btn-green {
          width: 100%; padding: 14px; background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
          color: white; border: none; border-radius: 8px; cursor: pointer;
          font-size: 15px; font-weight: 600; font-family: inherit;
        }
        .btn-green:disabled { opacity: 0.6; cursor: not-allowed; }

        @media (max-width: 480px) {
          .container { padding: 30px 20px; }
          h1 { font-size: 24px; }
        }
      `}</style>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }} />}>
      <SetPasswordContent />
    </Suspense>
  );
}
