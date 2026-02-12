'use client';

/**
 * Admin Panel
 *
 * Allows administrators to manage pending accounts and system settings.
 */

import { useState, useEffect } from 'react';
import { Navigation } from '@/components/Navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { gsCall, getStoredToken } from '@/lib/client/gs-compat';

interface PendingAccount {
  aliasEmail: string;
  email: string;
  firstName: string;
  lastName: string;
  requestedAt: string;
  requestedPortalType: string;
  rewardfulEmail?: string;
}

interface PreCheckResult {
  exists: boolean;
  actionWillBe: 'MIGRATION' | 'NEW_USER';
  message: string;
  description: string;
  affiliate?: {
    id: string;
    name: string;
    email: string;
    unpaidCommission: number;
    totalPaid: number;
  };
}

function AdminContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<PendingAccount | null>(null);

  // Approval form
  const [internalEmail, setInternalEmail] = useState('');
  const [preCheckResult, setPreCheckResult] = useState<PreCheckResult | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadPendingAccounts();
  }, []);

  const loadPendingAccounts = async () => {
    setLoading(true);
    setError('');

    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; pending?: PendingAccount[]; error?: string }>(
        'adminGetPendingAccounts',
        token
      );

      if (result.success && result.pending) {
        setPendingAccounts(result.pending);
      } else {
        setError(result.error || 'Failed to load pending accounts');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAccount = (account: PendingAccount) => {
    setSelectedAccount(account);
    setInternalEmail(account.rewardfulEmail || '');
    setPreCheckResult(null);
    setMessage('');
  };

  const handlePreCheck = async () => {
    if (!internalEmail.trim()) return;

    setCheckingEmail(true);
    setPreCheckResult(null);

    try {
      const token = getStoredToken();
      const result = await gsCall<PreCheckResult & { success: boolean }>(
        'adminPreCheckInternalEmail',
        internalEmail.trim(),
        token
      );

      if (result.success) {
        setPreCheckResult(result);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Pre-check failed');
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedAccount || !internalEmail.trim()) return;

    setApproving(true);
    setMessage('');

    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; message?: string; error?: string }>(
        'adminApproveAccount',
        selectedAccount.aliasEmail,
        {
          rewardfulEmail: internalEmail.trim(),
          firstName: selectedAccount.firstName,
          lastName: selectedAccount.lastName,
        },
        token
      );

      if (result.success) {
        setMessage(result.message || 'Account approved successfully!');
        setSelectedAccount(null);
        loadPendingAccounts();
      } else {
        setMessage(result.error || 'Failed to approve account');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedAccount) return;

    const reason = prompt('Enter rejection reason (optional):');
    if (reason === null) return; // User cancelled

    setRejecting(true);
    setMessage('');

    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; error?: string }>(
        'adminRejectAccount',
        selectedAccount.aliasEmail,
        reason || '',
        token
      );

      if (result.success) {
        setMessage('Account rejected');
        setSelectedAccount(null);
        loadPendingAccounts();
      } else {
        setMessage(result.error || 'Failed to reject account');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setRejecting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount);
  };

  return (
    <div className="page-wrapper">
      <Navigation />

      <main className="main-content">
        <div className="page-header">
          <h1>Admin Panel</h1>
          <p>Manage pending account requests and system settings</p>
        </div>

        {loading && (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        )}

        {error && !loading && (
          <div className="error-state">
            <p>{error}</p>
          </div>
        )}

        {!loading && (
          <div className="admin-grid">
            {/* Pending accounts list */}
            <div className="panel">
              <h2>Pending Accounts ({pendingAccounts.length})</h2>
              <div className="accounts-list">
                {pendingAccounts.length === 0 ? (
                  <p className="empty">No pending accounts</p>
                ) : (
                  pendingAccounts.map((account) => (
                    <div
                      key={account.aliasEmail}
                      className={`account-item ${selectedAccount?.aliasEmail === account.aliasEmail ? 'selected' : ''}`}
                      onClick={() => handleSelectAccount(account)}
                    >
                      <div className="account-name">
                        {account.firstName} {account.lastName}
                      </div>
                      <div className="account-email">{account.aliasEmail}</div>
                      <div className="account-meta">
                        {new Date(account.requestedAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Account details */}
            <div className="panel">
              <h2>Account Details</h2>
              {!selectedAccount ? (
                <p className="empty">Select an account to review</p>
              ) : (
                <div className="account-details">
                  <div className="detail-row">
                    <span className="label">Name</span>
                    <span className="value">{selectedAccount.firstName} {selectedAccount.lastName}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Login Email</span>
                    <span className="value">{selectedAccount.aliasEmail}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Requested</span>
                    <span className="value">
                      {new Date(selectedAccount.requestedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Portal Type</span>
                    <span className="value">{selectedAccount.requestedPortalType}</span>
                  </div>

                  <hr />

                  <h3>Internal Commission Email</h3>
                  <p className="help-text">
                    Enter the internal email address used in the affiliate commission system
                  </p>

                  <div className="email-check">
                    <input
                      type="email"
                      value={internalEmail}
                      onChange={(e) => {
                        setInternalEmail(e.target.value);
                        setPreCheckResult(null);
                      }}
                      placeholder="internal@email.com"
                    />
                    <button onClick={handlePreCheck} disabled={checkingEmail || !internalEmail.trim()}>
                      {checkingEmail ? 'Checking...' : 'Pre-Check'}
                    </button>
                  </div>

                  {preCheckResult && (
                    <div className={`precheck-result ${preCheckResult.exists ? 'migration' : 'new-user'}`}>
                      <strong>{preCheckResult.actionWillBe}</strong>
                      <p>{preCheckResult.message}</p>
                      <p className="description">{preCheckResult.description}</p>
                      {preCheckResult.affiliate && (
                        <div className="affiliate-info">
                          <div>Name: {preCheckResult.affiliate.name}</div>
                          <div>Email: {preCheckResult.affiliate.email}</div>
                          <div>Unpaid: {formatCurrency(preCheckResult.affiliate.unpaidCommission)}</div>
                          <div>Total Paid: {formatCurrency(preCheckResult.affiliate.totalPaid)}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {message && (
                    <div className={`message ${message.includes('success') || message.includes('approved') ? 'success' : 'error'}`}>
                      {message}
                    </div>
                  )}

                  <div className="actions">
                    <button
                      onClick={handleApprove}
                      disabled={approving || !internalEmail.trim()}
                      className="btn-approve"
                    >
                      {approving ? 'Approving...' : 'Approve Account'}
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={rejecting}
                      className="btn-reject"
                    >
                      {rejecting ? 'Rejecting...' : 'Reject'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        .page-wrapper {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
        }

        .main-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        .page-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .page-header h1 {
          color: #e0e0e0;
          font-size: 1.75rem;
          margin: 0 0 0.5rem;
        }

        .page-header p {
          color: #888;
          margin: 0;
        }

        .loading-state,
        .error-state {
          text-align: center;
          padding: 3rem;
          color: #888;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(0, 212, 255, 0.2);
          border-top-color: #00d4ff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 1rem;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .error-state {
          color: #ff6b6b;
        }

        .admin-grid {
          display: grid;
          grid-template-columns: 1fr 1.5fr;
          gap: 1.5rem;
        }

        @media (max-width: 768px) {
          .admin-grid {
            grid-template-columns: 1fr;
          }
        }

        .panel {
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .panel h2 {
          color: #00d4ff;
          font-size: 1rem;
          margin: 0 0 1rem;
        }

        .empty {
          color: #888;
          text-align: center;
          padding: 2rem;
        }

        .accounts-list {
          max-height: 500px;
          overflow-y: auto;
        }

        .account-item {
          padding: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          margin-bottom: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .account-item:hover {
          border-color: rgba(0, 212, 255, 0.3);
        }

        .account-item.selected {
          border-color: #00d4ff;
          background: rgba(0, 212, 255, 0.1);
        }

        .account-name {
          color: #e0e0e0;
          font-weight: 500;
        }

        .account-email {
          color: #888;
          font-size: 0.85rem;
        }

        .account-meta {
          color: #666;
          font-size: 0.8rem;
          margin-top: 0.25rem;
        }

        .account-details hr {
          border: none;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          margin: 1.5rem 0;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .detail-row .label {
          color: #888;
        }

        .detail-row .value {
          color: #e0e0e0;
        }

        .account-details h3 {
          color: #e0e0e0;
          font-size: 1rem;
          margin: 0 0 0.5rem;
        }

        .help-text {
          color: #888;
          font-size: 0.85rem;
          margin: 0 0 1rem;
        }

        .email-check {
          display: flex;
          gap: 0.5rem;
        }

        .email-check input {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: #e0e0e0;
          font-size: 1rem;
        }

        .email-check input:focus {
          outline: none;
          border-color: #00d4ff;
        }

        .email-check button {
          padding: 0.75rem 1rem;
          background: rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }

        .email-check button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .precheck-result {
          margin-top: 1rem;
          padding: 1rem;
          border-radius: 8px;
        }

        .precheck-result.migration {
          background: rgba(255, 170, 68, 0.1);
          border: 1px solid rgba(255, 170, 68, 0.3);
          color: #ffaa44;
        }

        .precheck-result.new-user {
          background: rgba(68, 170, 68, 0.1);
          border: 1px solid rgba(68, 170, 68, 0.3);
          color: #6fcf6f;
        }

        .precheck-result strong {
          display: block;
          margin-bottom: 0.5rem;
        }

        .precheck-result p {
          margin: 0.25rem 0;
        }

        .precheck-result .description {
          font-size: 0.85rem;
          opacity: 0.8;
        }

        .affiliate-info {
          margin-top: 0.75rem;
          padding-top: 0.75rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 0.85rem;
        }

        .affiliate-info div {
          margin: 0.25rem 0;
        }

        .message {
          margin-top: 1rem;
          padding: 0.75rem 1rem;
          border-radius: 6px;
        }

        .message.success {
          background: rgba(68, 170, 68, 0.1);
          border: 1px solid rgba(68, 170, 68, 0.3);
          color: #6fcf6f;
        }

        .message.error {
          background: rgba(255, 68, 68, 0.1);
          border: 1px solid rgba(255, 68, 68, 0.3);
          color: #ff6b6b;
        }

        .actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 1.5rem;
        }

        .btn-approve {
          flex: 1;
          padding: 0.875rem 1.5rem;
          background: linear-gradient(135deg, #44aa44 0%, #338833 100%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1rem;
        }

        .btn-approve:hover:not(:disabled) {
          background: linear-gradient(135deg, #55bb55 0%, #449944 100%);
        }

        .btn-approve:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-reject {
          padding: 0.875rem 1.5rem;
          background: transparent;
          color: #ff6b6b;
          border: 1px solid rgba(255, 107, 107, 0.3);
          border-radius: 6px;
          cursor: pointer;
          font-size: 1rem;
        }

        .btn-reject:hover:not(:disabled) {
          background: rgba(255, 107, 107, 0.1);
        }

        .btn-reject:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

export default function AdminPage() {
  return (
    <ProtectedRoute requireAdmin>
      <AdminContent />
    </ProtectedRoute>
  );
}
