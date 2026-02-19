'use client';

/**
 * Teacher Portal
 *
 * Carbon copy of legacy teacherPortal.html:
 * - Purple gradient background + white frosted container
 * - Session check with loading/access denied overlays
 * - Stats grid: Total Students, Total Unpaid, Total Due Now
 * - Locked earnings section
 * - Add student by email
 * - Students list with percentage controls, view stats, remove
 * - Student statistics view with attendance + referrals
 * - Admin manage-user search bar
 */

import { useState, useEffect, useCallback } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Navigation } from '@/components/Navigation';
import { LoadingOverlay } from '@/components/LoadingSkeleton';
import { useSession } from '@/hooks/useSession';
import { gs, gsCall, getStoredToken } from '@/lib/client/gs-compat';

interface StudentItem {
  id: string;
  email: string;
  name?: string;
  internalEmail?: string;
  affiliateId?: string;
  percentageOverride?: number;
  addedDate?: string;
}

interface OpenRequestRow {
  id: string;
  studentId: string;
  studentEmail: string;
  studentName: string;
  fromTeacherName: string | null;
  requestedAt: string;
  message: string | null;
  status: string;
}

interface TeacherPageData {
  teacher: {
    email: string;
    name: string;
    isAdmin: boolean;
  };
  students: StudentItem[];
  earnings: {
    lockedEarnings: number;
    totalEarnedAllTime: number;
    totalPaidAllTime: number;
    lockedAt?: string;
  };
}

interface StudentCommission {
  email: string;
  name?: string;
  totalUnpaid?: number;
  totalDueNow?: number;
  totalPaid?: number;
  unpaid30Days?: number;
  dueNow30Days?: number;
  teacherPercentage?: number | null;
  emailPercentage?: number | null;
  rawDueNow?: number;
  adjustedDueNow?: number;
  percentage?: number;
  last30DaysRaw?: number;
  last30DaysAdjusted?: number;
}

function TeacherContent() {
  const { user, isLoading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; type: string } | null>(null);
  const [data, setData] = useState<TeacherPageData | null>(null);
  const [commissionData, setCommissionData] = useState<Record<string, StudentCommission>>({});
  const [targetEmail, setTargetEmail] = useState('');
  const [isManaging, setIsManaging] = useState(false);
  const [managedEmail, setManagedEmail] = useState('');

  // Add student
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);

  // Student stats
  const [viewingStats, setViewingStats] = useState<string | null>(null);
  const [statsData, setStatsData] = useState<Record<string, unknown> | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Student referrals (for View Stats panel)
  const [statsRefMode, setStatsRefMode] = useState<'leads' | 'conversions'>('leads');
  const [statsRefRows, setStatsRefRows] = useState<Record<string, unknown>[]>([]);
  const [statsRefPage, setStatsRefPage] = useState(1);
  const [statsRefTotal, setStatsRefTotal] = useState(0);
  const [statsRefLoading, setStatsRefLoading] = useState(false);

  // Per-student percentage
  const [percentageInputs, setPercentageInputs] = useState<Record<string, string>>({});

  // Tabs: Students | Requests (assignment workflow)
  const [activeTab, setActiveTab] = useState<'students' | 'requests'>('students');
  const [openRequests, setOpenRequests] = useState<OpenRequestRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [acceptRejectLoading, setAcceptRejectLoading] = useState<string | null>(null);
  const [removeConfirmStudent, setRemoveConfirmStudent] = useState<StudentItem | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [supervisorViewAsEmail, setSupervisorViewAsEmail] = useState('');

  // Earnings history (from getTeacherEarningsHistory)
  const [earningsHistory, setEarningsHistory] = useState<{
    totalUnpaidEarned: number; totalDueNowEarned: number; totalEarned: number;
  }>({ totalUnpaidEarned: 0, totalDueNowEarned: 0, totalEarned: 0 });

  const formatMoney = (amount: number | undefined | null) => {
    if (amount == null) return '$0.00 CAD';
    return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' CAD';
  };

  const loadTeacherData = useCallback(async (email: string) => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; data?: TeacherPageData; error?: string }>(
        'getTeacherDataWithContext', email, token
      );
      if (result.success && result.data) {
        setData(result.data);
        // Initialize percentage inputs
        const pctMap: Record<string, string> = {};
        (result.data.students || []).forEach(s => {
          pctMap[s.email] = s.percentageOverride != null ? String(s.percentageOverride) : '';
        });
        setPercentageInputs(pctMap);
      } else {
        setMsg({ text: result.error || 'Failed to load data', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadCommissionData = useCallback(async (email: string) => {
    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; students?: StudentCommission[] }>(
        'getStudentsCommissionData', email, token
      );
      if (result.success && result.students) {
        const map: Record<string, StudentCommission> = {};
        result.students.forEach(s => { map[s.email] = s; });
        setCommissionData(map);
      }
    } catch { /* silent */ }
  }, []);

  const loadEarningsHistory = useCallback(async (email: string) => {
    try {
      const result = await gsCall<{
        success: boolean; totalUnpaidEarned?: number; totalDueNowEarned?: number; totalEarned?: number;
      }>('getTeacherEarningsHistory', email);
      if (result.success) {
        setEarningsHistory({
          totalUnpaidEarned: result.totalUnpaidEarned || 0,
          totalDueNowEarned: result.totalDueNowEarned || 0,
          totalEarned: result.totalEarned || 0,
        });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (sessionLoading || !user) return;
    const email = user.email;
    setTargetEmail(email);
    loadTeacherData(email);
    loadCommissionData(email);
    loadEarningsHistory(email);
  }, [sessionLoading, user, loadTeacherData, loadCommissionData, loadEarningsHistory]);

  const handleAddStudent = async () => {
    if (!newStudentEmail.trim()) return;
    setAddingStudent(true);
    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; error?: string }>(
        'addStudentToTeacherWithContext', targetEmail, newStudentEmail.trim(), token
      );
      if (result.success) {
        setMsg({ text: 'Student added!', type: 'success' });
        setNewStudentEmail('');
        loadTeacherData(targetEmail);
        loadCommissionData(targetEmail);
      } else {
        setMsg({ text: result.error || 'Failed', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setAddingStudent(false);
    }
  };

  const loadOpenRequests = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setOpenRequests([]);
      return;
    }
    setRequestsLoading(true);
    try {
      const result = await gs.getTeacherOpenRequests(token);
      if (result.success && result.requests) setOpenRequests(result.requests);
      else setOpenRequests([]);
    } catch {
      setOpenRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'requests') loadOpenRequests();
  }, [activeTab, loadOpenRequests]);

  const handleAcceptRequest = async (requestId: string) => {
    const token = getStoredToken();
    if (!token) {
      setMsg({ text: 'Session expired. Please sign in again.', type: 'error' });
      return;
    }
    setAcceptRejectLoading(requestId);
    try {
      const result = await gs.acceptTeacherChangeRequest(token, requestId);
      if (result.success) {
        setMsg({ text: 'Request accepted. Student added to your list.', type: 'success' });
        loadOpenRequests();
        loadTeacherData(targetEmail);
        loadCommissionData(targetEmail);
      } else {
        setMsg({ text: result.error || 'Failed to accept', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setAcceptRejectLoading(null);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    const token = getStoredToken();
    if (!token) {
      setMsg({ text: 'Session expired. Please sign in again.', type: 'error' });
      return;
    }
    setAcceptRejectLoading(requestId);
    try {
      const result = await gs.rejectTeacherChangeRequest(token, requestId);
      if (result.success) {
        setMsg({ text: 'Request rejected.', type: 'success' });
        loadOpenRequests();
      } else {
        setMsg({ text: result.error || 'Failed to reject', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setAcceptRejectLoading(null);
    }
  };

  const handleRemoveStudent = async (student: StudentItem) => {
    setRemoveConfirmStudent(student);
  };

  const handleConfirmRemoveStudent = async () => {
    if (!removeConfirmStudent) return;
    const token = getStoredToken();
    if (!token) {
      setMsg({ text: 'Session expired. Please sign in again.', type: 'error' });
      return;
    }
    setRemoveLoading(true);
    try {
      const result = await gs.removeStudentFromTeacherByTeacherSession(token, removeConfirmStudent.id);
      if (result.success) {
        setMsg({ text: 'Student removed.', type: 'success' });
        setRemoveConfirmStudent(null);
        loadTeacherData(targetEmail);
        loadCommissionData(targetEmail);
      } else {
        setMsg({ text: result.error || 'Failed to remove', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setRemoveLoading(false);
    }
  };

  const handleSetPercentage = async (studentEmail: string) => {
    const pct = percentageInputs[studentEmail];
    try {
      // Default to 10 if empty (matches legacy behavior)
      await gsCall('setStudentPercentageOverride', targetEmail, studentEmail, pct ? Number(pct) : 10);
      setMsg({ text: `Percentage updated for ${studentEmail}`, type: 'success' });
      loadTeacherData(targetEmail);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleUpdateEarnings = async () => {
    try {
      const token = getStoredToken();
      await gsCall('updateTeacherEarnings', targetEmail, token);
      setMsg({ text: 'Earnings updated!', type: 'success' });
      loadTeacherData(targetEmail);
      loadEarningsHistory(targetEmail);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const loadStudentReferrals = async (studentEmail: string, mode: 'leads' | 'conversions', page: number) => {
    setStatsRefLoading(true);
    try {
      const result = await gsCall<{
        success: boolean; rows?: Record<string, unknown>[]; totalCount?: number;
      }>('getStudentReferralsForTeacher', targetEmail, studentEmail, mode, page, 25);
      if (result.success) {
        setStatsRefRows(result.rows || []);
        setStatsRefTotal(result.totalCount || 0);
      }
    } catch { /* silent */ }
    finally { setStatsRefLoading(false); }
  };

  const handleViewStats = async (studentEmail: string) => {
    if (viewingStats === studentEmail) { setViewingStats(null); return; }
    setViewingStats(studentEmail);
    setStatsLoading(true);
    setStatsData(null);
    setStatsRefMode('leads');
    setStatsRefPage(1);
    setStatsRefRows([]);
    setStatsRefTotal(0);
    try {
      const token = getStoredToken();
      const result = await gsCall<Record<string, unknown>>(
        'getStudentAttendanceStats', targetEmail, studentEmail, token
      );
      setStatsData(result);
      // Also load referrals
      loadStudentReferrals(studentEmail, 'leads', 1);
    } catch {
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleAdminSearch = async () => {
    if (!managedEmail.trim() || !managedEmail.includes('@')) return;
    const target = managedEmail.trim().toLowerCase();
    // Audit log: admin started managing (matches GAS adminStartManageUser)
    try { await gsCall('adminStartManageUser', user?.email || '', target); } catch { /* ok */ }
    setIsManaging(true);
    setTargetEmail(target);
    loadTeacherData(target);
    loadCommissionData(target);
    loadEarningsHistory(target);
  };

  const handleExitManage = async () => {
    // Audit log: admin stopped managing (matches GAS adminStopManageUser)
    try { await gsCall('adminStopManageUser', user?.email || '', targetEmail); } catch { /* ok */ }
    setIsManaging(false);
    setManagedEmail('');
    const email = user?.email || '';
    setTargetEmail(email);
    loadTeacherData(email);
    loadCommissionData(email);
    loadEarningsHistory(email);
  };

  if (sessionLoading || loading) {
    return <LoadingOverlay message="Loading Teacher Portal..." />;
  }

  return (
    <div className="page-bg">
      <div className="page-container">
        <Navigation title="Teacher Portal" variant="light-bg" />

        {/* Supervisor: view as teacher by email */}
        {user?.isSupervisor && !user?.isAdmin && (
          <div className="supervisor-bar">
            <label>View as teacher:</label>
            <input
              type="email"
              value={supervisorViewAsEmail}
              onChange={(e) => setSupervisorViewAsEmail(e.target.value)}
              placeholder="Enter teacher email..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && supervisorViewAsEmail.trim()) {
                  const email = supervisorViewAsEmail.trim();
                  setTargetEmail(email);
                  loadTeacherData(email);
                  loadCommissionData(email);
                  loadEarningsHistory(email);
                  loadOpenRequests();
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                const email = supervisorViewAsEmail.trim();
                if (!email) return;
                setTargetEmail(email);
                loadTeacherData(email);
                loadCommissionData(email);
                loadEarningsHistory(email);
                loadOpenRequests();
              }}
            >
              View
            </button>
          </div>
        )}

        {/* Admin manage-user banner */}
        {isManaging && (
          <div className="manage-banner">
            <span>Managing: <strong>{targetEmail}</strong></span>
            <button onClick={handleExitManage}>Exit Manage Mode</button>
          </div>
        )}

        {/* Admin search */}
        {user?.isAdmin && !isManaging && (
          <div className="admin-search">
            <input
              type="email"
              value={managedEmail}
              onChange={(e) => setManagedEmail(e.target.value)}
              placeholder="Enter teacher email to manage..."
              onKeyDown={(e) => e.key === 'Enter' && handleAdminSearch()}
            />
            <button onClick={handleAdminSearch}>Manage User</button>
          </div>
        )}

        {/* Message */}
        {msg && (
          <div className={`message ${msg.type}`}>{msg.text}</div>
        )}

        {data && (
          <>
            {/* Stats grid */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{data.students?.length || 0}</div>
                <div className="stat-label">Total Students</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatMoney(Object.values(commissionData).reduce((s, c) => s + (c.totalUnpaid || 0), 0))}</div>
                <div className="stat-label">Total Unpaid</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatMoney(Object.values(commissionData).reduce((s, c) => s + (c.totalDueNow || 0), 0))}</div>
                <div className="stat-label">Total Due Now</div>
              </div>
            </div>

            {/* Locked earnings - matches GAS: Locked Unpaid Earned, Locked Due Now Earned, Total Locked */}
            <div className="locked-section">
              <h3>Your Locked Earnings</h3>
              <div className="locked-grid">
                <div className="locked-card">
                  <div className="locked-value">{formatMoney(earningsHistory.totalUnpaidEarned)}</div>
                  <div className="locked-label">Locked Unpaid Earned</div>
                </div>
                <div className="locked-card">
                  <div className="locked-value">{formatMoney(earningsHistory.totalDueNowEarned)}</div>
                  <div className="locked-label">Locked Due Now Earned</div>
                </div>
                <div className="locked-card highlight">
                  <div className="locked-value">{formatMoney(earningsHistory.totalEarned)}</div>
                  <div className="locked-label">Total Locked Earnings</div>
                </div>
              </div>
              <button className="btn-update-earnings" onClick={handleUpdateEarnings}>Update My Earnings</button>
            </div>

            {/* Tabs: Students | Requests */}
            <div className="teacher-tabs">
              <button
                type="button"
                className={activeTab === 'students' ? 'active' : ''}
                onClick={() => setActiveTab('students')}
              >
                Students ({data.students?.length || 0})
              </button>
              <button
                type="button"
                className={activeTab === 'requests' ? 'active' : ''}
                onClick={() => setActiveTab('requests')}
              >
                Requests ({openRequests.length})
              </button>
            </div>

            {activeTab === 'requests' && (
              <div className="requests-section">
                <h3>Pending requests</h3>
                <p className="section-hint">Students who requested to join you. Accept or reject.</p>
                {requestsLoading ? (
                  <p className="loading-text">Loading requests...</p>
                ) : openRequests.length === 0 ? (
                  <p className="empty-msg">No pending requests.</p>
                ) : (
                  <div className="request-cards">
                    {openRequests.map((req) => (
                      <div key={req.id} className="request-card">
                        <div className="request-card-body">
                          <p className="request-student">{req.studentName || req.studentEmail}</p>
                          <p className="request-email">{req.studentEmail}</p>
                          {req.fromTeacherName && (
                            <p className="request-from">From teacher: {req.fromTeacherName}</p>
                          )}
                          <p className="request-date">Requested {new Date(req.requestedAt).toLocaleString()}</p>
                          {req.message && <p className="request-message">&quot;{req.message}&quot;</p>}
                        </div>
                        <div className="request-card-actions">
                          <button
                            type="button"
                            className="btn-accept"
                            onClick={() => handleAcceptRequest(req.id)}
                            disabled={acceptRejectLoading !== null}
                          >
                            {acceptRejectLoading === req.id ? 'Accepting...' : 'Accept'}
                          </button>
                          <button
                            type="button"
                            className="btn-reject"
                            onClick={() => handleRejectRequest(req.id)}
                            disabled={acceptRejectLoading !== null}
                          >
                            {acceptRejectLoading === req.id ? 'Rejecting...' : 'Reject'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'students' && (
              <>
            {/* Add student */}
            <div className="add-section">
              <h3>Add Student</h3>
              <div className="add-row">
                <input
                  type="email"
                  value={newStudentEmail}
                  onChange={(e) => setNewStudentEmail(e.target.value)}
                  placeholder="Enter student email..."
                  onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
                />
                <button onClick={handleAddStudent} disabled={addingStudent}>
                  {addingStudent ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>

            {/* Students list */}
            <div className="students-section">
              <h3>Students ({data.students?.length || 0})</h3>
              {(!data.students || data.students.length === 0) ? (
                <p className="empty-msg">No students added yet. Use the form above to add students.</p>
              ) : (
                data.students.map((student) => {
                  const cd = commissionData[student.email] || {} as StudentCommission;
                  return (
                    <div key={student.id} className="student-card">
                      <div className="student-header">
                        <div className="student-info">
                          <span className="student-email">{student.name || student.email}</span>
                          {student.percentageOverride != null && (
                            <span className="pct-badge">{student.percentageOverride}%</span>
                          )}
                        </div>
                        <div className="student-amounts">
                          <span className="amount-label">30d Unpaid: <strong>{formatMoney(cd.unpaid30Days)}</strong></span>
                          <span className="amount-label">30d Due: <strong>{formatMoney(cd.dueNow30Days)}</strong></span>
                        </div>
                      </div>
                      <div className="student-controls">
                        <div className="pct-control">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={percentageInputs[student.email] || ''}
                            onChange={(e) => setPercentageInputs(prev => ({ ...prev, [student.email]: e.target.value }))}
                            placeholder="%"
                          />
                          <button className="btn-save-pct" onClick={() => handleSetPercentage(student.email)}>Save %</button>
                        </div>
                        <div className="student-actions">
                          <button className="btn-stats" onClick={() => handleViewStats(student.email)}>
                            {viewingStats === student.email ? 'Hide Stats' : 'View Stats'}
                          </button>
                          <button className="btn-remove" onClick={() => handleRemoveStudent(student)}>Remove</button>
                        </div>
                      </div>

                      {/* Student stats expansion */}
                      {viewingStats === student.email && (
                        <div className="stats-expansion">
                          {statsLoading ? (
                            <p className="loading-text">Loading stats...</p>
                          ) : statsData ? (() => {
                            const stats = (statsData as Record<string, unknown>).stats as Record<string, unknown> || {};
                            const studentInfo = (statsData as Record<string, unknown>).student as Record<string, unknown> || {};
                            const recentRecs = ((statsData as Record<string, unknown>).recentRecords || []) as Record<string, unknown>[];
                            const clipperStats = (statsData as Record<string, unknown>).clipperStats as Record<string, unknown> || {};
                            const clipperRecentRecs = ((statsData as Record<string, unknown>).clipperRecentRecords || []) as Record<string, unknown>[];
                            return (
                              <div className="stats-detail">
                                {/* Student info */}
                                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                                  {(studentInfo.name as string) || student.email}
                                  {!!studentInfo.teacherEmail && <span> &middot; Teacher: {String(studentInfo.teacherEmail)}</span>}
                                </p>

                                {/* Live Attendance stats */}
                                <p style={{ fontSize: 12, fontWeight: 700, color: '#e94560', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Live Attendance</p>
                                <div className="mini-stats-grid">
                                  <div className="mini-stat"><strong>{(stats.totalDays as number) || 0}</strong><span>Total Days</span></div>
                                  <div className="mini-stat"><strong>{(stats.confirmedDays as number) || 0}</strong><span>Confirmed</span></div>
                                  <div className="mini-stat"><strong>{(stats.missedDays as number) || 0}</strong><span>Missed</span></div>
                                  <div className="mini-stat"><strong>{(stats.attendanceRate as string) || '0%'}</strong><span>Rate</span></div>
                                  <div className="mini-stat"><strong>{(stats.streak as number) || 0}</strong><span>Streak</span></div>
                                </div>

                                {/* Recent live attendance records */}
                                {recentRecs.length > 0 && (
                                  <div style={{ marginTop: 12 }}>
                                    <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Recent Live Attendance</p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                      {recentRecs.map((r, ri) => (
                                        <span key={ri} style={{ padding: '3px 8px', background: '#dcfce7', borderRadius: 6, fontSize: 11, color: '#166534' }}>
                                          {r.date as string}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Clipper Attendance stats */}
                                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
                                  <p style={{ fontSize: 12, fontWeight: 700, color: '#6366f1', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Clipper Attendance</p>
                                  {(clipperStats.confirmedDays as number) > 0 ? (
                                    <>
                                      <div className="mini-stats-grid">
                                        <div className="mini-stat"><strong>{(clipperStats.totalDays as number) || 0}</strong><span>Total Days</span></div>
                                        <div className="mini-stat"><strong>{(clipperStats.confirmedDays as number) || 0}</strong><span>Confirmed</span></div>
                                        <div className="mini-stat"><strong>{(clipperStats.missedDays as number) || 0}</strong><span>Missed</span></div>
                                        <div className="mini-stat"><strong>{(clipperStats.attendanceRate as string) || '0%'}</strong><span>Rate</span></div>
                                        <div className="mini-stat"><strong>{(clipperStats.streak as number) || 0}</strong><span>Streak</span></div>
                                      </div>
                                      {clipperRecentRecs.length > 0 && (
                                        <div style={{ marginTop: 12 }}>
                                          <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Recent Clipper Attendance</p>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                            {clipperRecentRecs.map((r, ri) => (
                                              <span key={ri} style={{ padding: '3px 8px', background: '#e0e7ff', borderRadius: 6, fontSize: 11, color: '#3730a3' }}>
                                                {r.date as string}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No clipper attendance records</p>
                                  )}
                                </div>

                                {/* Referrals table with Leads/Conversions toggle */}
                                <div style={{ marginTop: 16 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <p style={{ fontSize: 13, fontWeight: 600, color: '#475569', margin: 0 }}>Referrals</p>
                                    <div className="ref-toggle-mini">
                                      <button className={statsRefMode === 'leads' ? 'active' : ''} onClick={() => { setStatsRefMode('leads'); setStatsRefPage(1); loadStudentReferrals(student.email, 'leads', 1); }}>Leads</button>
                                      <button className={statsRefMode === 'conversions' ? 'active' : ''} onClick={() => { setStatsRefMode('conversions'); setStatsRefPage(1); loadStudentReferrals(student.email, 'conversions', 1); }}>Conversions</button>
                                    </div>
                                  </div>

                                  {statsRefLoading ? (
                                    <p className="loading-text">Loading referrals...</p>
                                  ) : statsRefRows.length === 0 ? (
                                    <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 12 }}>No {statsRefMode} found</p>
                                  ) : (
                                    <>
                                      <table className="ref-table-mini">
                                        <thead>
                                          <tr><th>State</th><th>First Click</th><th>Became Lead</th><th>Converted</th></tr>
                                        </thead>
                                        <tbody>
                                          {statsRefRows.map((r, ri) => (
                                            <tr key={ri}>
                                              <td>{(r.state as string) || '-'}</td>
                                              <td>{r.firstClickAt ? new Date(r.firstClickAt as string).toLocaleDateString() : '-'}</td>
                                              <td>{r.becameLeadAt ? new Date(r.becameLeadAt as string).toLocaleDateString() : '-'}</td>
                                              <td>{(r.convertedAt || r.becameConversionAt) ? new Date((r.convertedAt || r.becameConversionAt) as string).toLocaleDateString() : '-'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 12 }}>
                                        <button disabled={statsRefPage <= 1} onClick={() => { const p = statsRefPage - 1; setStatsRefPage(p); loadStudentReferrals(student.email, statsRefMode, p); }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 12 }}>Prev</button>
                                        <span>Page {statsRefPage} ({statsRefTotal} total)</span>
                                        <button disabled={statsRefPage * 25 >= statsRefTotal} onClick={() => { const p = statsRefPage + 1; setStatsRefPage(p); loadStudentReferrals(student.email, statsRefMode, p); }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 12 }}>Next</button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })() : (
                            <p className="loading-text">No stats available</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
              </>
            )}

            {/* Refresh button */}
            <div className="footer-actions">
              <button className="btn-refresh" onClick={async () => {
                try { await gsCall('clearAllCaches'); } catch { /* ok */ }
                loadTeacherData(targetEmail);
                loadCommissionData(targetEmail);
                loadEarningsHistory(targetEmail);
                if (activeTab === 'requests') loadOpenRequests();
              }}>
                Refresh Data
              </button>
            </div>
          </>
        )}

        {/* Remove student confirmation modal */}
        {removeConfirmStudent && (
          <div className="modal-overlay" onClick={() => !removeLoading && setRemoveConfirmStudent(null)}>
            <div className="modal-content remove-modal" onClick={e => e.stopPropagation()}>
              <h3>Remove student</h3>
              <p>Remove <strong>{removeConfirmStudent.name || removeConfirmStudent.email}</strong> from your list? They will have no teacher until they request another.</p>
              <div className="modal-actions">
                <button type="button" className="btn-modal-secondary" onClick={() => setRemoveConfirmStudent(null)} disabled={removeLoading}>Cancel</button>
                <button type="button" className="btn-modal-danger" onClick={handleConfirmRemoveStudent} disabled={removeLoading}>
                  {removeLoading ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
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
        .manage-banner {
          background: linear-gradient(135deg, #fef3c7, #fde68a); padding: 12px 20px;
          border-radius: 12px; border: 2px solid #f59e0b; margin-bottom: 20px;
          display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
          color: #92400e; font-size: 14px; font-weight: 500;
        }
        .manage-banner button {
          padding: 6px 16px; background: #dc2626; color: white; border: none;
          border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; font-family: inherit;
        }

        .admin-search {
          display: flex; gap: 8px; margin-bottom: 20px;
        }
        .admin-search input {
          flex: 1; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 12px;
          font-size: 15px; font-family: inherit;
        }
        .admin-search input:focus { outline: none; border-color: #667eea; box-shadow: 0 0 0 4px rgba(102,126,234,0.1); }
        .admin-search button {
          padding: 12px 24px; background: linear-gradient(135deg, #667eea, #764ba2);
          color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 14px; font-family: inherit;
        }

        .message { padding: 14px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 14px; font-weight: 500; }
        .message.success { background: #f0fdf4; color: #16a34a; border-left: 4px solid #16a34a; }
        .message.error { background: #fef2f2; color: #dc2626; border-left: 4px solid #dc2626; }

        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
        .stat-card {
          padding: 20px; background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
          border-radius: 16px; text-align: center; border: 1px solid #cbd5e1;
        }
        .stat-value { font-size: 24px; font-weight: 700; color: #475569; }
        .stat-label { font-size: 13px; color: #64748b; margin-top: 4px; }

        .locked-section {
          margin-bottom: 24px; padding: 20px;
          background: linear-gradient(135deg, #ecfdf5, #d1fae5);
          border-radius: 16px; border: 1px solid #a7f3d0;
        }
        .locked-section h3 { color: #047857; font-size: 16px; margin: 0 0 16px; }
        .locked-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
        .locked-card {
          padding: 16px; background: white; border-radius: 12px; text-align: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        .locked-card.highlight { background: linear-gradient(135deg, #dbeafe, #bfdbfe); }
        .locked-value { font-size: 20px; font-weight: 700; color: #16a34a; }
        .locked-card.highlight .locked-value { color: #2563eb; }
        .locked-label { font-size: 11px; color: #047857; margin-top: 4px; }

        .btn-update-earnings {
          width: 100%; padding: 14px; background: linear-gradient(135deg, #10b981, #059669);
          color: white; border: none; border-radius: 12px; cursor: pointer;
          font-size: 15px; font-weight: 600; font-family: inherit;
          box-shadow: 0 4px 12px rgba(16,185,129,0.3);
        }
        .btn-update-earnings:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(16,185,129,0.4); }

        .add-section {
          margin-bottom: 24px; padding: 20px;
          background: linear-gradient(135deg, #dbeafe, #e0e7ff);
          border-radius: 16px;
        }
        .add-section h3 { color: #1e40af; font-size: 16px; margin: 0 0 12px; }
        .add-row { display: flex; gap: 8px; }
        .add-row input {
          flex: 1; padding: 14px 16px; border: 2px solid #93c5fd; border-radius: 12px;
          font-size: 15px; background: white; font-family: inherit;
        }
        .add-row input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.15); }
        .add-row button {
          padding: 14px 28px; background: linear-gradient(135deg, #3b82f6, #2563eb);
          color: white; border: none; border-radius: 12px; cursor: pointer;
          font-weight: 600; font-size: 15px; font-family: inherit;
        }
        .add-row button:disabled { opacity: 0.6; cursor: not-allowed; }

        .teacher-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
        .teacher-tabs button {
          padding: 10px 20px; border: 2px solid #e2e8f0; border-radius: 10px;
          background: white; cursor: pointer; font-size: 14px; font-weight: 600; font-family: inherit; color: #475569;
        }
        .teacher-tabs button.active { background: linear-gradient(135deg, #667eea, #764ba2); color: white; border-color: transparent; }

        .requests-section { margin-bottom: 24px; }
        .requests-section h3 { color: #1e293b; font-size: 18px; margin: 0 0 4px; }
        .section-hint { font-size: 13px; color: #64748b; margin: 0 0 16px; }
        .request-cards { display: flex; flex-direction: column; gap: 12px; }
        .request-card {
          display: flex; align-items: stretch; justify-content: space-between; gap: 16px; flex-wrap: wrap;
          background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 14px; padding: 16px;
        }
        .request-card-body { flex: 1; min-width: 0; }
        .request-student { font-weight: 600; color: #1e293b; margin: 0 0 2px; }
        .request-email { font-size: 13px; color: #64748b; margin: 0 0 4px; }
        .request-from { font-size: 12px; color: #475569; margin: 0 0 2px; }
        .request-date { font-size: 12px; color: #94a3b8; margin: 0 0 4px; }
        .request-message { font-size: 13px; font-style: italic; color: #475569; margin: 0; }
        .request-card-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
        .btn-accept {
          padding: 8px 16px; background: linear-gradient(135deg, #16a34a, #059669); color: white;
          border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; font-family: inherit;
        }
        .btn-accept:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-reject {
          padding: 8px 16px; background: #f1f5f9; color: #64748b; border: 2px solid #e2e8f0;
          border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; font-family: inherit;
        }
        .btn-reject:disabled { opacity: 0.6; cursor: not-allowed; }

        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex;
          align-items: center; justify-content: center; z-index: 100; padding: 20px;
        }
        .modal-content { background: white; border-radius: 16px; padding: 24px; max-width: 420px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
        .remove-modal h3 { margin: 0 0 12px; color: #1e293b; }
        .remove-modal p { font-size: 14px; color: #475569; margin: 0 0 16px; }
        .modal-actions { display: flex; gap: 12px; justify-content: flex-end; }
        .btn-modal-secondary { padding: 10px 18px; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 500; }
        .btn-modal-danger { padding: 10px 18px; background: #dc2626; color: white; border: none; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 600; }
        .btn-modal-secondary:disabled, .btn-modal-danger:disabled { opacity: 0.6; cursor: not-allowed; }

        .students-section { margin-bottom: 24px; }
        .students-section h3 { color: #1e293b; font-size: 18px; margin: 0 0 16px; }
        .empty-msg { color: #64748b; text-align: center; padding: 24px; font-size: 14px; }

        .student-card {
          background: white; border: 2px solid #e2e8f0; border-radius: 16px;
          padding: 16px; margin-bottom: 12px; transition: border-color 0.2s;
        }
        .student-card:hover { border-color: #667eea; }

        .student-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .student-info { display: flex; align-items: center; gap: 8px; }
        .student-email { font-weight: 600; color: #1e293b; font-size: 14px; }
        .pct-badge {
          background: linear-gradient(135deg, #f59e0b, #d97706); color: white;
          padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;
        }
        .student-amounts { display: flex; gap: 16px; font-size: 13px; color: #475569; }
        .amount-label strong { color: #1e293b; }

        .student-controls { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        .pct-control { display: flex; gap: 6px; align-items: center; }
        .pct-control input {
          width: 70px; padding: 8px; border: 2px solid #e2e8f0; border-radius: 8px;
          font-size: 14px; text-align: center; font-family: inherit;
        }
        .btn-save-pct {
          padding: 8px 12px; background: #667eea; color: white; border: none;
          border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit;
        }
        .student-actions { display: flex; gap: 6px; }
        .btn-stats {
          padding: 8px 14px; background: linear-gradient(135deg, #3b82f6, #2563eb);
          color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit;
        }
        .btn-remove {
          padding: 8px 14px; background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit;
        }

        .stats-expansion {
          margin-top: 12px; padding: 16px; background: #f8fafc; border-radius: 12px;
          border: 1px solid #e2e8f0;
        }
        .loading-text { color: #64748b; font-size: 13px; text-align: center; margin: 0; }
        .mini-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .mini-stat {
          text-align: center; padding: 12px; background: white; border-radius: 10px;
          border: 1px solid #e2e8f0;
        }
        .mini-stat strong { display: block; font-size: 20px; color: #1e293b; }
        .mini-stat span { font-size: 11px; color: #64748b; }

        .ref-toggle-mini { display: flex; gap: 4px; }
        .ref-toggle-mini button {
          padding: 4px 12px; border: 1px solid #e2e8f0; border-radius: 6px;
          background: white; cursor: pointer; font-size: 11px; font-family: inherit;
        }
        .ref-toggle-mini button.active {
          background: #667eea; color: white; border-color: #667eea;
        }

        .ref-table-mini {
          width: 100%; border-collapse: collapse; font-size: 12px;
          background: white; border-radius: 8px; overflow: hidden;
        }
        .ref-table-mini th {
          padding: 8px 6px; background: #f1f5f9; color: #475569;
          font-weight: 600; text-align: left; border-bottom: 1px solid #e2e8f0;
        }
        .ref-table-mini td {
          padding: 8px 6px; border-bottom: 1px solid #f1f5f9; color: #64748b;
        }

        .footer-actions { text-align: center; }
        .btn-refresh {
          padding: 14px 32px; background: linear-gradient(135deg, #667eea, #764ba2);
          color: white; border: none; border-radius: 12px; cursor: pointer;
          font-size: 15px; font-weight: 600; font-family: inherit;
          box-shadow: 0 4px 12px rgba(102,126,234,0.3);
        }
        .btn-refresh:hover { transform: translateY(-2px); }

        @media (max-width: 768px) {
          .page-container { padding: 20px; }
          .stats-grid { grid-template-columns: 1fr; }
          .locked-grid { grid-template-columns: 1fr; }
          .student-header { flex-direction: column; align-items: flex-start; }
          .student-controls { flex-direction: column; align-items: flex-start; }
          .mini-stats-grid { grid-template-columns: repeat(2, 1fr); }
          .add-row { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}

export default function TeacherPage() {
  return (
    <ProtectedRoute requireTeacher>
      <TeacherContent />
    </ProtectedRoute>
  );
}
