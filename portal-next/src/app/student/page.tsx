'use client';

/**
 * Student / Attendance Dashboard
 *
 * Carbon copy of legacy attendenceportal.html:
 * - Purple gradient background + white frosted container
 * - Welcome card (blue gradient), Today's attendance (amber)
 * - Teacher selection dropdown
 * - Attendance history + referrals with leads/conversions toggle
 * - Summary stats
 * - Admin section: dark theme, search users, view/edit student dashboards
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
  user: { email: string; name?: string; teacherEmail?: string; createdAt?: string };
  records: AttendanceRecord[];
  stats: { totalConfirmed: number; totalMissed: number; streak: number; attendanceRate?: string };
  todayConfirmed: boolean;
  todayDate: string;
  needsTeacherAssignment: boolean;
  referrals?: { leadsCount: number; conversionsCount: number };
}

interface Teacher { email: string; name: string; }

interface ReferralRow {
  state?: string; firstClickAt?: string; becameLeadAt?: string; convertedAt?: string;
  [key: string]: unknown;
}

function StudentContent() {
  const { user, isLoading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AttendancePageData | null>(null);
  const [msg, setMsg] = useState<{ text: string; type: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Teacher selection
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [loadingTeachers, setLoadingTeachers] = useState(false);

  // Referrals
  const [refMode, setRefMode] = useState<'leads' | 'conversions'>('leads');
  const [refRows, setRefRows] = useState<ReferralRow[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refPage, setRefPage] = useState(1);
  const [refTotal, setRefTotal] = useState(0);

  // Admin user search
  const [adminSearch, setAdminSearch] = useState('');
  const [adminUsers, setAdminUsers] = useState<Record<string, unknown>[]>([]);
  const [adminSearching, setAdminSearching] = useState(false);
  const [adminSelectedUser, setAdminSelectedUser] = useState<Record<string, unknown> | null>(null);

  const loadData = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; data?: AttendancePageData; error?: string }>(
        'getAttendanceData', user.email, token
      );
      if (result.success && result.data) {
        setData(result.data);
        if (result.data.needsTeacherAssignment) loadTeachers();
      } else {
        setMsg({ text: result.error || 'Failed to load', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadTeachers = async () => {
    setLoadingTeachers(true);
    try {
      const result = await gsCall<{ success: boolean; teachers?: Teacher[] }>('getAllValidTeachers');
      if (result.success && result.teachers) setTeachers(result.teachers);
    } catch { /* silent */ }
    finally { setLoadingTeachers(false); }
  };

  const loadReferrals = useCallback(async (mode: 'leads' | 'conversions', page: number) => {
    if (!user?.email) return;
    setRefLoading(true);
    try {
      const result = await gsCall<{ success: boolean; rows?: ReferralRow[]; totalCount?: number }>(
        'getReferralsWithMode', { email: user.email, mode, page, pageSize: 10 }
      );
      if (result.success) {
        setRefRows(result.rows || []);
        setRefTotal(result.totalCount || 0);
      }
    } catch { /* silent */ }
    finally { setRefLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!sessionLoading && user) loadData();
  }, [sessionLoading, user, loadData]);

  useEffect(() => {
    if (data && !data.needsTeacherAssignment) loadReferrals(refMode, refPage);
  }, [data, refMode, refPage, loadReferrals]);

  const handleConfirm = async () => {
    if (confirming || !user?.email) return;
    setConfirming(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; error?: string }>('confirmAttendance', user.email, today, token);
      if (result.success) {
        setMsg({ text: 'Attendance confirmed!', type: 'success' });
        loadData();
      } else {
        setMsg({ text: result.error || 'Failed', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally { setConfirming(false); }
  };

  const handleSelectTeacher = async () => {
    if (!selectedTeacher || !user?.email) return;
    try {
      await gsCall('setTeacherForAttendanceUser', user.email, selectedTeacher);
      loadData();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!confirm('Delete this attendance record?')) return;
    try {
      const token = getStoredToken();
      await gsCall('deleteAttendanceRecord', user?.email, recordId, token);
      loadData();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleAdminSearch = async () => {
    if (!adminSearch.trim()) return;
    setAdminSearching(true);
    try {
      const result = await gsCall<{ success: boolean; users?: Record<string, unknown>[] }>(
        'searchAttendanceUsers', adminSearch.trim()
      );
      if (result.success) setAdminUsers(result.users || []);
    } catch { /* silent */ }
    finally { setAdminSearching(false); }
  };

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  if (sessionLoading || loading) {
    return <LoadingOverlay message="Loading Student Dashboard..." />;
  }

  return (
    <div className="page-bg">
      <div className="page-container">
        <Navigation title="Student Dashboard" variant="light-bg" />

        {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}

        {/* Teacher selection */}
        {data?.needsTeacherAssignment && (
          <div className="teacher-selection">
            <h3>Select Your Teacher</h3>
            <p>Please select your teacher to get started</p>
            {loadingTeachers ? <p className="loading-text">Loading teachers...</p> : (
              <div className="teacher-form">
                <select value={selectedTeacher} onChange={(e) => setSelectedTeacher(e.target.value)}>
                  <option value="">Select a teacher...</option>
                  {teachers.map(t => <option key={t.email} value={t.email}>{t.name || t.email}</option>)}
                </select>
                <button onClick={handleSelectTeacher} disabled={!selectedTeacher}>Save Teacher</button>
              </div>
            )}
          </div>
        )}

        {data && !data.needsTeacherAssignment && (
          <>
            {/* Welcome card */}
            <div className="welcome-card">
              <h2>Welcome, {data.user.name || data.user.email}!</h2>
              <p>{data.user.email}</p>
              <p className="datetime">{todayStr} - {timeStr}</p>
            </div>

            {/* Today's attendance */}
            <div className="today-card">
              <div className="today-header">
                <h3>Today&apos;s Attendance</h3>
                <span className="today-date">{data.todayDate || new Date().toISOString().split('T')[0]}</span>
              </div>
              <div className="today-status">
                {data.todayConfirmed ? (
                  <span className="status-confirmed">Confirmed</span>
                ) : (
                  <span className="status-pending">Pending</span>
                )}
              </div>
              <button
                className={`confirm-btn ${data.todayConfirmed ? 'confirmed' : ''}`}
                onClick={handleConfirm}
                disabled={confirming || data.todayConfirmed}
              >
                {data.todayConfirmed ? 'Attendance Confirmed' : confirming ? 'Confirming...' : 'Confirm Attendance'}
              </button>
            </div>

            {/* Stats */}
            <div className="stats-grid">
              <div className="stat-card blue"><div className="stat-val">{data.stats.totalConfirmed}</div><div className="stat-lbl">Days Confirmed</div></div>
              <div className="stat-card green"><div className="stat-val">{data.stats.streak}</div><div className="stat-lbl">Current Streak</div></div>
              <div className="stat-card red"><div className="stat-val">{data.stats.totalMissed}</div><div className="stat-lbl">Days Missed</div></div>
              <div className="stat-card yellow"><div className="stat-val">{data.stats.attendanceRate || '0%'}</div><div className="stat-lbl">Attendance Rate</div></div>
            </div>

            {/* Attendance history */}
            <div className="section-card">
              <h3>Attendance History</h3>
              <div className="records-list">
                {data.records.length === 0 ? (
                  <p className="empty-msg">No attendance records yet</p>
                ) : (
                  data.records.slice(0, 30).map((r, i) => (
                    <div key={i} className="record-row">
                      <span className="record-date">{r.date}</span>
                      <span className={`record-status ${r.type === 'confirmed' ? 'confirmed' : 'missed'}`}>
                        {r.type === 'confirmed' ? 'Confirmed' : 'Missed'}
                      </span>
                      {r.id && r.type === 'confirmed' && (
                        <button className="btn-delete-record" onClick={() => handleDeleteRecord(r.id!)}>Delete</button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Referrals */}
            <div className="section-card referrals">
              <div className="ref-header">
                <h3>Referrals</h3>
                <div className="ref-toggle">
                  <button className={refMode === 'leads' ? 'active' : ''} onClick={() => { setRefMode('leads'); setRefPage(1); }}>Leads</button>
                  <button className={refMode === 'conversions' ? 'active' : ''} onClick={() => { setRefMode('conversions'); setRefPage(1); }}>Conversions</button>
                </div>
              </div>
              {refLoading ? (
                <p className="loading-text">Loading referrals...</p>
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
                    <button disabled={refPage * 10 >= refTotal} onClick={() => setRefPage(p => p + 1)}>Next</button>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Admin section */}
        {user?.isAdmin && (
          <div className="admin-section">
            <h3>Admin: User Database</h3>
            <div className="admin-search-row">
              <input
                type="text"
                value={adminSearch}
                onChange={(e) => setAdminSearch(e.target.value)}
                placeholder="Search by name or email..."
                onKeyDown={(e) => e.key === 'Enter' && handleAdminSearch()}
              />
              <button onClick={handleAdminSearch} disabled={adminSearching}>
                {adminSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
            <div className="admin-results">
              {adminUsers.map((u, i) => (
                <div key={i} className="admin-user-card" onClick={() => setAdminSelectedUser(u)}>
                  <div className="admin-user-name">{(u.name as string) || (u.email as string)}</div>
                  <div className="admin-user-email">{u.email as string}</div>
                  {!!(u.isTeacher) && <span className="admin-badge teacher">Teacher</span>}
                  {!!(u.isAdmin) && <span className="admin-badge admin">Admin</span>}
                </div>
              ))}
            </div>
            {adminSelectedUser && (
              <div className="admin-user-detail">
                <h4>User Details: {(adminSelectedUser.name || adminSelectedUser.email) as string}</h4>
                <p>Email: {adminSelectedUser.email as string}</p>
                <p>Status: {(adminSelectedUser.accountStatus || 'Unknown') as string}</p>
                <button className="btn-close-detail" onClick={() => setAdminSelectedUser(null)}>Close</button>
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .page-bg {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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

        .teacher-selection { text-align: center; padding: 24px; margin-bottom: 20px; background: #f8fafc; border-radius: 16px; border: 2px solid #e2e8f0; }
        .teacher-selection h3 { color: #1e293b; margin: 0 0 8px; }
        .teacher-selection p { color: #64748b; margin: 0 0 16px; }
        .teacher-form { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        .teacher-form select { padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 15px; min-width: 200px; background: white; font-family: inherit; }
        .teacher-form button { padding: 12px 24px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-family: inherit; }
        .teacher-form button:disabled { opacity: 0.5; cursor: not-allowed; }

        .welcome-card {
          background: linear-gradient(135deg, #dbeafe, #e0e7ff); padding: 24px;
          border-radius: 16px; margin-bottom: 20px;
        }
        .welcome-card h2 { color: #1e293b; font-size: 22px; margin: 0 0 4px; }
        .welcome-card p { color: #475569; font-size: 14px; margin: 0; }
        .welcome-card .datetime { color: #64748b; font-size: 13px; margin-top: 8px; }

        .today-card {
          background: linear-gradient(135deg, #fef3c7, #fde68a); padding: 24px;
          border-radius: 16px; margin-bottom: 20px; text-align: center;
        }
        .today-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .today-header h3 { color: #92400e; margin: 0; font-size: 18px; }
        .today-date { color: #78350f; font-size: 14px; font-weight: 600; }
        .today-status { margin-bottom: 16px; }
        .status-confirmed { background: #16a34a; color: white; padding: 6px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; }
        .status-pending { background: #f59e0b; color: white; padding: 6px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; }

        .confirm-btn {
          padding: 16px 32px; background: linear-gradient(135deg, #16a34a, #059669);
          color: white; border: none; border-radius: 14px; cursor: pointer;
          font-size: 17px; font-weight: 700; font-family: inherit;
          box-shadow: 0 8px 24px rgba(16,163,74,0.3);
          transition: all 0.3s ease;
        }
        .confirm-btn:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(16,163,74,0.4); }
        .confirm-btn.confirmed { background: linear-gradient(135deg, #94a3b8, #64748b); box-shadow: none; cursor: default; }
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
        .loading-text { color: #64748b; text-align: center; padding: 16px; }

        .referrals h3 { margin: 0; }
        .ref-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
        .ref-toggle { display: flex; gap: 4px; }
        .ref-toggle button {
          padding: 8px 16px; border: 2px solid #e2e8f0; border-radius: 8px; background: white;
          cursor: pointer; font-size: 13px; font-weight: 600; font-family: inherit; color: #475569;
        }
        .ref-toggle button.active { background: linear-gradient(135deg, #667eea, #764ba2); color: white; border-color: transparent; }

        .ref-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .ref-table th { text-align: left; padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
        .ref-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
        .ref-table tr:hover { background: #f8fafc; }

        .ref-pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 16px; }
        .ref-pagination button { padding: 6px 16px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-family: inherit; }
        .ref-pagination button:disabled { background: #cbd5e1; cursor: not-allowed; }
        .ref-pagination span { font-size: 13px; color: #64748b; }

        /* Admin section */
        .admin-section {
          margin-top: 24px; padding: 24px;
          background: linear-gradient(135deg, #0f172a, #1e293b);
          border-radius: 20px; color: white;
        }
        .admin-section h3 { color: #a78bfa; font-size: 20px; margin: 0 0 16px; }
        .admin-search-row { display: flex; gap: 8px; margin-bottom: 16px; }
        .admin-search-row input {
          flex: 1; padding: 14px 16px; border: 2px solid rgba(139,92,246,0.3); border-radius: 12px;
          background: rgba(255,255,255,0.05); color: white; font-size: 15px; font-family: inherit;
          transition: all 0.3s;
        }
        .admin-search-row input:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 20px rgba(139,92,246,0.3); }
        .admin-search-row input::placeholder { color: rgba(255,255,255,0.4); }
        .admin-search-row button {
          padding: 14px 24px; background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-family: inherit;
        }
        .admin-search-row button:disabled { opacity: 0.6; cursor: not-allowed; }

        .admin-results { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
        .admin-user-card {
          padding: 12px 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(139,92,246,0.2);
          border-radius: 10px; cursor: pointer; transition: all 0.2s;
        }
        .admin-user-card:hover { background: rgba(139,92,246,0.1); border-color: #8b5cf6; }
        .admin-user-name { color: white; font-weight: 600; font-size: 14px; }
        .admin-user-email { color: rgba(255,255,255,0.6); font-size: 12px; margin-top: 2px; }
        .admin-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; margin-left: 8px; text-transform: uppercase; }
        .admin-badge.teacher { background: #f59e0b; color: white; }
        .admin-badge.admin { background: #ef4444; color: white; }

        .admin-user-detail {
          margin-top: 16px; padding: 20px; background: rgba(255,255,255,0.05);
          border: 2px solid #8b5cf6; border-radius: 16px;
        }
        .admin-user-detail h4 { color: #a78bfa; margin: 0 0 12px; }
        .admin-user-detail p { color: rgba(255,255,255,0.7); font-size: 14px; margin: 4px 0; }
        .btn-close-detail {
          margin-top: 12px; padding: 8px 16px; background: rgba(255,255,255,0.1);
          color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; cursor: pointer; font-family: inherit;
        }

        @media (max-width: 768px) {
          .page-container { padding: 20px; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .admin-search-row { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}

export default function StudentPage() {
  return (
    <ProtectedRoute>
      <StudentContent />
    </ProtectedRoute>
  );
}
