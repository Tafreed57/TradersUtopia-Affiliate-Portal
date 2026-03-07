'use client';

/**
 * Clipper Dashboard
 *
 * Clipper view with attendance, commission lookup, and referrals.
 * Same layout as the student dashboard but without:
 * - Teacher selection
 * - Admin section
 *
 * Uses mode="clipper" for separate attendance records.
 */

import { useState, useEffect, useCallback } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Navigation } from '@/components/Navigation';
import { LoadingOverlay } from '@/components/LoadingSkeleton';
import { useSession } from '@/hooks/useSession';
import { gsCall, getStoredToken } from '@/lib/client/gs-compat';
import { formatDateString } from '@/lib/utils';

interface AttendanceRecord {
  date: string;
  confirmedAt?: string;
  type?: string;
  id?: string;
}

interface AttendancePageData {
  user: { email: string; name?: string; createdAt?: string };
  records: AttendanceRecord[];
  stats: { totalConfirmed: number; totalMissed: number; streak: number; firstConfirmationDate?: string };
  needsTeacherAssignment: boolean;
}

interface CommissionResult {
  affiliateId?: string;
  unpaidAmount?: number;
  dueNowAmount?: number;
  totalPaidAmount?: number;
  lastFetchedAt?: number;
  percentage?: number;
  percentageApplied?: boolean;
  status?: string;
  [key: string]: unknown;
}

interface ReferralRow {
  state?: string; firstClickAt?: string; becameLeadAt?: string; convertedAt?: string;
  becameConversionAt?: string; createdAt?: string;
  [key: string]: unknown;
}

function ClipperContent() {
  const { user, isLoading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AttendancePageData | null>(null);
  const [msg, setMsg] = useState<{ text: string; type: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Commission
  const [commData, setCommData] = useState<CommissionResult | null>(null);
  const [commLoading, setCommLoading] = useState(false);

  // Referrals
  const [refMode, setRefMode] = useState<'leads' | 'conversions'>('leads');
  const [refRows, setRefRows] = useState<ReferralRow[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refPage, setRefPage] = useState(1);
  const [refTotal, setRefTotal] = useState(0);
  const [refLeadsCount, setRefLeadsCount] = useState(0);
  const [refConversionsCount, setRefConversionsCount] = useState(0);
  const [refInitialLoad, setRefInitialLoad] = useState(true);

  const [supervisorViewAsEmail, setSupervisorViewAsEmail] = useState('');
  const [committedViewAsEmail, setCommittedViewAsEmail] = useState('');
  const canViewAs = user?.isSupervisor || user?.isAdmin;
  const effectiveEmail = (canViewAs && committedViewAsEmail)
    ? committedViewAsEmail
    : user?.email ?? '';

  const loadData = useCallback(async (overrideEmail?: string) => {
    const email = overrideEmail ?? effectiveEmail;
    if (!email) return;
    setLoading(true);
    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; data?: AttendancePageData; error?: string }>(
        'getAttendanceData', email, token, 'clipper'
      );
      if (result.success && result.data) {
        setData(result.data);
      } else if (result.success && !result.data) {
        const flat = result as unknown as AttendancePageData;
        if (flat.records || flat.stats) {
          setData(flat);
        } else {
          setMsg({ text: 'No attendance data found', type: 'error' });
        }
      } else {
        setMsg({ text: result.error || 'Failed to load', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [user, effectiveEmail]);

  const formatMoney = (amount: number | undefined | null) => {
    if (amount == null) return '-';
    return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' CAD';
  };

  const fetchCommission = useCallback(async (email?: string) => {
    const target = email ?? effectiveEmail;
    if (!target) return;
    setCommLoading(true);
    try {
      const token = getStoredToken();
      const raw = await gsCall<{ success: boolean; data?: CommissionResult; error?: string }>('lookupAffiliate', target, token ?? undefined);
      const result = raw.data || raw as unknown as CommissionResult;
      if (raw.success) {
        setCommData(result);
      }
    } catch { /* silent */ }
    finally { setCommLoading(false); }
  }, [effectiveEmail]);

  const loadReferrals = useCallback(async (mode: 'leads' | 'conversions', page: number, forceRefresh?: boolean) => {
    const target = effectiveEmail;
    if (!target) return;
    setRefLoading(true);
    try {
      const result = await gsCall<{
        success: boolean; rows?: ReferralRow[]; totalCount?: number;
        leadsCount?: number; conversionsCount?: number;
      }>(
        forceRefresh ? 'getReferralsWithModeRefresh' : 'getReferralsWithMode',
        { email: target, mode, page, pageSize: 25 }
      );
      if (result.success) {
        setRefRows(result.rows || []);
        setRefTotal(result.totalCount || 0);
        if (result.leadsCount !== undefined) setRefLeadsCount(result.leadsCount);
        if (result.conversionsCount !== undefined) setRefConversionsCount(result.conversionsCount);
      }
    } catch { /* silent */ }
    finally { setRefLoading(false); setRefInitialLoad(false); }
  }, [effectiveEmail]);

  useEffect(() => {
    if (!sessionLoading && user) loadData();
  }, [sessionLoading, user, loadData]);

  useEffect(() => {
    if (!sessionLoading && user) fetchCommission();
  }, [sessionLoading, user, fetchCommission]);

  useEffect(() => {
    if (data) loadReferrals(refMode, refPage);
  }, [data, refMode, refPage, loadReferrals]);

  const handleConfirm = async () => {
    if (confirming || !effectiveEmail) return;
    setConfirming(true);
    try {
      const today = formatDateString(new Date());
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; error?: string; date?: string; confirmationNumber?: number }>(
        'confirmAttendance', effectiveEmail, today, token, 'clipper'
      );
      if (result.success) {
        setMsg({ text: 'Clipping attendance confirmed!', type: 'success' });
        if (data) {
          const newRecord = {
            date: result.date || today,
            confirmedAt: new Date().toISOString(),
            type: 'confirmed' as const,
          };
          setData({
            ...data,
            records: [newRecord, ...data.records],
            stats: {
              ...data.stats,
              totalConfirmed: data.stats.totalConfirmed + 1,
            },
          });
        }
      } else {
        setMsg({ text: result.error || 'Failed', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally { setConfirming(false); }
  };

  const handleDeleteRecord = async (dateStr: string) => {
    if (!effectiveEmail) return;
    const token = getStoredToken();
    try {
      const result = await gsCall<{ success: boolean; error?: string }>(
        'deleteOwnAttendanceRecord', effectiveEmail, dateStr, token
      );
      if (result.success) {
        setMsg({ text: 'Record deleted', type: 'success' });
        loadData();
      } else {
        setMsg({ text: result.error || 'Failed to delete', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const todayDateStr = formatDateString(now);
  const todayConfirmed = data?.records?.some(r => r.date.split('T')[0] === todayDateStr && r.type === 'confirmed') || false;
  const totalDays = (data?.stats?.totalConfirmed || 0) + (data?.stats?.totalMissed || 0);
  const attendanceRate = totalDays > 0 ? Math.round(((data?.stats?.totalConfirmed || 0) / totalDays) * 100) + '%' : '0%';

  if (sessionLoading || loading) {
    return <LoadingOverlay message="Loading Clipper Dashboard..." />;
  }

  return (
    <div className="page-bg">
      <div className="page-container">
        <Navigation title="Clipper Dashboard" variant="light-bg" />

        {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}

        {/* Supervisor/Admin: view as student by email (clipper attendance) */}
        {canViewAs && (
          <div className="supervisor-bar">
            <label>View as student:</label>
            <input
              type="email"
              value={supervisorViewAsEmail}
              onChange={(e) => setSupervisorViewAsEmail(e.target.value)}
              placeholder="Enter student email..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const trimmed = supervisorViewAsEmail.trim();
                  if (trimmed) { setCommittedViewAsEmail(trimmed); loadData(trimmed); }
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = supervisorViewAsEmail.trim();
                if (trimmed) { setCommittedViewAsEmail(trimmed); loadData(trimmed); }
              }}
            >
              View
            </button>
          </div>
        )}

        {data && (
          <>
            {/* Welcome card */}
            <div className="welcome-card">
              <div className="clipper-badge">CLIPPING MODE</div>
              <h2>Welcome, {user?.name || data.user.email}!</h2>
              <p>{data.user.email}</p>
              <p className="datetime">{todayStr} - {timeStr}</p>
            </div>

            {/* Today's attendance */}
            <div className="today-card">
              <div className="today-header">
                <h3>Today&apos;s Clipping Attendance</h3>
                <span className="today-date">{todayDateStr}</span>
              </div>
              <div className="today-status">
                {todayConfirmed ? (
                  <span className="status-confirmed">Confirmed</span>
                ) : (
                  <span className="status-pending">Pending</span>
                )}
              </div>
              <button
                className={`confirm-btn ${todayConfirmed ? 'confirmed' : ''}`}
                onClick={handleConfirm}
                disabled={confirming}
              >
                {confirming ? 'Confirming...' : todayConfirmed ? 'Confirm Again' : 'Confirm Clipping Attendance'}
              </button>
            </div>

            {/* Stats */}
            <div className="stats-grid">
              <div className="stat-card blue"><div className="stat-val">{data.stats.totalConfirmed}</div><div className="stat-lbl">Days Confirmed</div></div>
              <div className="stat-card green"><div className="stat-val">{data.stats.streak}</div><div className="stat-lbl">Current Streak</div></div>
              <div className="stat-card red"><div className="stat-val">{data.stats.totalMissed}</div><div className="stat-lbl">Days Missed</div></div>
              <div className="stat-card yellow"><div className="stat-val">{attendanceRate}</div><div className="stat-lbl">Attendance Rate</div></div>
            </div>

            {/* Attendance history */}
            <div className="section-card">
              <h3>Clipping History</h3>
              <div className="records-list">
                {data.records.length === 0 ? (
                  <p className="empty-msg">No clipping attendance records yet</p>
                ) : (
                  data.records.slice(0, 50).map((r, i) => {
                    const baseDate = r.date.split('T')[0];
                    const recordTime = r.type === 'confirmed' && r.confirmedAt
                      ? new Date(r.confirmedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                      : '';
                    return (
                      <div key={i} className="record-row">
                        <span className="record-date">
                          {baseDate}
                          {recordTime && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{recordTime}</span>}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`record-status ${r.type === 'confirmed' ? 'confirmed' : 'missed'}`}>
                            {r.type === 'confirmed' ? 'Confirmed' : 'Missed'}
                          </span>
                          {r.type === 'confirmed' && (
                            <button className="btn-delete-record" onClick={() => handleDeleteRecord(r.date)}>Delete</button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Commission Lookup - hide from supervisors viewing other users */}
            {!(user?.isSupervisor && !user?.isAdmin && committedViewAsEmail) && (
              <div className="section-card commission-section">
                <div className="commission-header">
                  <h3>Commission Lookup</h3>
                  <button className="btn-refresh-comm" onClick={() => fetchCommission()} disabled={commLoading}>
                    {commLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>

                <div className="commission-info-box">
                  <strong>Field Explanations:</strong>
                  <div style={{ marginLeft: 8 }}>
                    <strong>Unpaid Amount:</strong> Total commissions not yet paid (includes pending + approved)<br />
                    <strong>Due Now:</strong> Approved commissions ready for immediate payout (subset of unpaid)<br />
                    <strong>Total Paid:</strong> Total amount already paid out historically
                  </div>
                </div>

                {commLoading && !commData && <p className="loading-text">Fetching commission data...</p>}

                {commData && (
                  <table className="commission-table">
                    <tbody>
                      <tr><td>Affiliate ID</td><td>{(commData.affiliateId as string) || '-'}</td></tr>
                      <tr><td>Unpaid Amount</td><td>{formatMoney(commData.unpaidAmount as number)}</td></tr>
                      <tr><td>Due Now</td><td>{formatMoney(commData.dueNowAmount as number)}</td></tr>
                      <tr><td>Total Paid</td><td>{formatMoney(commData.totalPaidAmount as number)}</td></tr>
                      <tr><td>Last Fetched</td><td>{commData.lastFetchedAt ? new Date(commData.lastFetchedAt as number).toLocaleDateString() : '-'}</td></tr>
                      <tr><td>Status</td><td>{commData.percentageApplied ? `${commData.percentage}% applied` : 'Active'}</td></tr>
                    </tbody>
                  </table>
                )}

                {!commLoading && !commData && (
                  <p className="empty-msg">No commission data available</p>
                )}
              </div>
            )}

            {/* Referrals */}
            <div className="section-card referrals">
              <div className="ref-header">
                <h3>Referrals</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {(refLeadsCount > 0 || refConversionsCount > 0) && (
                    <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 4 }}>
                      {refLeadsCount} leads · {refConversionsCount} conversions
                    </span>
                  )}
                  <button
                    title="Refresh from Rewardful"
                    disabled={refLoading}
                    onClick={() => loadReferrals(refMode, refPage, true)}
                    style={{ background: 'none', border: 'none', cursor: refLoading ? 'not-allowed' : 'pointer', padding: 4, color: '#94a3b8', display: 'flex', alignItems: 'center' }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ animation: refLoading ? 'spin 1s linear infinite' : 'none' }}>
                      <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                  </button>
                  <div className="ref-toggle">
                    <button className={refMode === 'leads' ? 'active' : ''} onClick={() => { setRefMode('leads'); setRefPage(1); }}>Leads</button>
                    <button className={refMode === 'conversions' ? 'active' : ''} onClick={() => { setRefMode('conversions'); setRefPage(1); }}>Conversions</button>
                  </div>
                </div>
              </div>
              {refLoading && refInitialLoad ? (
                <div style={{ padding: '24px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div className="ref-skeleton-spinner" />
                    <div>
                      <p style={{ margin: 0, color: '#e2e8f0', fontSize: 14, fontWeight: 500 }}>Loading referrals...</p>
                      <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>Fetching from Rewardful API - this may take a moment for large accounts</p>
                    </div>
                  </div>
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="ref-skeleton-row" style={{ animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
              ) : refLoading ? (
                <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="ref-skeleton-spinner" />
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>Updating...</span>
                </div>
              ) : refRows.length === 0 ? (
                <p className="empty-msg">No {refMode} found</p>
              ) : (
                <>
                  <table className="ref-table">
                    <thead>
                      <tr><th>State</th><th>First Click</th><th>Became Lead</th><th>Converted</th></tr>
                    </thead>
                    <tbody>
                      {refRows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.state || '-'}</td>
                          <td>{r.firstClickAt ? new Date(r.firstClickAt).toLocaleDateString() : '-'}</td>
                          <td>{r.becameLeadAt ? new Date(r.becameLeadAt).toLocaleDateString() : '-'}</td>
                          <td>{r.convertedAt ? new Date(r.convertedAt).toLocaleDateString() : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="ref-pagination">
                    <button disabled={refPage <= 1} onClick={() => setRefPage(p => p - 1)}>Prev</button>
                    <span>Page {refPage} ({refTotal} total)</span>
                    <button disabled={refPage * 25 >= refTotal} onClick={() => setRefPage(p => p + 1)}>Next</button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <style jsx>{`
        .page-bg {
          min-height: 100vh;
          background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #8b5cf6 100%);
          padding: 20px 10px;
        }
        .page-container {
          max-width: 900px; margin: 0 auto;
          background: rgba(255,255,255,0.95); backdrop-filter: blur(10px);
          border-radius: 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          padding: 30px; animation: fadeIn 0.6s ease-out;
        }
        @keyframes fadeIn { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }

        .message { padding: 14px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 14px; font-weight: 500; }
        .message.success { background: #f0fdf4; color: #16a34a; border-left: 4px solid #16a34a; }
        .message.error { background: #fef2f2; color: #dc2626; border-left: 4px solid #dc2626; }

        .welcome-card {
          background: linear-gradient(135deg, #dbeafe, #e0e7ff); padding: 24px;
          border-radius: 16px; margin-bottom: 20px; position: relative;
        }
        .welcome-card h2 { color: #1e293b; font-size: 22px; margin: 0 0 4px; }
        .welcome-card p { color: #475569; font-size: 14px; margin: 0; }
        .welcome-card .datetime { color: #64748b; font-size: 13px; margin-top: 8px; }
        .clipper-badge {
          display: inline-block; padding: 4px 12px; background: linear-gradient(135deg, #0ea5e9, #6366f1);
          color: white; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px;
          margin-bottom: 12px;
        }

        .today-card {
          background: linear-gradient(135deg, #dbeafe, #c7d2fe); padding: 24px;
          border-radius: 16px; margin-bottom: 20px; text-align: center;
        }
        .today-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .today-header h3 { color: #3730a3; margin: 0; font-size: 18px; }
        .today-date { color: #4338ca; font-size: 14px; font-weight: 600; }
        .today-status { margin-bottom: 16px; }
        .status-confirmed { background: #16a34a; color: white; padding: 6px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; }
        .status-pending { background: #6366f1; color: white; padding: 6px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; }

        .confirm-btn {
          padding: 16px 32px; background: linear-gradient(135deg, #0ea5e9, #6366f1);
          color: white; border: none; border-radius: 14px; cursor: pointer;
          font-size: 17px; font-weight: 700; font-family: inherit;
          box-shadow: 0 8px 24px rgba(99,102,241,0.3);
          transition: all 0.3s ease;
        }
        .confirm-btn:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(99,102,241,0.4); }
        .confirm-btn.confirmed { background: linear-gradient(135deg, #94a3b8, #64748b); box-shadow: none; }
        .confirm-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .stat-card { padding: 20px; border-radius: 14px; text-align: center; }
        .stat-card.blue { background: linear-gradient(135deg, #dbeafe, #bfdbfe); }
        .stat-card.green { background: linear-gradient(135deg, #dcfce7, #bbf7d0); }
        .stat-card.red { background: linear-gradient(135deg, #fee2e2, #fecaca); }
        .stat-card.yellow { background: linear-gradient(135deg, #fef3c7, #fde68a); }
        .stat-val { font-size: 28px; font-weight: 700; color: #1e293b; }
        .stat-lbl { font-size: 12px; color: #475569; margin-top: 4px; }

        .section-card { background: white; border: 2px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
        .section-card h3 { color: #1e293b; font-size: 18px; margin: 0 0 16px; }

        .records-list { max-height: 300px; overflow-y: auto; }
        .record-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; gap: 8px; }
        .record-row:last-child { border-bottom: none; }
        .record-date { color: #475569; font-size: 14px; font-weight: 500; }
        .record-status { font-size: 13px; font-weight: 600; }
        .record-status.confirmed { color: #16a34a; }
        .record-status.missed { color: #dc2626; }
        .btn-delete-record { padding: 4px 10px; background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; border-radius: 6px; cursor: pointer; font-size: 11px; font-family: inherit; }
        .empty-msg { color: #64748b; text-align: center; padding: 24px; }

        .supervisor-bar {
          display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap;
          padding: 12px 16px; background: linear-gradient(135deg, #ede9fe, #e0e7ff);
          border-radius: 12px; border: 1px solid #a78bfa;
        }
        .supervisor-bar label { font-weight: 600; color: #5b21b6; font-size: 14px; }
        .supervisor-bar input {
          flex: 1; min-width: 200px; padding: 10px 14px; border: 2px solid #c4b5fd;
          border-radius: 10px; font-size: 14px; font-family: inherit;
        }
        .supervisor-bar button {
          padding: 10px 20px; background: linear-gradient(135deg, #8b5cf6, #6d28d9);
          color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: inherit;
        }

        .loading-text { color: #64748b; text-align: center; padding: 16px; }

        .commission-section h3 { margin: 0; }
        .commission-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
        .btn-refresh-comm {
          padding: 8px 18px; background: linear-gradient(135deg, #0ea5e9, #6366f1);
          color: white; border: none; border-radius: 10px; cursor: pointer;
          font-weight: 600; font-size: 13px; font-family: inherit; transition: all 0.3s;
        }
        .btn-refresh-comm:hover:not(:disabled) { transform: translateY(-2px); }
        .btn-refresh-comm:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .commission-info-box {
          font-size: 13px; margin-bottom: 16px; padding: 14px;
          background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%);
          border-radius: 12px; color: #1e40af; border-left: 4px solid #3b82f6; line-height: 1.6;
        }
        .commission-info-box > strong { color: #1e3a8a; display: block; margin-bottom: 6px; font-size: 14px; }

        .commission-table {
          width: 100%; border-collapse: collapse; font-size: 15px;
          background: white; border-radius: 12px; overflow: hidden;
          box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        }
        .commission-table td {
          padding: 14px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: top;
        }
        .commission-table td:first-child { font-weight: 600; color: #475569; width: 45%; }
        .commission-table td:last-child { color: #1e293b; font-weight: 500; }
        .commission-table tr:last-child td { border-bottom: none; }
        .commission-table tr:hover { background: #f8fafc; }

        .referrals h3 { margin: 0; }
        .ref-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
        .ref-toggle { display: flex; gap: 4px; }
        .ref-toggle button {
          padding: 8px 16px; border: 2px solid #e2e8f0; border-radius: 8px; background: white;
          cursor: pointer; font-size: 13px; font-weight: 600; font-family: inherit; color: #475569;
        }
        .ref-toggle button.active { background: linear-gradient(135deg, #0ea5e9, #6366f1); color: white; border-color: transparent; }

        .ref-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .ref-table th { text-align: left; padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
        .ref-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
        .ref-table tr:hover { background: #f8fafc; }

        .ref-pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 16px; }
        .ref-pagination button { padding: 6px 16px; background: #6366f1; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-family: inherit; }
        .ref-pagination button:disabled { background: #cbd5e1; cursor: not-allowed; }
        .ref-pagination span { font-size: 13px; color: #64748b; }

        .ref-skeleton-spinner {
          width: 20px; height: 20px; border: 2px solid #e2e8f0; border-top-color: #6366f1;
          border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
        }
        .ref-skeleton-row {
          height: 36px; background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
          background-size: 200% 100%; border-radius: 8px; margin-bottom: 8px;
          animation: shimmer 1.5s ease-in-out infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        @media (max-width: 768px) {
          .page-container { padding: 20px; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .commission-table { font-size: 14px; }
        }
      `}</style>
    </div>
  );
}

export default function ClipperPage() {
  return (
    <ProtectedRoute>
      <ClipperContent />
    </ProtectedRoute>
  );
}
