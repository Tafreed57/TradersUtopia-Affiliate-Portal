'use client';

/**
 * Clipper Attendance Dashboard
 *
 * Simplified attendance-only view for clippers.
 * Same layout as the student dashboard but without:
 * - Teacher selection
 * - Referrals / leads
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

function ClipperContent() {
  const { user, isLoading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AttendancePageData | null>(null);
  const [msg, setMsg] = useState<{ text: string; type: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

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

  useEffect(() => {
    if (!sessionLoading && user) loadData();
  }, [sessionLoading, user, loadData]);

  const handleConfirm = async () => {
    if (confirming || !effectiveEmail) return;
    setConfirming(true);
    try {
      const today = new Date().toISOString().split('T')[0];
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
  const todayDateStr = now.toISOString().split('T')[0];
  const todayConfirmed = data?.records?.some(r => r.date === todayDateStr && r.type === 'confirmed') || false;
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
                    const hasTime = r.date.includes('T');
                    const recordTime = hasTime && r.confirmedAt
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

        @media (max-width: 768px) {
          .page-container { padding: 20px; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
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
