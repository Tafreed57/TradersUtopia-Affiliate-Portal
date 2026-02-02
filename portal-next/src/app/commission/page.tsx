'use client';

/**
 * Commission Lookup Page
 *
 * Allows users to view their affiliate commission data.
 */

import { useState, useEffect } from 'react';
import { Navigation } from '@/components/Navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useSession } from '@/hooks/useSession';
import { gsCall, getStoredToken } from '@/lib/client/gs-compat';

interface CommissionData {
  email: string;
  displayEmail: string;
  name: string;
  unpaidAmount: number;
  dueNowAmount: number;
  totalPaidAmount: number;
  percentage: number;
  percentageApplied: boolean;
  hasOverride: boolean;
  overrideNote?: string;
  currency: string;
  lastFetchedAt: number;
}

function CommissionContent() {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<CommissionData | null>(null);
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Load commission data on mount
  useEffect(() => {
    if (user?.email) {
      loadCommissionData(user.email);
    }
  }, [user]);

  const loadCommissionData = async (email: string) => {
    setLoading(true);
    setError('');

    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; data?: CommissionData; error?: string }>(
        'lookupAffiliate',
        email,
        token
      );

      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error || 'Failed to load commission data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commission data');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchEmail.trim()) return;

    setIsSearching(true);
    await loadCommissionData(searchEmail.trim());
    setIsSearching(false);
  };

  const formatCurrency = (amount: number, currency = 'CAD') => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  return (
    <div className="page-wrapper">
      <Navigation />

      <main className="main-content">
        <div className="page-header">
          <h1>Commission Lookup</h1>
          <p>View your affiliate commission earnings and payouts</p>
        </div>

        {/* Admin search */}
        {user?.isAdmin && (
          <form onSubmit={handleSearch} className="search-form">
            <input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="Search by email (admin only)"
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </form>
        )}

        {/* Loading state */}
        {loading && (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading commission data...</p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="error-state">
            <p>{error}</p>
            <button onClick={() => user?.email && loadCommissionData(user.email)}>
              Try Again
            </button>
          </div>
        )}

        {/* Commission data */}
        {data && !loading && (
          <div className="commission-grid">
            {/* Summary card */}
            <div className="summary-card">
              <h2>Commission Summary</h2>
              <div className="summary-info">
                <div className="info-row">
                  <span className="label">Affiliate</span>
                  <span className="value">{data.name}</span>
                </div>
                <div className="info-row">
                  <span className="label">Email</span>
                  <span className="value">{data.displayEmail}</span>
                </div>
                {data.percentageApplied && (
                  <div className="info-row highlight">
                    <span className="label">Commission Rate</span>
                    <span className="value">{data.percentage}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Amount cards */}
            <div className="amount-card unpaid">
              <div className="amount-icon">💰</div>
              <div className="amount-content">
                <h3>Unpaid Commission</h3>
                <div className="amount">{formatCurrency(data.unpaidAmount)}</div>
                <p>Total pending payout</p>
              </div>
            </div>

            <div className="amount-card due">
              <div className="amount-icon">📋</div>
              <div className="amount-content">
                <h3>Due Now</h3>
                <div className="amount">{formatCurrency(data.dueNowAmount)}</div>
                <p>Ready for withdrawal</p>
              </div>
            </div>

            <div className="amount-card paid">
              <div className="amount-icon">✅</div>
              <div className="amount-content">
                <h3>Total Paid</h3>
                <div className="amount">{formatCurrency(data.totalPaidAmount)}</div>
                <p>All-time earnings</p>
              </div>
            </div>

            {/* Override notice */}
            {data.hasOverride && (
              <div className="override-notice">
                <strong>Note:</strong> Admin override is applied to your commission amounts.
                {data.overrideNote && <p>{data.overrideNote}</p>}
              </div>
            )}

            {/* Last updated */}
            <div className="last-updated">
              Last updated: {new Date(data.lastFetchedAt).toLocaleString()}
              <button onClick={() => loadCommissionData(data.email)} className="refresh-btn">
                Refresh
              </button>
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
          max-width: 1000px;
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

        .search-form {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 2rem;
          padding: 1rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
        }

        .search-form input {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: #e0e0e0;
          font-size: 1rem;
        }

        .search-form input:focus {
          outline: none;
          border-color: #00d4ff;
        }

        .search-form button {
          padding: 0.75rem 1.5rem;
          background: #00d4ff;
          color: #0f0f1a;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
        }

        .search-form button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
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

        .error-state button {
          margin-top: 1rem;
          padding: 0.5rem 1rem;
          background: rgba(255, 107, 107, 0.2);
          border: 1px solid rgba(255, 107, 107, 0.3);
          color: #ff6b6b;
          border-radius: 6px;
          cursor: pointer;
        }

        .commission-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .summary-card {
          grid-column: 1 / -1;
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .summary-card h2 {
          color: #00d4ff;
          font-size: 1.1rem;
          margin: 0 0 1rem;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .info-row:last-child {
          border-bottom: none;
        }

        .info-row.highlight {
          background: rgba(0, 212, 255, 0.1);
          margin: 0.5rem -1rem;
          padding: 0.75rem 1rem;
          border-radius: 6px;
        }

        .info-row .label {
          color: #888;
        }

        .info-row .value {
          color: #e0e0e0;
        }

        .amount-card {
          display: flex;
          gap: 1rem;
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .amount-icon {
          font-size: 2rem;
        }

        .amount-content h3 {
          color: #888;
          font-size: 0.9rem;
          margin: 0 0 0.5rem;
          font-weight: normal;
        }

        .amount-content .amount {
          font-size: 1.75rem;
          font-weight: bold;
          margin-bottom: 0.25rem;
        }

        .amount-card.unpaid .amount {
          color: #00d4ff;
        }

        .amount-card.due .amount {
          color: #ffaa44;
        }

        .amount-card.paid .amount {
          color: #44aa44;
        }

        .amount-content p {
          color: #666;
          font-size: 0.8rem;
          margin: 0;
        }

        .override-notice {
          grid-column: 1 / -1;
          background: rgba(255, 170, 68, 0.1);
          border: 1px solid rgba(255, 170, 68, 0.3);
          color: #ffaa44;
          padding: 1rem;
          border-radius: 8px;
        }

        .last-updated {
          grid-column: 1 / -1;
          text-align: center;
          color: #666;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
        }

        .refresh-btn {
          padding: 0.25rem 0.75rem;
          background: transparent;
          border: 1px solid rgba(0, 212, 255, 0.3);
          color: #00d4ff;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.8rem;
        }

        .refresh-btn:hover {
          background: rgba(0, 212, 255, 0.1);
        }
      `}</style>
    </div>
  );
}

export default function CommissionPage() {
  return (
    <ProtectedRoute>
      <CommissionContent />
    </ProtectedRoute>
  );
}
