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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Navigation } from '@/components/Navigation';
import { LoadingOverlay } from '@/components/LoadingSkeleton';
import { useSession } from '@/hooks/useSession';
import { gs, gsCall, getStoredToken } from '@/lib/client/gs-compat';
import { formatDateString } from '@/lib/utils';

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
interface StudentTeacherState {
  teacher: { id: string; email: string; name: string } | null;
  openRequest: { id: string; toTeacherName: string; requestedAt: string } | null;
}

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
  const [refLeadsCount, setRefLeadsCount] = useState(0);
  const [refConversionsCount, setRefConversionsCount] = useState(0);
  const [refInitialLoad, setRefInitialLoad] = useState(true);

  // My Teacher + Change Teacher (request workflow)
  const [teacherState, setTeacherState] = useState<StudentTeacherState | null>(null);
  const [loadingTeacherState, setLoadingTeacherState] = useState(false);
  const [changeTeacherOpen, setChangeTeacherOpen] = useState(false);
  const [eligibleTeachers, setEligibleTeachers] = useState<{ id: string; email: string; name: string }[]>([]);
  const [selectedToTeacherId, setSelectedToTeacherId] = useState('');
  const [changeRequestMessage, setChangeRequestMessage] = useState('');
  const [changeRequestSubmitting, setChangeRequestSubmitting] = useState(false);
  const [cancelRequestSubmitting, setCancelRequestSubmitting] = useState(false);

  // Supervisor view-as (by email)
  const [supervisorViewAsEmail, setSupervisorViewAsEmail] = useState('');

  // Admin/Supervisor user search (preloaded + local filter)
  const [adminSearch, setAdminSearch] = useState('');
  const [allUsers, setAllUsers] = useState<Record<string, unknown>[]>([]);
  const [allUsersLoaded, setAllUsersLoaded] = useState(false);
  const [adminSearching, setAdminSearching] = useState(false);
  const [adminSelectedUser, setAdminSelectedUser] = useState<Record<string, unknown> | null>(null);

  const [committedViewAsEmail, setCommittedViewAsEmail] = useState('');
  const canViewAs = user?.isSupervisor || user?.isAdmin;
  const effectiveEmail = (canViewAs && committedViewAsEmail) ? committedViewAsEmail : user?.email ?? '';

  const loadData = useCallback(async (overrideEmail?: string) => {
    const email = overrideEmail ?? effectiveEmail;
    if (!email) return;
    setLoading(true);
    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; data?: AttendancePageData; error?: string }>(
        'getAttendanceData', email, token
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
        } else if (committedViewAsEmail || overrideEmail) {
          setData({ user: { email }, records: [], stats: { totalConfirmed: 0, totalMissed: 0, streak: 0 }, needsTeacherAssignment: true } as AttendancePageData);
        } else {
          setMsg({ text: 'No attendance data found', type: 'error' });
        }
      } else {
        if (committedViewAsEmail || overrideEmail) {
          setData({ user: { email }, records: [], stats: { totalConfirmed: 0, totalMissed: 0, streak: 0 }, needsTeacherAssignment: true } as AttendancePageData);
        }
        setMsg({ text: result.error || 'Failed to load', type: 'error' });
      }
    } catch (err) {
      if (committedViewAsEmail || overrideEmail) {
        setData({ user: { email }, records: [], stats: { totalConfirmed: 0, totalMissed: 0, streak: 0 }, needsTeacherAssignment: true } as AttendancePageData);
      }
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [user, effectiveEmail]);

  const loadTeachers = async () => {
    setLoadingTeachers(true);
    try {
      const result = await gsCall<{ success: boolean; teachers?: Teacher[] }>('getAllValidTeachers');
      if (result.success && result.teachers) setTeachers(result.teachers);
    } catch { /* silent */ }
    finally { setLoadingTeachers(false); }
  };

  const loadTeacherState = useCallback(async (viewAsOverride?: string) => {
    const token = getStoredToken();
    if (!token) return;
    setLoadingTeacherState(true);
    try {
      const viewAs = viewAsOverride ?? ((canViewAs && committedViewAsEmail) ? committedViewAsEmail : undefined);
      const result = await gs.getStudentCurrentTeacher(token, viewAs);
      if (result.success && result.data) setTeacherState(result.data);
      else setTeacherState({ teacher: null, openRequest: null });
    } catch {
      setTeacherState({ teacher: null, openRequest: null });
    } finally {
      setLoadingTeacherState(false);
    }
  }, [user, committedViewAsEmail]);

  const openChangeTeacherModal = useCallback(async () => {
    setChangeTeacherOpen(true);
    setSelectedToTeacherId('');
    setChangeRequestMessage('');
    const token = getStoredToken();
    if (!token) return;
    try {
      const result = await gs.getEligibleTeachersForAssignment(token);
      if (result.success && result.teachers) setEligibleTeachers(result.teachers);
      else setEligibleTeachers([]);
    } catch {
      setEligibleTeachers([]);
    }
  }, []);

  const handleSubmitChangeRequest = async () => {
    if (!selectedToTeacherId) return;
    const token = getStoredToken();
    if (!token) {
      setMsg({ text: 'Session expired. Please sign in again.', type: 'error' });
      return;
    }
    setChangeRequestSubmitting(true);
    try {
      const result = await gs.createTeacherChangeRequest(token, selectedToTeacherId, changeRequestMessage || undefined) as { success: boolean; autoAccepted?: boolean; error?: string };
      if (result.success) {
        if (result.autoAccepted) {
          setMsg({ text: 'Teacher assigned! You can now confirm attendance.', type: 'success' });
          loadData();
        } else {
          setMsg({ text: 'Request sent. The teacher must approve before the change takes effect.', type: 'success' });
        }
        setChangeTeacherOpen(false);
        loadTeacherState();
      } else {
        setMsg({ text: result.error || 'Failed to submit request', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setChangeRequestSubmitting(false);
    }
  };

  const handleCancelRequest = async () => {
    const token = getStoredToken();
    if (!token) {
      setMsg({ text: 'Session expired. Please sign in again.', type: 'error' });
      return;
    }
    setCancelRequestSubmitting(true);
    try {
      const result = await gs.cancelTeacherChangeRequest(token);
      if (result.success) {
        setMsg({ text: 'Request cancelled.', type: 'success' });
        loadTeacherState();
      } else {
        setMsg({ text: result.error || 'Failed to cancel', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    } finally {
      setCancelRequestSubmitting(false);
    }
  };

  const [refBuilding, setRefBuilding] = useState(false);
  const [refBuildProgress, setRefBuildProgress] = useState('');
  const refBuildingRef = useRef(false);

  const displayCachedReferrals = useCallback(async (mode: 'leads' | 'conversions', page: number) => {
    const email = effectiveEmail || user?.email;
    if (!email) return;
    try {
      const result = await gsCall<{
        success: boolean; rows?: ReferralRow[]; totalCount?: number;
        leadsCount?: number; conversionsCount?: number; complete?: boolean;
      }>('getReferralsWithMode', { email, mode, page, pageSize: 25 });
      if (result.success) {
        setRefRows(result.rows || []);
        setRefTotal(result.totalCount || 0);
        if (result.leadsCount !== undefined) setRefLeadsCount(result.leadsCount);
        if (result.conversionsCount !== undefined) setRefConversionsCount(result.conversionsCount);
        return result.complete ?? false;
      }
    } catch { /* silent */ }
    return false;
  }, [user, effectiveEmail]);

  const buildCache = useCallback(async (email: string) => {
    if (refBuildingRef.current) return;
    refBuildingRef.current = true;
    setRefBuilding(true);

    try {
      let complete = false;
      let pageNum = 0;
      while (!complete) {
        const r = await gsCall<{
          success: boolean; leadsCount?: number; conversionsCount?: number;
          totalFetched?: number; complete?: boolean; page?: number;
        }>('buildReferralCachePage', email);

        if (!r.success) break;
        pageNum = r.page || pageNum + 1;
        complete = r.complete ?? false;
        setRefLeadsCount(r.leadsCount || 0);
        setRefConversionsCount(r.conversionsCount || 0);
        setRefBuildProgress(`Loaded ${r.totalFetched || 0} referrals (page ${pageNum})...`);
      }
    } catch { /* silent */ }
    finally {
      refBuildingRef.current = false;
      setRefBuilding(false);
      setRefBuildProgress('');
    }
  }, []);

  const loadReferrals = useCallback(async (mode: 'leads' | 'conversions', page: number, forceRefresh?: boolean) => {
    const email = effectiveEmail || user?.email;
    if (!email) return;
    setRefLoading(true);

    try {
      if (forceRefresh) {
        await gsCall('resetReferralCache', email);
        setRefRows([]);
        setRefTotal(0);
        setRefLeadsCount(0);
        setRefConversionsCount(0);
        setRefLoading(false);
        setRefInitialLoad(false);
        await buildCache(email);
        await displayCachedReferrals(mode, page);
        return;
      }

      const complete = await displayCachedReferrals(mode, page);
      if (!complete) {
        buildCache(email).then(() => displayCachedReferrals(mode, page));
      }
    } catch { /* silent */ }
    finally { setRefLoading(false); setRefInitialLoad(false); }
  }, [user, effectiveEmail, displayCachedReferrals, buildCache]);

  useEffect(() => {
    if (!sessionLoading && user) loadData();
  }, [sessionLoading, user, loadData]);

  useEffect(() => {
    if (!sessionLoading && user) loadTeacherState();
  }, [sessionLoading, user, loadTeacherState]);

  useEffect(() => {
    if (data && (!data.needsTeacherAssignment || committedViewAsEmail)) loadReferrals(refMode, refPage);
  }, [data, refMode, refPage, loadReferrals, committedViewAsEmail]);

  const handleConfirm = async () => {
    if (confirming || !effectiveEmail) return;
    setConfirming(true);
    try {
      const today = formatDateString(new Date());
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; error?: string; date?: string; confirmationNumber?: number }>(
        'confirmAttendance', effectiveEmail, today, token
      );
      if (result.success) {
        setMsg({ text: 'Attendance confirmed!', type: 'success' });
        // Optimistic update: add the new record to local state without full reload
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

  const preloadAllUsers = useCallback(async () => {
    if (allUsersLoaded) return;
    setAdminSearching(true);
    try {
      const result = await gsCall<{ success: boolean; users?: Record<string, unknown>[] }>(
        'searchAttendanceUsers', ''
      );
      if (result.success) {
        const sorted = (result.users || []).sort((a, b) => {
          const nameA = ((a.name as string) || (a.email as string) || '').toLowerCase();
          const nameB = ((b.name as string) || (b.email as string) || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        setAllUsers(sorted);
        setAllUsersLoaded(true);
      }
    } catch { /* silent */ }
    finally { setAdminSearching(false); }
  }, [allUsersLoaded]);

  useEffect(() => {
    if (!sessionLoading && user && (user.isAdmin || user.isSupervisor)) {
      preloadAllUsers();
    }
  }, [sessionLoading, user, preloadAllUsers]);

  const [showHidden, setShowHidden] = useState(false);

  const adminUsers = (() => {
    const q = adminSearch.toLowerCase().trim();
    let filtered = allUsers.filter((u) => !u.isHidden);
    if (q) {
      filtered = filtered.filter((u) => {
        const name = ((u.name as string) || '').toLowerCase();
        const email = ((u.email as string) || '').toLowerCase();
        const teacher = ((u.teacherEmail as string) || '').toLowerCase();
        return name.includes(q) || email.includes(q) || teacher.includes(q);
      });
    }
    return filtered;
  })();

  const hiddenUsers = (() => {
    const q = adminSearch.toLowerCase().trim();
    let filtered = allUsers.filter((u) => !!u.isHidden);
    if (q) {
      filtered = filtered.filter((u) => {
        const name = ((u.name as string) || '').toLowerCase();
        const email = ((u.email as string) || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }
    return filtered;
  })();

  const [dashLoading, setDashLoading] = useState(false);

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const todayDateStr = formatDateString(now);
  
  // Compute todayConfirmed from records
  const todayConfirmed = data?.records?.some(r => r.date.split('T')[0] === todayDateStr && r.type === 'confirmed') || false;
  
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

        {/* Supervisor/Admin: view as student by email */}
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
                  if (trimmed) { setCommittedViewAsEmail(trimmed); loadData(trimmed); loadTeacherState(trimmed); }
                }
              }}
            />
            <button type="button" onClick={() => {
              const trimmed = supervisorViewAsEmail.trim();
              if (!trimmed) return;
              setCommittedViewAsEmail(trimmed);
              loadData(trimmed);
              loadTeacherState(trimmed);
            }}>
              View
            </button>
            {committedViewAsEmail && (
              <button
                type="button"
                className="supervisor-bar-back"
                onClick={() => {
                  setSupervisorViewAsEmail('');
                  setCommittedViewAsEmail('');
                  setAdminSelectedUser(null);
                  if (user?.email) {
                    loadData(user.email);
                    loadTeacherState();
                  }
                }}
              >
                Back to my dashboard
              </button>
            )}
          </div>
        )}

        {/* My Teacher (request + approval workflow) */}
        {!loadingTeacherState && (
          <div className="my-teacher-card">
            <h3>My Teacher</h3>
            {teacherState?.teacher ? (
              <div className="my-teacher-info">
                <p className="my-teacher-name">{teacherState.teacher.name}</p>
                <p className="my-teacher-email">{teacherState.teacher.email}</p>
              </div>
            ) : (
              <p className="my-teacher-none">No teacher assigned</p>
            )}
            {teacherState?.openRequest && (
              <div className="my-teacher-pending">
                <p>Request pending approval by <strong>{teacherState.openRequest.toTeacherName}</strong></p>
                <p className="my-teacher-pending-date">Requested {new Date(teacherState.openRequest.requestedAt).toLocaleDateString()}</p>
                <button type="button" className="btn-cancel-request" onClick={handleCancelRequest} disabled={cancelRequestSubmitting}>
                  {cancelRequestSubmitting ? 'Cancelling...' : 'Cancel request'}
                </button>
              </div>
            )}
            <button type="button" className="btn-change-teacher" onClick={openChangeTeacherModal}>
              {teacherState?.teacher ? 'Change Teacher' : 'Select a Teacher'}
            </button>
          </div>
        )}

        {/* Change Teacher modal */}
        {changeTeacherOpen && (
          <div className="modal-overlay" onClick={() => !changeRequestSubmitting && setChangeTeacherOpen(false)}>
            <div className="modal-content my-teacher-modal" onClick={e => e.stopPropagation()}>
              <h3>{teacherState?.teacher ? 'Change Teacher' : 'Select a Teacher'}</h3>
              {teacherState?.teacher ? (
                <p className="modal-hint">The teacher must accept your request before the change takes effect.</p>
              ) : (
                <p className="modal-hint">Select a teacher to get started. You will be assigned immediately.</p>
              )}
              <div className="modal-field">
                <label>Teacher</label>
                <select value={selectedToTeacherId} onChange={e => setSelectedToTeacherId(e.target.value)}>
                  <option value="">Select a teacher...</option>
                  {eligibleTeachers.map(t => (
                    <option key={t.id} value={t.id}>{t.name || t.email}</option>
                  ))}
                </select>
              </div>
              <div className="modal-field">
                <label>Message (optional)</label>
                <input type="text" value={changeRequestMessage} onChange={e => setChangeRequestMessage(e.target.value)} placeholder="Optional message to teacher" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-modal-secondary" onClick={() => setChangeTeacherOpen(false)} disabled={changeRequestSubmitting}>Cancel</button>
                <button type="button" className="btn-modal-primary" onClick={handleSubmitChangeRequest} disabled={!selectedToTeacherId || changeRequestSubmitting}>
                  {changeRequestSubmitting ? 'Submitting...' : teacherState?.teacher ? 'Submit request' : 'Select teacher'}
                </button>
              </div>
            </div>
          </div>
        )}

        {data && (!data.needsTeacherAssignment || committedViewAsEmail) && (
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
                    const timeStr = r.type === 'confirmed' && r.confirmedAt
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {(refLeadsCount > 0 || refConversionsCount > 0) && (
                    <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 4 }}>
                      {refLeadsCount} leads · {refConversionsCount} conversions
                    </span>
                  )}
                  <button
                    title="Refresh referral data (rebuilds cache)"
                    disabled={refLoading || refBuilding}
                    onClick={() => loadReferrals(refMode, refPage, true)}
                    style={{ background: 'none', border: 'none', cursor: (refLoading || refBuilding) ? 'not-allowed' : 'pointer', padding: 4, color: '#94a3b8', display: 'flex', alignItems: 'center' }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ animation: (refLoading || refBuilding) ? 'spin 1s linear infinite' : 'none' }}>
                      <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                  </button>
                  <div className="ref-toggle">
                    <button className={refMode === 'leads' ? 'active' : ''} onClick={() => { setRefMode('leads'); setRefPage(1); }}>Leads</button>
                    <button className={refMode === 'conversions' ? 'active' : ''} onClick={() => { setRefMode('conversions'); setRefPage(1); }}>Conversions</button>
                  </div>
                </div>
              </div>
              {refBuilding && (
                <div style={{ padding: '12px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="ref-skeleton-spinner" />
                  <div>
                    <p style={{ margin: 0, fontSize: 13, color: '#0369a1', fontWeight: 500 }}>Building referral data...</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#0284c7' }}>{refBuildProgress || 'Fetching referral data...'}</p>
                  </div>
                </div>
              )}
              {refLoading && refInitialLoad && !refBuilding ? (
                <div style={{ padding: '24px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div className="ref-skeleton-spinner" />
                    <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>Loading referrals...</p>
                  </div>
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="ref-skeleton-row" style={{ animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
              ) : refLoading && !refBuilding ? (
                <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="ref-skeleton-spinner" />
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>Updating...</span>
                </div>
              ) : refRows.length === 0 && !refBuilding ? (
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
                    <span>Page {refPage} of {Math.ceil(refTotal / 25) || 1} ({refTotal} {refMode})</span>
                    <button disabled={refPage * 25 >= refTotal} onClick={() => setRefPage(p => p + 1)}>Next</button>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Admin / Supervisor section */}
        {(user?.isAdmin || user?.isSupervisor) && (
          <div className="admin-section">
            <div className="admin-header">
              <div className="admin-header-icon">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              </div>
              <div>
                <h3>{user?.isAdmin ? 'Admin Console' : 'Supervisor Console'}</h3>
                <p className="admin-subtitle">{user?.isAdmin ? 'Search and manage all users in the system' : 'Search and view user details'}</p>
              </div>
            </div>

            <div className="admin-search-container">
              <div className="admin-search-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              </div>
              <input
                type="text"
                value={adminSearch}
                onChange={(e) => setAdminSearch(e.target.value)}
                placeholder={allUsersLoaded ? `Search ${allUsers.length} users...` : 'Loading users...'}
                className="admin-search-input"
              />
              {adminSearching && <div className="admin-search-spinner" />}
              {adminSearch && !adminSearching && (
                <button className="admin-search-clear" onClick={() => { setAdminSearch(''); setAdminSelectedUser(null); }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              )}
            </div>

            {adminSearch && !adminSearching && adminUsers.length === 0 && (
              <div className="admin-empty">No users found for &quot;{adminSearch}&quot;</div>
            )}

            {!allUsersLoaded && !adminSearching && (
              <div className="admin-hint">
                <div className="admin-search-spinner large" />
                <p>Loading users...</p>
              </div>
            )}

            {allUsersLoaded && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 4px' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  {adminSearch ? `${adminUsers.length} of ${allUsers.length} users` : `${allUsers.length} users`}
                </span>
                <button style={{ fontSize: 11, color: '#a78bfa', background: 'none', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => { setAllUsersLoaded(false); preloadAllUsers(); }}>Reload</button>
              </div>
            )}

            <div className="admin-results">
              {adminUsers.map((u, i) => (
                <div key={i} className={`admin-user-card ${adminSelectedUser && ((adminSelectedUser.student || adminSelectedUser) as Record<string, unknown>).email === u.email ? 'selected' : ''}`} onClick={async () => {
                  const email = (u.email ?? u.aliasEmail) as string;
                  if (!email) return;
                  setDashLoading(true);
                  try {
                    const token = getStoredToken();
                    const dash = await gsCall<Record<string, unknown>>('adminGetStudentDashboard', email, token);
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
                    {!!(u.isSupervisor) && <span className="admin-badge supervisor">Supervisor</span>}
                    {!(u.isTeacher) && !(u.isAdmin) && !(u.isSupervisor) && <span className="admin-badge student">Student</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Hidden accounts section - admin only */}
            {user?.isAdmin && hiddenUsers.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button
                  style={{ width: '100%', padding: '10px 16px', background: 'rgba(120,113,108,0.2)', border: '1px solid rgba(120,113,108,0.3)', borderRadius: 10, color: '#a8a29e', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => setShowHidden(!showHidden)}
                >
                  <span>Hidden Accounts ({hiddenUsers.length})</span>
                  <span style={{ fontSize: 11 }}>{showHidden ? 'Hide ▲' : 'Show ▼'}</span>
                </button>
                {showHidden && (
                  <div className="admin-results" style={{ marginTop: 8, opacity: 0.7 }}>
                    {hiddenUsers.map((u, i) => (
                      <div key={`h-${i}`} className={`admin-user-card ${adminSelectedUser && ((adminSelectedUser.student || adminSelectedUser) as Record<string, unknown>).email === u.email ? 'selected' : ''}`} style={{ borderColor: 'rgba(120,113,108,0.3)' }} onClick={async () => {
                        const email = (u.email ?? u.aliasEmail) as string;
                        if (!email) return;
                        setDashLoading(true);
                        try {
                          const token = getStoredToken();
                          const dash = await gsCall<Record<string, unknown>>('adminGetStudentDashboard', email, token);
                          setAdminSelectedUser(dash);
                        } catch {
                          setAdminSelectedUser(u);
                        } finally { setDashLoading(false); }
                      }}>
                        <div className="admin-card-left">
                          <div className="admin-avatar" style={{ background: '#78716c' }}>{((u.name as string) || (u.email as string)).charAt(0).toUpperCase()}</div>
                          <div>
                            <div className="admin-user-name">{(u.name as string) || (u.email as string)}</div>
                            <div className="admin-user-email">{u.email as string}</div>
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: '#78716c', padding: '2px 8px', border: '1px solid rgba(120,113,108,0.3)', borderRadius: 6 }}>HIDDEN</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {dashLoading && (
              <div className="admin-dash-loading">
                <div className="admin-search-spinner large" />
                <p>Loading dashboard...</p>
              </div>
            )}
            {adminSelectedUser && (() => {
              const isAdmin = !!user?.isAdmin;
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
                    <div><strong>Login email:</strong> {((stu.email ?? stu.aliasEmail) as string) || '-'}</div>
                    {isAdmin && <div><strong>Internal Email:</strong> {(stu.internalEmail as string) || '-'}</div>}
                    <div><strong>Teacher:</strong> {(stu.teacherEmail as string) || 'Not assigned'}</div>
                    {isAdmin && <div><strong>Status:</strong> {(stu.accountStatus as string) || '-'}</div>}
                    {!!(stu.isTeacher) && <div><span className="admin-badge teacher">Teacher</span></div>}
                    {isAdmin && !!(stu.isAdmin) && <div><span className="admin-badge admin">Admin</span></div>}
                    {isAdmin && !!(stu.isSupervisor) && <div><span className="admin-badge supervisor">Supervisor</span></div>}
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

                  {/* View full dashboard */}
                  <button className="admin-action-btn" style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff', fontWeight: 600, marginBottom: 8 }} onClick={() => {
                    const email = ((stu.email ?? stu.aliasEmail) as string);
                    if (!email) return;
                    setSupervisorViewAsEmail(email);
                    setCommittedViewAsEmail(email);
                    loadData(email);
                    loadTeacherState(email);
                    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}>View Full Dashboard</button>

                  {/* Actions - admin gets full control, supervisor gets limited view */}
                  <div style={{ display: 'grid', gap: 8 }}>
                    {isAdmin && (
                      <button className="admin-action-btn" onClick={async () => {
                        const newEmail = prompt('New login email:', (stu.email as string));
                        if (!newEmail) return;
                        const token = getStoredToken();
                        const r = await gsCall<{ success: boolean; error?: string }>('adminUpdateAliasEmail', (stu.email as string), newEmail, token);
                        alert(r.success ? 'Email updated!' : (r.error || 'Failed'));
                      }}>Edit Login Email</button>
                    )}
                    <button className="admin-action-btn" onClick={async () => {
                      const newTeacher = prompt('New teacher email:', (stu.teacherEmail as string) || '');
                      if (!newTeacher) return;
                      const token = getStoredToken();
                      const r = await gsCall<{ success: boolean; error?: string }>('adminUpdateStudentTeacher', (stu.email as string), newTeacher, token);
                      alert(r.success ? 'Teacher updated!' : (r.error || 'Failed'));
                    }}>Change Teacher</button>
                    {isAdmin && (
                      <button className="admin-action-btn" onClick={async () => {
                        const token = getStoredToken();
                        if (!token) return;
                        const isSupervisor = !!(stu.isSupervisor);
                        const r = await gs.adminSetSupervisor((stu.email as string), !isSupervisor, token);
                        if (r.success) {
                          setMsg({ text: !isSupervisor ? 'User set as supervisor.' : 'Supervisor role removed.', type: 'success' });
                          const dash = await gsCall<Record<string, unknown>>('adminGetStudentDashboard', (stu.email as string), token);
                          setAdminSelectedUser(dash);
                        } else {
                          setMsg({ text: r.error || 'Failed', type: 'error' });
                        }
                      }}>{(stu.isSupervisor) ? 'Remove supervisor' : 'Set as supervisor'}</button>
                    )}
                    <button className="admin-action-btn danger" onClick={async () => {
                      if (!confirm(`Delete all attendance for ${stu.email}? This cannot be undone!`)) return;
                      if (!confirm('Are you absolutely sure?')) return;
                      const token = getStoredToken();
                      const r = await gsCall<{ success: boolean; error?: string }>('resetAllAttendance', (stu.email as string), token);
                      alert(r.success ? 'Attendance reset!' : (r.error || 'Failed'));
                    }}>Reset All Attendance</button>
                    {isAdmin && (
                      <button className="admin-action-btn" style={{ background: stu.isHidden ? '#065f46' : '#44403c', color: stu.isHidden ? '#a7f3d0' : '#d6d3d1' }} onClick={async () => {
                        const token = getStoredToken();
                        const willHide = !stu.isHidden;
                        const r = await gsCall<{ success: boolean; error?: string }>('adminToggleHideUser', (stu.email as string), willHide, token);
                        if (r.success) {
                          setMsg({ text: willHide ? 'Account hidden from lookup.' : 'Account restored to lookup.', type: 'success' });
                          setAdminSelectedUser(null);
                          setAllUsersLoaded(false);
                          preloadAllUsers();
                        } else { alert(r.error || 'Failed'); }
                      }}>{stu.isHidden ? 'Unhide Account' : 'Hide Account'}</button>
                    )}
                    {isAdmin && (
                      <button className="admin-action-btn danger" style={{ background: '#7f1d1d', color: '#fecaca' }} onClick={async () => {
                        if (!confirm(`Permanently delete ${stu.email} and ALL their data? This CANNOT be undone!`)) return;
                        if (!confirm('This will remove the user, attendance, sessions, and all related records. Are you absolutely sure?')) return;
                        const token = getStoredToken();
                        const r = await gsCall<{ success: boolean; error?: string }>('adminDeleteUser', (stu.email as string), token);
                        if (r.success) {
                          setMsg({ text: 'User deleted successfully.', type: 'success' });
                          setAdminSelectedUser(null);
                          setSupervisorViewAsEmail('');
                          setCommittedViewAsEmail('');
                          if (user?.email) { loadData(user.email); loadTeacherState(); }
                          setAllUsersLoaded(false);
                          preloadAllUsers();
                        } else {
                          alert(r.error || 'Failed to delete user');
                        }
                      }}>Delete User</button>
                    )}
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

        .my-teacher-card {
          background: linear-gradient(135deg, #e0e7ff, #c7d2fe); padding: 20px 24px;
          border-radius: 16px; margin-bottom: 20px; border: 2px solid #a5b4fc;
        }
        .my-teacher-card h3 { color: #3730a3; font-size: 18px; margin: 0 0 12px; }
        .my-teacher-info { margin-bottom: 8px; }
        .my-teacher-name { font-weight: 600; color: #1e293b; margin: 0 0 2px; }
        .my-teacher-email { font-size: 14px; color: #475569; margin: 0; }
        .my-teacher-none { color: #64748b; margin: 0 0 12px; }
        .my-teacher-pending {
          background: rgba(254,243,199,0.8); padding: 12px; border-radius: 10px;
          margin-bottom: 12px; border: 1px solid #fcd34d;
        }
        .my-teacher-pending p { margin: 0 0 4px; font-size: 14px; color: #78350f; }
        .my-teacher-pending-date { font-size: 12px; color: #92400e !important; }
        .btn-cancel-request {
          padding: 6px 14px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
          border-radius: 8px; cursor: pointer; font-size: 13px; font-family: inherit; margin-top: 8px;
        }
        .btn-cancel-request:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-change-teacher {
          padding: 10px 20px; background: linear-gradient(135deg, #667eea, #764ba2); color: white;
          border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; font-family: inherit;
        }
        .btn-change-teacher:hover { opacity: 0.95; }
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex;
          align-items: center; justify-content: center; z-index: 100; padding: 20px;
        }
        .modal-content {
          background: white; border-radius: 16px; padding: 24px; max-width: 420px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .my-teacher-modal h3 { margin: 0 0 8px; color: #1e293b; }
        .modal-hint { font-size: 13px; color: #64748b; margin: 0 0 16px; }
        .modal-field { margin-bottom: 14px; }
        .modal-field label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 4px; }
        .modal-field select, .modal-field input {
          width: 100%; padding: 10px 12px; border: 2px solid #e2e8f0; border-radius: 10px;
          font-size: 14px; font-family: inherit; box-sizing: border-box;
        }
        .modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px; }
        .btn-modal-secondary {
          padding: 10px 18px; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;
          border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 500;
        }
        .btn-modal-primary {
          padding: 10px 18px; background: linear-gradient(135deg, #667eea, #764ba2); color: white;
          border: none; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 600;
        }
        .btn-modal-primary:disabled, .btn-modal-secondary:disabled { opacity: 0.6; cursor: not-allowed; }

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

        .ref-skeleton-spinner {
          width: 20px; height: 20px; border: 2px solid #e2e8f0; border-top-color: #667eea;
          border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
        }
        .ref-skeleton-row {
          height: 36px; background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
          background-size: 200% 100%; border-radius: 8px; margin-bottom: 8px;
          animation: shimmer 1.5s ease-in-out infinite;
        }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

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
        .supervisor-bar-back {
          margin-left: auto !important;
          background: transparent !important;
          color: #6d28d9 !important;
          font-weight: 500 !important;
          font-size: 13px !important;
          padding: 8px 14px !important;
          border: 1px solid rgba(139,92,246,0.4) !important;
        }
        .supervisor-bar-back:hover {
          background: rgba(139,92,246,0.12) !important;
        }

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
        .admin-badge.supervisor { background: rgba(139,92,246,0.2); color: #c4b5fd; border: 1px solid rgba(139,92,246,0.3); }
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
