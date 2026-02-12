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

import { useState, useEffect, useCallback, useRef } from 'react';
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
  stats: { totalConfirmed: number; totalMissed: number; streak: number; firstConfirmationDate?: string };
  needsTeacherAssignment: boolean;
}

interface Teacher { email: string; name: string; }

interface ReferralRow {
  state?: string; firstClickAt?: string; becameLeadAt?: string; convertedAt?: string;
  becameConversionAt?: string; createdAt?: string;
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
      } else if (result.success && !result.data) {
        // Some backends return flat structure - try treating result itself as data
        const flat = result as unknown as AttendancePageData;
        if (flat.records || flat.stats) {
          setData(flat);
          if (flat.needsTeacherAssignment) loadTeachers();
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
        'getReferralsWithMode', { email: user.email, mode, page, pageSize: 25 }
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

  const handleDeleteRecord = async (recordDate: string) => {
    if (!confirm('Delete this attendance record?')) return;
    try {
      const token = getStoredToken();
      // Use user-facing delete (works for both users and admins)
      await gsCall('deleteOwnAttendanceRecord', user?.email, recordDate, token);
      setMsg({ text: 'Record deleted', type: 'success' });
      loadData();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  // Debounced live search
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleAdminSearchInput = (value: string) => {
    setAdminSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!value.trim()) { setAdminUsers([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setAdminSearching(true);
      try {
        const result = await gsCall<{ success: boolean; users?: Record<string, unknown>[] }>(
          'searchAttendanceUsers', value.trim()
        );
        if (result.success) setAdminUsers(result.users || []);
      } catch { /* silent */ }
      finally { setAdminSearching(false); }
    }, 300);
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

  const [dashLoading, setDashLoading] = useState(false);

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const todayDateStr = now.toISOString().split('T')[0];
  
  // Compute todayConfirmed from records
  const todayConfirmed = data?.records?.some(r => r.date === todayDateStr && r.type === 'confirmed') || false;
  
  // Compute attendance rate
  const totalDays = (data?.stats?.totalConfirmed || 0) + (data?.stats?.totalMissed || 0);
  const attendanceRate = totalDays > 0 ? Math.round(((data?.stats?.totalConfirmed || 0) / totalDays) * 100) + '%' : '0%';

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
                  {user?.isTeacher && <option value="none">None (I am a teacher)</option>}
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
                {confirming ? 'Confirming...' : todayConfirmed ? 'Confirm Attendance Again' : 'Confirm Attendance'}
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
              <h3>Attendance History</h3>
              <div className="records-list">
                {data.records.length === 0 ? (
                  <p className="empty-msg">No attendance records yet</p>
                ) : (
                  data.records.slice(0, 50).map((r, i) => {
                    const baseDate = r.date.split('T')[0];
                    const hasTime = r.date.includes('T');
                    const timeStr = hasTime && r.confirmedAt
                      ? new Date(r.confirmedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                      : '';
                    return (
                      <div key={i} className="record-row">
                        <span className="record-date">
                          {baseDate}
                          {timeStr && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{timeStr}</span>}
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
                    <button disabled={refPage * 25 >= refTotal} onClick={() => setRefPage(p => p + 1)}>Next</button>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Admin section */}
        {user?.isAdmin && (
          <div className="admin-section">
            <div className="admin-header">
              <div className="admin-header-icon">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              </div>
              <div>
                <h3>Admin Console</h3>
                <p className="admin-subtitle">Search and manage all users in the system</p>
              </div>
            </div>

            <div className="admin-search-container">
              <div className="admin-search-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              </div>
              <input
                type="text"
                value={adminSearch}
                onChange={(e) => handleAdminSearchInput(e.target.value)}
                placeholder="Start typing to search users..."
                onKeyDown={(e) => e.key === 'Enter' && handleAdminSearch()}
                className="admin-search-input"
              />
              {adminSearching && <div className="admin-search-spinner" />}
              {adminSearch && !adminSearching && (
                <button className="admin-search-clear" onClick={() => { setAdminSearch(''); setAdminUsers([]); setAdminSelectedUser(null); }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              )}
            </div>

            {adminSearch && !adminSearching && adminUsers.length === 0 && (
              <div className="admin-empty">No users found for &quot;{adminSearch}&quot;</div>
            )}

            {!adminSearch && !adminSelectedUser && (
              <div className="admin-hint">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" opacity="0.3"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                <p>Search by name or email to view user details</p>
              </div>
            )}

            <div className="admin-results">
              {adminUsers.map((u, i) => (
                <div key={i} className={`admin-user-card ${adminSelectedUser && ((adminSelectedUser.student || adminSelectedUser) as Record<string, unknown>).email === u.email ? 'selected' : ''}`} onClick={async () => {
                  setDashLoading(true);
                  try {
                    const token = getStoredToken();
                    const dash = await gsCall<Record<string, unknown>>('adminGetStudentDashboard', (u.email as string), token);
                    setAdminSelectedUser(dash);
                  } catch {
                    setAdminSelectedUser(u);
                  } finally { setDashLoading(false); }
                }}>
                  <div className="admin-card-left">
                    <div className="admin-avatar">{((u.name as string) || (u.email as string)).charAt(0).toUpperCase()}</div>
                    <div>
                      <div className="admin-user-name">{(u.name as string) || (u.email as string)}</div>
                      <div className="admin-user-email">{u.email as string}</div>
                    </div>
                  </div>
                  <div className="admin-card-badges">
                    {!!(u.isTeacher) && <span className="admin-badge teacher">Teacher</span>}
                    {!!(u.isAdmin) && <span className="admin-badge admin">Admin</span>}
                    {!(u.isTeacher) && !(u.isAdmin) && <span className="admin-badge student">Student</span>}
                  </div>
                </div>
              ))}
            </div>

            {dashLoading && (
              <div className="admin-dash-loading">
                <div className="admin-search-spinner large" />
                <p>Loading dashboard...</p>
              </div>
            )}
            {adminSelectedUser && (() => {
              const stu = (adminSelectedUser.student || adminSelectedUser) as Record<string, unknown>;
              const att = (adminSelectedUser.attendance || {}) as Record<string, unknown>;
              const refs = (adminSelectedUser.referrals || {}) as Record<string, unknown>;
              const recs = ((att.recentRecords || []) as Record<string, unknown>[]);
              return (
                <div className="admin-user-detail">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                    <h4 style={{ margin: 0 }}>Student Dashboard: {(stu.name || stu.email) as string}</h4>
                    <button className="btn-close-detail" onClick={() => setAdminSelectedUser(null)}>Close</button>
                  </div>

                  {/* Basic info */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, marginBottom: 16 }}>
                    <div><strong>Login Email:</strong> {(stu.email as string) || '-'}</div>
                    <div><strong>Internal Email:</strong> {(stu.internalEmail as string) || '-'}</div>
                    <div><strong>Teacher:</strong> {(stu.teacherEmail as string) || 'Not assigned'}</div>
                    <div><strong>Status:</strong> {(stu.accountStatus as string) || '-'}</div>
                    {!!(stu.isTeacher) && <div><span className="admin-badge teacher">Teacher</span></div>}
                    {!!(stu.isAdmin) && <div><span className="admin-badge admin">Admin</span></div>}
                  </div>

                  {/* Attendance stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                    <div className="admin-stat-card"><strong>{(att.totalConfirmed as number) || 0}</strong><span>Confirmed</span></div>
                    <div className="admin-stat-card"><strong>{(refs.leadsCount as number) || 0}</strong><span>Leads</span></div>
                    <div className="admin-stat-card"><strong>{(refs.conversionsCount as number) || 0}</strong><span>Conversions</span></div>
                  </div>

                  {/* Recent attendance */}
                  {recs.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Recent Attendance</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {recs.map((r, ri) => (
                          <span key={ri} style={{ padding: '3px 8px', background: '#dcfce7', borderRadius: 6, fontSize: 11, color: '#166534' }}>
                            {r.date as string}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Admin actions */}
                  <div style={{ display: 'grid', gap: 8 }}>
                    <button className="admin-action-btn" onClick={async () => {
                      const newEmail = prompt('New login email:', (stu.email as string));
                      if (!newEmail) return;
                      const token = getStoredToken();
                      const r = await gsCall<{ success: boolean; error?: string }>('adminUpdateAliasEmail', (stu.email as string), newEmail, token);
                      alert(r.success ? 'Email updated!' : (r.error || 'Failed'));
                    }}>Edit Login Email</button>
                    <button className="admin-action-btn" onClick={async () => {
                      const newEmail = prompt('New internal/affiliate email:', (stu.internalEmail as string) || '');
                      if (!newEmail) return;
                      const token = getStoredToken();
                      const r = await gsCall<{ success: boolean; error?: string }>('adminUpdateInternalEmail', (stu.email as string), newEmail, token);
                      alert(r.success ? 'Internal email updated!' : (r.error || 'Failed'));
                    }}>Edit Internal Email</button>
                    <button className="admin-action-btn" onClick={async () => {
                      const newTeacher = prompt('New teacher email:', (stu.teacherEmail as string) || '');
                      if (!newTeacher) return;
                      const token = getStoredToken();
                      const r = await gsCall<{ success: boolean; error?: string }>('adminUpdateStudentTeacher', (stu.email as string), newTeacher, token);
                      alert(r.success ? 'Teacher updated!' : (r.error || 'Failed'));
                    }}>Change Teacher</button>
                    <button className="admin-action-btn danger" onClick={async () => {
                      if (!confirm(`Delete all attendance for ${stu.email}? This cannot be undone!`)) return;
                      if (!confirm('Are you absolutely sure?')) return;
                      const token = getStoredToken();
                      const r = await gsCall<{ success: boolean; error?: string }>('resetAllAttendance', (stu.email as string), token);
                      alert(r.success ? 'Attendance reset!' : (r.error || 'Failed'));
                    }}>Reset All Attendance</button>
                  </div>
                </div>
              );
            })()}
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
          margin-top: 24px; padding: 28px;
          background: linear-gradient(145deg, #0c0f1a 0%, #151b2e 50%, #1a1040 100%);
          border-radius: 24px; color: white;
          border: 1px solid rgba(139,92,246,0.15);
          box-shadow: 0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
        }

        .admin-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
        .admin-header-icon {
          width: 44px; height: 44px; border-radius: 14px;
          background: linear-gradient(135deg, #8b5cf6, #6d28d9);
          display: flex; align-items: center; justify-content: center; color: white;
          box-shadow: 0 4px 16px rgba(139,92,246,0.4);
        }
        .admin-section h3 { color: #e0d4fc; font-size: 20px; margin: 0; font-weight: 700; }
        .admin-subtitle { color: rgba(255,255,255,0.4); font-size: 13px; margin: 2px 0 0; }

        .admin-search-container {
          position: relative; margin-bottom: 16px;
        }
        .admin-search-icon {
          position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
          color: rgba(139,92,246,0.5); pointer-events: none;
        }
        .admin-search-input {
          width: 100%; padding: 16px 44px 16px 48px;
          border: 2px solid rgba(139,92,246,0.2); border-radius: 16px;
          background: rgba(255,255,255,0.04); color: white; font-size: 15px;
          font-family: inherit; transition: all 0.3s; box-sizing: border-box;
        }
        .admin-search-input:focus {
          outline: none; border-color: #8b5cf6;
          box-shadow: 0 0 30px rgba(139,92,246,0.2), 0 0 60px rgba(139,92,246,0.05);
          background: rgba(255,255,255,0.06);
        }
        .admin-search-input::placeholder { color: rgba(255,255,255,0.3); }

        .admin-search-spinner {
          position: absolute; right: 16px; top: 50%; transform: translateY(-50%);
          width: 18px; height: 18px; border: 2px solid rgba(139,92,246,0.3);
          border-top-color: #8b5cf6; border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        .admin-search-spinner.large { position: static; transform: none; width: 28px; height: 28px; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .admin-search-clear {
          position: absolute; right: 16px; top: 50%; transform: translateY(-50%);
          background: rgba(255,255,255,0.1); border: none; border-radius: 50%;
          width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: rgba(255,255,255,0.5); transition: all 0.2s;
        }
        .admin-search-clear:hover { background: rgba(255,255,255,0.2); color: white; }

        .admin-empty {
          text-align: center; padding: 20px; color: rgba(255,255,255,0.4);
          font-size: 14px; font-style: italic;
        }
        .admin-hint {
          text-align: center; padding: 40px 20px; color: rgba(255,255,255,0.25);
        }
        .admin-hint p { margin: 12px 0 0; font-size: 14px; }

        .admin-results {
          display: flex; flex-direction: column; gap: 6px;
          max-height: 320px; overflow-y: auto; margin-bottom: 16px;
          scrollbar-width: thin; scrollbar-color: rgba(139,92,246,0.3) transparent;
        }
        .admin-user-card {
          padding: 14px 16px;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(139,92,246,0.12);
          border-radius: 14px; cursor: pointer; transition: all 0.25s;
          display: flex; align-items: center; justify-content: space-between;
        }
        .admin-user-card:hover {
          background: rgba(139,92,246,0.08); border-color: rgba(139,92,246,0.3);
          transform: translateY(-1px); box-shadow: 0 4px 16px rgba(139,92,246,0.15);
        }
        .admin-user-card.selected {
          background: rgba(139,92,246,0.12); border-color: #8b5cf6;
          box-shadow: 0 0 20px rgba(139,92,246,0.2);
        }
        .admin-card-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .admin-avatar {
          width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, rgba(139,92,246,0.3), rgba(109,40,217,0.3));
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 16px; color: #c4b5fd;
        }
        .admin-user-name { color: white; font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .admin-user-email { color: rgba(255,255,255,0.45); font-size: 12px; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .admin-card-badges { display: flex; gap: 4px; flex-shrink: 0; }
        .admin-badge {
          display: inline-block; padding: 3px 10px; border-radius: 20px;
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .admin-badge.teacher { background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
        .admin-badge.admin { background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }
        .admin-badge.student { background: rgba(59,130,246,0.15); color: #93c5fd; border: 1px solid rgba(59,130,246,0.2); }

        .admin-dash-loading {
          display: flex; flex-direction: column; align-items: center; gap: 12px;
          padding: 32px; color: rgba(255,255,255,0.4);
        }

        .admin-user-detail {
          margin-top: 16px; padding: 20px; background: rgba(255,255,255,0.05);
          border: 2px solid #8b5cf6; border-radius: 16px;
        }
        .admin-user-detail h4 { color: #a78bfa; margin: 0 0 12px; }
        .admin-user-detail p { color: rgba(255,255,255,0.7); font-size: 14px; margin: 4px 0; }
        .admin-user-detail strong { color: rgba(255,255,255,0.5); }
        .btn-close-detail {
          padding: 8px 16px; background: rgba(255,255,255,0.1);
          color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; cursor: pointer; font-family: inherit;
        }
        .admin-stat-card {
          text-align: center; padding: 12px; background: rgba(255,255,255,0.05);
          border-radius: 10px; border: 1px solid rgba(139,92,246,0.2);
        }
        .admin-stat-card strong { display: block; font-size: 20px; color: #a78bfa; }
        .admin-stat-card span { font-size: 11px; color: rgba(255,255,255,0.5); }
        .admin-action-btn {
          width: 100%; padding: 10px 16px; background: rgba(139,92,246,0.2);
          color: #c4b5fd; border: 1px solid rgba(139,92,246,0.3); border-radius: 10px;
          cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit;
          transition: all 0.2s;
        }
        .admin-action-btn:hover { background: rgba(139,92,246,0.3); }
        .admin-action-btn.danger { background: rgba(239,68,68,0.2); color: #fca5a5; border-color: rgba(239,68,68,0.3); }
        .admin-action-btn.danger:hover { background: rgba(239,68,68,0.3); }

        @media (max-width: 768px) {
          .page-container { padding: 20px; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .admin-card-left { overflow: hidden; }
          .admin-card-badges { flex-wrap: wrap; }
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
