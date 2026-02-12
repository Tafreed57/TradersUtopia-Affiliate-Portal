'use client';

/**
 * Commission Lookup Page
 *
 * Carbon copy of legacy CommissionLookup.Html:
 * - Purple gradient background + white frosted container
 * - Field explanations box
 * - Commission details table
 * - Admin panel: lookup, override, percentage multiplier, pending accounts
 * - Privacy protections: inactivity timeout, tab switch refresh
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Navigation } from '@/components/Navigation';
import { LoadingOverlay } from '@/components/LoadingSkeleton';
import { useSession } from '@/hooks/useSession';
import { gsCall, getStoredToken } from '@/lib/client/gs-compat';

interface CommissionResult {
  affiliateId?: string;
  unpaidAmount?: number;
  dueNow?: number;
  totalPaid?: number;
  lastPayout?: string;
  status?: string;
  _from_admin?: boolean;
  _admin_override?: Record<string, unknown>;
  _percentage_applied?: string;
  [key: string]: unknown;
}

interface TeacherPaymentInfo {
  email: string;
  name: string;
  studentCount: number;
  totalUnpaid: number;
  totalDueNow: number;
  totalPaid: number;
  lockedUnpaid: number;
  lockedDueNow: number;
  totalLockedEarnings: number;
  accumulatedAmount: number;
  lastPayment: { amount: number; date: string } | null;
}

function CommissionContent() {
  const router = useRouter();
  const { user, isLoading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null);
  const [data, setData] = useState<CommissionResult | null>(null);
  const [currentEmail, setCurrentEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminLookupEmail, setAdminLookupEmail] = useState('');

  // Admin override state
  const [adminUnpaid, setAdminUnpaid] = useState('');
  const [adminDueNow, setAdminDueNow] = useState('');
  const [adminTotalPaid, setAdminTotalPaid] = useState('');
  const [adminLastPayout, setAdminLastPayout] = useState('');
  const [adminStatus, setAdminStatus] = useState('');
  const [adminPercentage, setAdminPercentage] = useState('');
  const [percentageEnabled, setPercentageEnabled] = useState(false);

  // Pending accounts
  const [pendingAccounts, setPendingAccounts] = useState<Record<string, unknown>[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  // Teacher payment tracking
  const [teacherPayments, setTeacherPayments] = useState<TeacherPaymentInfo[]>([]);
  const [teacherPayLoading, setTeacherPayLoading] = useState(false);
  const [teacherPayLoaded, setTeacherPayLoaded] = useState(false);

  // Inactivity timer
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const INACTIVITY_TIMEOUT = useRef(300000); // 5 min, 15 min for admin

  const formatMoney = (amount: number | undefined | null) => {
    if (amount == null) return '-';
    return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' CAD';
  };

  const showMsg = (text: string, color: string) => setMessage({ text, color });

  const startInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      showMsg('Session cleared for privacy', '#94a3b8');
      setData(null);
    }, INACTIVITY_TIMEOUT.current);
  }, []);

  // Fetch commission data
  const fetchData = useCallback(async (email: string, fromAdmin = false) => {
    showMsg('Fetching commission data...', '#64748b');
    try {
      const token = getStoredToken();
      const raw = await gsCall<{ success: boolean; data?: CommissionResult; error?: string }>('lookupAffiliate', email, token);
      
      // The backend returns { success, data: CommissionData } - unwrap the data
      const commData = raw.data || raw as unknown as CommissionResult;
      if (fromAdmin) commData._from_admin = true;
      setData(commData);
      setCurrentEmail(email);
      
      if (!raw.success || raw.error) {
        showMsg(raw.error || 'Affiliate not found for: ' + email, '#dc2626');
      } else {
        showMsg('Commission data loaded successfully!', '#059669');
      }

      if (fromAdmin && commData._admin_override) {
        const ov = commData._admin_override as Record<string, unknown>;
        setAdminUnpaid(ov.unpaidAmount != null ? String(ov.unpaidAmount) : '');
        setAdminDueNow(ov.dueNowAmount != null ? String(ov.dueNowAmount) : '');
        setAdminTotalPaid(ov.totalPaidAmount != null ? String(ov.totalPaidAmount) : '');
        setAdminLastPayout((ov.note as string) || '');
        setAdminStatus((ov.reason as string) || '');
        setAdminPercentage(ov.percentageMultiplier != null ? String(ov.percentageMultiplier) : '');
        setPercentageEnabled(!!(ov.percentageEnabled));
      }

      startInactivityTimer();
    } catch (err) {
      showMsg('Error: ' + (err instanceof Error ? err.message : String(err)), '#dc2626');
    }
  }, [startInactivityTimer]);

  // Load pending accounts
  const loadPendingAccounts = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    try {
      const result = await gsCall<{ success: boolean; pending?: Record<string, unknown>[]; count?: number }>(
        'adminGetPendingAccounts', token
      );
      if (result.success) {
        setPendingAccounts(result.pending || []);
        setPendingCount(result.count || 0);
      }
    } catch (err) {
      console.error('Error loading pending:', err);
    }
  }, []);

  // Initialize
  useEffect(() => {
    if (sessionLoading || !user) return;
    setIsAdmin(user.isAdmin);
    setCurrentEmail(user.email);
    setLoading(false);

    if (user.isAdmin) {
      setIsAdminMode(true);
      INACTIVITY_TIMEOUT.current = 900000;
      loadPendingAccounts();
    } else {
      fetchData(user.email);
    }
  }, [sessionLoading, user, fetchData, loadPendingAccounts]);

  // Privacy: restart timer on user activity
  useEffect(() => {
    const handler = () => startInactivityTimer();
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(e =>
      document.addEventListener(e, handler, true)
    );
    return () => {
      ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(e =>
        document.removeEventListener(e, handler, true)
      );
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [startInactivityTimer]);

  const handleAdminLookup = () => {
    if (!adminLookupEmail.trim() || !adminLookupEmail.includes('@')) {
      showMsg('Please enter a valid affiliate email', '#dc2626');
      return;
    }
    fetchData(adminLookupEmail.trim().toLowerCase(), true);
  };

  const handleSaveOverride = async () => {
    if (!currentEmail) { showMsg('Lookup an affiliate first', '#dc2626'); return; }
    try {
      const token = getStoredToken();
      await gsCall('saveAdminOverride', currentEmail, {
        unpaidAmount: adminUnpaid ? Number(adminUnpaid) : null,
        dueNowAmount: adminDueNow ? Number(adminDueNow) : null,
        totalPaidAmount: adminTotalPaid ? Number(adminTotalPaid) : null,
        note: adminLastPayout || null,
        reason: adminStatus || null,
        percentageMultiplier: percentageEnabled && adminPercentage ? Number(adminPercentage) : null,
        percentageEnabled: percentageEnabled,
      }, token);
      showMsg('Override saved successfully!', '#059669');
      setTimeout(() => fetchData(currentEmail, true), 500);
    } catch (err) {
      showMsg('Error saving: ' + (err instanceof Error ? err.message : ''), '#dc2626');
    }
  };

  const handleRemoveOverride = async () => {
    if (!currentEmail) return;
    try {
      const token = getStoredToken();
      await gsCall('removeAdminOverride', currentEmail, token);
      showMsg('Override removed!', '#059669');
      setAdminUnpaid(''); setAdminDueNow(''); setAdminTotalPaid('');
      setAdminLastPayout(''); setAdminStatus(''); setAdminPercentage('');
      setPercentageEnabled(false);
      setTimeout(() => fetchData(currentEmail, true), 500);
    } catch (err) {
      showMsg('Error: ' + (err instanceof Error ? err.message : ''), '#dc2626');
    }
  };

  const loadTeacherPayments = async () => {
    setTeacherPayLoading(true);
    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; teachers?: TeacherPaymentInfo[]; error?: string }>(
        'getAllTeachersPaymentData', token
      );
      if (result.success && result.teachers) {
        setTeacherPayments(result.teachers);
        setTeacherPayLoaded(true);
      } else {
        showMsg((result as { error?: string }).error || 'Failed to load teachers', '#dc2626');
      }
    } catch (err) {
      showMsg('Error: ' + (err instanceof Error ? err.message : ''), '#dc2626');
    } finally {
      setTeacherPayLoading(false);
    }
  };

  const handlePayTeacher = async (teacherEmail: string, defaultAmount: number, customInput?: string) => {
    const customAmount = customInput ? parseFloat(customInput) : 0;
    const amountToPay = customAmount > 0 ? customAmount : defaultAmount;
    if (amountToPay <= 0) { alert('Payment amount must be greater than $0.00'); return; }
    let confirmMsg = `Mark payment as completed for ${teacherEmail}?\n\nAmount: ${formatMoney(amountToPay)}`;
    if (customAmount > 0) confirmMsg += `\n\nUsing custom amount: ${formatMoney(customAmount)}`;
    confirmMsg += '\n\nThis will reset their accumulated amount to $0.';
    if (!confirm(confirmMsg)) return;
    try {
      const token = getStoredToken();
      await gsCall('recordTeacherPayment', teacherEmail, amountToPay, token);
      alert('Payment recorded successfully!');
      loadTeacherPayments();
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : ''));
    }
  };

  const handleRejectAccount = async (email: string) => {
    const reason = prompt('Reason for rejection (optional):');
    if (reason === null) return;
    const token = getStoredToken();
    if (!token) return;
    try {
      await gsCall('adminRejectAccount', email, reason, token);
      showMsg('Account rejected: ' + email, '#dc2626');
      loadPendingAccounts();
    } catch (err) {
      showMsg('Error rejecting: ' + (err instanceof Error ? err.message : ''), '#dc2626');
    }
  };

  if (sessionLoading || loading) {
    return <LoadingOverlay message="Loading Commission Portal..." />;
  }

  return (
    <div className="page-bg">
      <div className="header">
        <Navigation title="Commission Lookup" variant="dark-bg" />
      </div>

      <div className="container">
        <h2>Affiliate Commission Lookup</h2>

        {/* Field explanations */}
        <div className="info-box">
          <strong>Field Explanations:</strong>
          <div style={{ marginLeft: 8 }}>
            <strong>Unpaid Amount:</strong> Total commissions not yet paid (includes pending + approved)<br />
            <strong>Due Now:</strong> Approved commissions ready for immediate payout (subset of unpaid)<br />
            <strong>Total Paid:</strong> Total amount already paid out historically
          </div>
        </div>

        {/* Logged in identity */}
        {!isAdminMode && (
          <div className="identity-box">
            <div className="identity-inner">
              <div>
                <div className="identity-label">Viewing Commission Data For:</div>
                <div className="identity-email">{currentEmail}</div>
              </div>
              <button className="btn-refresh" onClick={() => fetchData(currentEmail)}>Refresh Data</button>
            </div>
          </div>
        )}

        {/* Message */}
        {message && <div className="msg" style={{ color: message.color }}>{message.text}</div>}

        {/* Regular affiliate results */}
        {data && data.status !== 'Not found' && !isAdminMode && (
          <div className="results-section">
            <h3>Commission Details</h3>
            <table className="data-table">
              <tbody>
                <tr><td>Affiliate ID</td><td>{(data.affiliateId as string) || '-'}</td></tr>
                <tr><td>Unpaid Amount</td><td>{formatMoney(data.unpaidAmount as number)}</td></tr>
                <tr><td>Due Now</td><td>{formatMoney(data.dueNowAmount as number)}</td></tr>
                <tr><td>Total Paid</td><td>{formatMoney(data.totalPaidAmount as number)}</td></tr>
                <tr><td>Last Payout</td><td>{(data.lastFetchedAt ? new Date(data.lastFetchedAt as number).toLocaleDateString() : '-')}</td></tr>
                <tr><td>Status</td><td>{data.percentageApplied ? `${data.percentage}% applied` : 'Active'}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Admin Interface */}
        {isAdmin && isAdminMode && (
          <>
            <hr className="divider" />
            {/* Pending accounts */}
            <div className="admin-panel">
              <h4>Pending Account Requests <span className="pending-badge">{pendingCount}</span></h4>
              <button className="btn-sm" onClick={loadPendingAccounts}>Refresh</button>
              <div className="pending-list">
                {pendingCount === 0 ? (
                  <p className="success-text">No pending requests</p>
                ) : (
                  pendingAccounts.map((acc, i) => {
                    const email = (acc.aliasEmail || acc.email) as string;
                    const name = (((acc.firstName || '') + ' ' + (acc.lastName || '')).trim() || '(not provided)') as string;
                    const date = acc.requestedAt ? new Date(acc.requestedAt as string).toLocaleDateString() : 'Unknown';
                    return (
                      <div key={i} className="pending-card">
                        <div className="pending-info">
                          <div className="pending-email">{email} <span className="new-tag">New</span></div>
                          <div className="pending-meta">{name} - Requested: {date}</div>
                        </div>
                        <div className="pending-actions">
                          <button className="btn-approve" onClick={() => router.push('/admin')}>Review</button>
                          <button className="btn-reject" onClick={() => handleRejectAccount(email)}>Reject</button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Admin lookup */}
            <div className="admin-panel">
              <h4>Lookup Any Affiliate Email</h4>
              <input
                type="email"
                className="admin-input"
                value={adminLookupEmail}
                onChange={(e) => setAdminLookupEmail(e.target.value)}
                placeholder="Enter any affiliate email to manage"
              />
              <button className="btn-green" onClick={handleAdminLookup}>Lookup &amp; Manage</button>
            </div>

            {/* Admin results */}
            {data && data._from_admin && (
              <>
                <div className="admin-data-section">
                  <h4>Current Data</h4>
                  <table className="data-table">
                    <tbody>
                      <tr><td>Affiliate ID</td><td>{(data.affiliateId as string) || '-'}</td></tr>
                      <tr><td>Unpaid Amount</td><td>{formatMoney(data.unpaidAmount as number)}</td></tr>
                      <tr><td>Due Now</td><td>{formatMoney(data.dueNowAmount as number)}</td></tr>
                      <tr><td>Total Paid</td><td>{formatMoney(data.totalPaidAmount as number)}</td></tr>
                      <tr><td>Last Payout</td><td>{data.lastFetchedAt ? new Date(data.lastFetchedAt as number).toLocaleDateString() : '-'}</td></tr>
                      <tr><td>Status</td><td>{data.percentageApplied ? `${data.percentage}% applied` : 'Active'}</td></tr>
                      {data._admin_override && (
                        <tr><td colSpan={2} style={{ color: '#dc2626', fontWeight: 'bold' }}>[!] Has Override</td></tr>
                      )}
                      {data._percentage_applied && (
                        <tr><td colSpan={2} className="pct-note">Percentage Multiplier Applied: {data._percentage_applied}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Override form */}
                <div className="override-section">
                  <h4>Override Values</h4>
                  {[
                    { label: 'Unpaid Amount (CAD)', val: adminUnpaid, set: setAdminUnpaid, type: 'number' },
                    { label: 'Due Now (CAD)', val: adminDueNow, set: setAdminDueNow, type: 'number' },
                    { label: 'Total Paid (CAD)', val: adminTotalPaid, set: setAdminTotalPaid, type: 'number' },
                    { label: 'Last Payout', val: adminLastPayout, set: setAdminLastPayout, type: 'text' },
                  ].map(({ label, val, set, type }) => (
                    <div key={label} className="override-field">
                      <label>{label}</label>
                      <input type={type} value={val} onChange={(e) => set(e.target.value)} placeholder="Leave empty for API value" />
                    </div>
                  ))}
                  <div className="override-field">
                    <label>Status</label>
                    <select value={adminStatus} onChange={(e) => setAdminStatus(e.target.value)}>
                      <option value="">Use API value</option>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="suspended">Suspended</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>

                  {/* Percentage multiplier */}
                  <div className="pct-panel">
                    <div className="pct-header">
                      <label>Percentage Multiplier</label>
                      <label className="toggle">
                        <input type="checkbox" checked={percentageEnabled} onChange={(e) => setPercentageEnabled(e.target.checked)} />
                        <span className="toggle-track" />
                        <span className="toggle-thumb" />
                      </label>
                    </div>
                    <p className="pct-hint">When enabled, reduce displayed Unpaid and Due Now by percentage. E.g., 50 = show 50% of real values.</p>
                    <div className="pct-input-row">
                      <input type="number" min={0} max={100} value={adminPercentage} onChange={(e) => setAdminPercentage(e.target.value)} placeholder="100" />
                      <span>%</span>
                    </div>
                  </div>

                  <div className="override-actions">
                    <button className="btn-green" onClick={handleSaveOverride}>Save Override</button>
                    <button className="btn-red" onClick={handleRemoveOverride}>Remove Override</button>
                    <button className="btn-blue" onClick={() => fetchData(currentEmail, true)}>Refresh Data</button>
                  </div>
                </div>
              </>
            )}

            {/* Exit Admin Mode */}
            <button className="btn-gray" style={{ width: '100%', marginTop: 16 }} onClick={() => {
              setIsAdminMode(false);
              setData(null);
              if (user) fetchData(user.email);
            }}>Exit Admin Mode</button>

            {/* Teacher Payment Tracking */}
            <div className="teacher-payment-section">
              <div className="teacher-payment-header">
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24 }}>&#x1F468;&#x200D;&#x1F3EB;</span>
                  Teacher Payment Tracking
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#78350f' }}>
                  Track and manage teacher payments based on their adjusted totals (teacher&apos;s percentage applied to all students&apos; due amounts)
                </p>
              </div>

              <div style={{ marginBottom: 16, textAlign: 'center', display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn-blue" onClick={loadTeacherPayments} disabled={teacherPayLoading}>
                  {teacherPayLoading ? 'Loading...' : 'Load All Teachers'}
                </button>
                <button className="btn-green" onClick={async () => {
                  try { await gsCall('clearAllCaches'); } catch { /* ok */ }
                  loadTeacherPayments();
                }} disabled={teacherPayLoading}>
                  Force Refresh
                </button>
              </div>

              {teacherPayLoaded && teacherPayments.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', background: '#f1f5f9', borderRadius: 12, color: '#64748b' }}>
                  <strong>No teachers found</strong><br /><br />
                  To add teachers, go to the Teacher Portal and have teachers add students to their accounts.
                </div>
              )}

              {teacherPayments.map((t, i) => (
                <div key={t.email} className="teacher-card">
                  <div className="teacher-card-header">
                    <div>
                      <h4 style={{ margin: '0 0 4px', fontSize: 18 }}>&#x1F468;&#x200D;&#x1F3EB; {t.name}</h4>
                      <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{t.email}</p>
                    </div>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px', fontWeight: 600 }}>Current Student Totals (100% raw values)</p>
                    <div className="stat-grid-3">
                      <div className="stat-mini">
                        <div className="stat-mini-val">{t.studentCount}</div>
                        <div className="stat-mini-label">Total Students</div>
                      </div>
                      <div className="stat-mini">
                        <div className="stat-mini-val">{formatMoney(t.totalUnpaid)}</div>
                        <div className="stat-mini-label">Total Unpaid</div>
                      </div>
                      <div className="stat-mini">
                        <div className="stat-mini-val">{formatMoney(t.totalDueNow)}</div>
                        <div className="stat-mini-label">Total Due Now</div>
                      </div>
                    </div>
                  </div>

                  <div className="locked-earnings-box">
                    <p style={{ fontSize: 12, color: '#047857', margin: '0 0 10px', fontWeight: 600 }}>Locked Earnings (cumulative)</p>
                    <div className="stat-grid-3">
                      <div className="stat-mini-white">
                        <div className="stat-mini-val" style={{ color: '#16a34a' }}>{formatMoney(t.lockedUnpaid)}</div>
                        <div className="stat-mini-label">Locked Unpaid</div>
                      </div>
                      <div className="stat-mini-white">
                        <div className="stat-mini-val" style={{ color: '#16a34a' }}>{formatMoney(t.lockedDueNow)}</div>
                        <div className="stat-mini-label">Locked Due Now</div>
                      </div>
                      <div className="stat-mini-blue">
                        <div className="stat-mini-val" style={{ color: '#2563eb' }}>{formatMoney(t.totalLockedEarnings)}</div>
                        <div className="stat-mini-label">Total Locked</div>
                      </div>
                    </div>
                  </div>

                  {t.lastPayment && (
                    <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#64748b' }}>
                      <strong style={{ color: '#475569' }}>Last Payment:</strong> {formatMoney(t.lastPayment.amount)} on {new Date(t.lastPayment.date).toLocaleDateString()}
                    </div>
                  )}

                  <div style={{ marginBottom: 12 }}>
                    <input
                      type="number"
                      id={`customAmount_${i}`}
                      placeholder="Enter custom amount (optional)"
                      step="0.01"
                      min="0"
                      className="admin-input"
                      style={{ marginBottom: 8 }}
                    />
                  </div>

                  <button
                    className="btn-green"
                    style={{ width: '100%', fontSize: 16, fontWeight: 600 }}
                    onClick={() => {
                      const input = document.getElementById(`customAmount_${i}`) as HTMLInputElement;
                      handlePayTeacher(t.email, t.accumulatedAmount, input?.value);
                    }}
                  >
                    Pay Now - {formatMoney(t.accumulatedAmount)}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .page-bg {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px 10px;
        }

        .header { max-width: 800px; margin: 0 auto 20px; }

        .container {
          background: rgba(255,255,255,0.95); backdrop-filter: blur(10px);
          border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          padding: 30px; max-width: 800px; margin: 0 auto;
          animation: fadeIn 0.6s ease-out;
        }
        @keyframes fadeIn { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }

        h2 { color: #1e293b; font-size: 28px; font-weight: 700; text-align: center; margin-bottom: 8px; }
        h3 { color: #1e293b; font-size: 20px; font-weight: 700; margin-bottom: 16px; }
        h4 { color: #1e293b; font-size: 18px; font-weight: 700; margin: 0 0 12px; }

        .info-box {
          font-size: 13px; margin-bottom: 20px; padding: 16px;
          background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%);
          border-radius: 12px; color: #1e40af; border-left: 4px solid #3b82f6; line-height: 1.6;
        }
        .info-box strong { color: #1e3a8a; display: block; margin-bottom: 8px; font-size: 14px; }

        .identity-box { margin-bottom: 20px; }
        .identity-inner {
          background: linear-gradient(135deg, #f0fdf4, #dcfce7); padding: 16px 20px;
          border-radius: 12px; border: 2px solid #22c55e;
          display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
        }
        .identity-label { font-size: 13px; color: #16a34a; font-weight: 600; margin-bottom: 4px; }
        .identity-email { font-size: 16px; color: #166534; font-weight: 700; }

        .btn-refresh {
          padding: 10px 20px; background: linear-gradient(135deg, #22c55e, #16a34a);
          color: white; border: none; border-radius: 10px; cursor: pointer;
          font-weight: 600; font-size: 14px; font-family: inherit;
        }
        .btn-refresh:hover { transform: translateY(-2px); }

        .msg {
          margin: 16px 0; padding: 16px; border-radius: 12px;
          background: #f1f5f9; border-left: 4px solid #667eea; font-size: 15px; font-weight: 500;
        }

        .results-section { margin-top: 24px; }

        .data-table {
          width: 100%; border-collapse: collapse; font-size: 15px;
          background: white; border-radius: 12px; overflow: hidden;
          box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        }
        .data-table td {
          padding: 16px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: top;
        }
        .data-table td:first-child { font-weight: 600; color: #475569; width: 45%; }
        .data-table td:last-child { color: #1e293b; font-weight: 500; }
        .data-table tr:last-child td { border-bottom: none; }
        .data-table tr:hover { background: #f8fafc; }

        .pct-note { background: #fef3c7; border-left: 4px solid #fbbf24; padding: 12px !important; font-size: 12px; }

        .divider { margin: 24px 0; border: none; height: 1px; background: linear-gradient(90deg, transparent, #e2e8f0, transparent); }

        .admin-panel {
          margin: 20px 0; padding: 20px; border: 2px solid #fbbf24;
          border-radius: 16px; background: linear-gradient(135deg, #fef3c7, #fde68a);
        }
        .admin-panel h4 { color: #92400e; display: flex; align-items: center; gap: 8px; }
        .pending-badge {
          background: #f59e0b; color: white; padding: 2px 8px;
          border-radius: 12px; font-size: 12px; font-weight: bold;
        }

        .btn-sm {
          padding: 4px 12px; background: #d97706; color: white; border: none;
          border-radius: 6px; cursor: pointer; font-size: 12px; margin-bottom: 12px; font-family: inherit;
        }

        .pending-list { max-height: 300px; overflow-y: auto; }
        .pending-card {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; background: white; border-radius: 8px;
          border: 1px solid #e2e8f0; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;
        }
        .pending-email { font-weight: 600; color: #1e293b; font-size: 13px; }
        .new-tag {
          background: #f59e0b; color: white; padding: 1px 6px; border-radius: 4px;
          font-size: 10px; margin-left: 6px;
        }
        .pending-meta { font-size: 12px; color: #64748b; margin-top: 2px; }
        .pending-actions { display: flex; gap: 6px; }
        .btn-approve {
          padding: 6px 12px; background: linear-gradient(135deg, #16a34a, #059669);
          color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; font-family: inherit;
        }
        .btn-reject {
          padding: 6px 12px; background: #dc2626; color: white; border: none;
          border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; font-family: inherit;
        }
        .success-text { color: #16a34a; font-size: 13px; margin: 0; }

        .admin-input {
          width: 100%; padding: 16px; margin: 10px 0 16px; border: 2px solid #e2e8f0;
          border-radius: 12px; font-size: 16px; background: white; font-family: inherit;
        }
        .admin-input:focus { outline: none; border-color: #667eea; box-shadow: 0 0 0 4px rgba(102,126,234,0.1); }

        .btn-green, .btn-red, .btn-blue {
          width: 100%; padding: 16px 24px; border-radius: 12px; border: none;
          color: white; cursor: pointer; font-size: 16px; font-weight: 600;
          transition: all 0.3s ease; margin: 4px 0; font-family: inherit;
        }
        .btn-green { background: linear-gradient(135deg, #10b981, #059669); }
        .btn-red { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .btn-blue { background: linear-gradient(135deg, #3b82f6, #2563eb); }
        .btn-green:hover, .btn-red:hover, .btn-blue:hover { transform: translateY(-2px); }

        .admin-data-section {
          margin: 20px 0; padding: 20px; border: 2px solid #e2e8f0;
          border-radius: 16px; background: white;
        }

        .override-section {
          margin: 20px 0; padding: 20px; border: 2px solid #60a5fa;
          border-radius: 16px; background: linear-gradient(135deg, #dbeafe, #bfdbfe);
        }
        .override-section h4 { color: #1e40af; }

        .override-field { margin: 12px 0; }
        .override-field label { font-weight: 600; color: #475569; margin-bottom: 8px; display: block; font-size: 15px; }
        .override-field input, .override-field select {
          width: 100%; padding: 16px; border: 2px solid #e2e8f0; border-radius: 12px;
          font-size: 16px; background: white; font-family: inherit;
        }
        .override-field input:focus, .override-field select:focus {
          outline: none; border-color: #667eea; box-shadow: 0 0 0 4px rgba(102,126,234,0.1);
        }

        .pct-panel {
          margin: 16px 0; padding: 16px; background: #fef3c7;
          border-radius: 12px; border-left: 4px solid #fbbf24;
        }
        .pct-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .pct-header label:first-child { font-weight: bold; color: #92400e; margin: 0; }
        .pct-hint { font-size: 12px; color: #78350f; line-height: 1.5; margin-bottom: 10px; }
        .pct-input-row { display: flex; align-items: center; gap: 8px; }
        .pct-input-row input { width: 120px; padding: 12px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 16px; font-family: inherit; }
        .pct-input-row span { font-weight: bold; color: #92400e; }

        .toggle { position: relative; display: inline-block; width: 48px; height: 26px; margin: 0; cursor: pointer; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .toggle-track {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background-color: #cbd5e1; transition: 0.4s; border-radius: 26px;
        }
        .toggle input:checked + .toggle-track { background-color: #10b981; }
        .toggle-thumb {
          position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px;
          background-color: white; transition: 0.4s; border-radius: 50%;
        }
        .toggle input:checked ~ .toggle-thumb { transform: translateX(22px); }

        .override-actions { margin-top: 16px; display: grid; gap: 10px; }

        .btn-gray {
          padding: 16px 24px; border-radius: 12px; border: none;
          background: linear-gradient(135deg, #64748b, #475569);
          color: white; cursor: pointer; font-size: 16px; font-weight: 600;
          transition: all 0.3s ease; font-family: inherit;
        }
        .btn-gray:hover { transform: translateY(-2px); }

        .teacher-payment-section {
          margin-top: 24px; padding-top: 24px;
          border-top: 2px solid #e2e8f0;
        }

        .teacher-payment-header {
          padding: 20px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          border-radius: 16px; border: 2px solid #f59e0b; margin-bottom: 20px;
          color: #92400e;
        }

        .teacher-card {
          margin-bottom: 20px; padding: 20px; background: white;
          border-radius: 16px; border: 2px solid #e2e8f0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        .teacher-card-header {
          display: flex; justify-content: space-between; align-items: start;
          margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
        }

        .stat-grid-3 {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
        }

        .stat-mini {
          padding: 12px; background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
          border-radius: 10px; text-align: center; border: 1px solid #cbd5e1;
        }
        .stat-mini-val { font-size: 18px; font-weight: 700; color: #475569; }
        .stat-mini-label { font-size: 10px; color: #64748b; margin-top: 2px; }

        .stat-mini-white {
          padding: 12px; background: white; border-radius: 10px;
          text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .stat-mini-blue {
          padding: 12px; background: linear-gradient(135deg, #dbeafe, #bfdbfe);
          border-radius: 10px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .locked-earnings-box {
          margin-bottom: 16px; padding: 16px;
          background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
          border-radius: 12px; border: 1px solid #a7f3d0;
        }

        @media (max-width: 768px) {
          .container { padding: 20px; }
          h2 { font-size: 24px; }
          .data-table { font-size: 14px; }
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
