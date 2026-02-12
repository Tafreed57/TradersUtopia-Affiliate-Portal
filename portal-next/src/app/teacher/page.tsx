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
import { gsCall, getStoredToken } from '@/lib/client/gs-compat';

interface StudentItem {
  email: string;
  name?: string;
  percentageOverride?: number;
  unpaid30Day?: number;
  dueNow30Day?: number;
}

interface TeacherPageData {
  students: StudentItem[];
  totalStudents: number;
  totalUnpaid: number;
  totalDueNow: number;
  lockedUnpaid: number;
  lockedDueNow: number;
  totalLockedEarnings: number;
  adjustmentPercentage?: number;
  [key: string]: unknown;
}

function TeacherContent() {
  const { user, isLoading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; type: string } | null>(null);
  const [data, setData] = useState<TeacherPageData | null>(null);
  const [commissionData, setCommissionData] = useState<Record<string, Record<string, unknown>>>({});
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

  // Per-student percentage
  const [percentageInputs, setPercentageInputs] = useState<Record<string, string>>({});

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
      const result = await gsCall<{ success: boolean; data?: Record<string, Record<string, unknown>>; students?: Record<string, unknown>[] }>(
        'getStudentsCommissionData', email, token
      );
      if (result.success && result.data) {
        setCommissionData(result.data);
      }
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    if (sessionLoading || !user) return;
    const email = user.email;
    setTargetEmail(email);
    loadTeacherData(email);
    loadCommissionData(email);
  }, [sessionLoading, user, loadTeacherData, loadCommissionData]);

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

  const handleRemoveStudent = async (studentEmail: string) => {
    if (!confirm(`Remove ${studentEmail}?`)) return;
    try {
      await gsCall('removeStudentFromTeacher', targetEmail, studentEmail);
      loadTeacherData(targetEmail);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleSetPercentage = async (studentEmail: string) => {
    const pct = percentageInputs[studentEmail];
    try {
      await gsCall('setStudentPercentageOverride', targetEmail, studentEmail, pct ? Number(pct) : null);
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
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleViewStats = async (studentEmail: string) => {
    if (viewingStats === studentEmail) { setViewingStats(null); return; }
    setViewingStats(studentEmail);
    setStatsLoading(true);
    setStatsData(null);
    try {
      const token = getStoredToken();
      const result = await gsCall<Record<string, unknown>>(
        'getStudentAttendanceStats', targetEmail, studentEmail, token
      );
      setStatsData(result);
    } catch {
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleAdminSearch = () => {
    if (!managedEmail.trim() || !managedEmail.includes('@')) return;
    setIsManaging(true);
    setTargetEmail(managedEmail.trim().toLowerCase());
    loadTeacherData(managedEmail.trim().toLowerCase());
    loadCommissionData(managedEmail.trim().toLowerCase());
  };

  const handleExitManage = () => {
    setIsManaging(false);
    setManagedEmail('');
    const email = user?.email || '';
    setTargetEmail(email);
    loadTeacherData(email);
    loadCommissionData(email);
  };

  if (sessionLoading || loading) {
    return <LoadingOverlay message="Loading Teacher Portal..." />;
  }

  return (
    <div className="page-bg">
      <div className="page-container">
        <Navigation title="Teacher Portal" variant="light-bg" />

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
                <div className="stat-value">{data.totalStudents || data.students?.length || 0}</div>
                <div className="stat-label">Total Students</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatMoney(data.totalUnpaid)}</div>
                <div className="stat-label">Total Unpaid</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatMoney(data.totalDueNow)}</div>
                <div className="stat-label">Total Due Now</div>
              </div>
            </div>

            {/* Locked earnings */}
            <div className="locked-section">
              <h3>Your Locked Earnings</h3>
              <div className="locked-grid">
                <div className="locked-card">
                  <div className="locked-value">{formatMoney(data.lockedUnpaid)}</div>
                  <div className="locked-label">Locked Unpaid</div>
                </div>
                <div className="locked-card">
                  <div className="locked-value">{formatMoney(data.lockedDueNow)}</div>
                  <div className="locked-label">Locked Due Now</div>
                </div>
                <div className="locked-card highlight">
                  <div className="locked-value">{formatMoney(data.totalLockedEarnings)}</div>
                  <div className="locked-label">Total Locked Earnings</div>
                </div>
              </div>
              <button className="btn-update-earnings" onClick={handleUpdateEarnings}>Update My Earnings</button>
            </div>

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
                  const cd = commissionData[student.email] || {};
                  return (
                    <div key={student.email} className="student-card">
                      <div className="student-header">
                        <div className="student-info">
                          <span className="student-email">{student.email}</span>
                          {student.percentageOverride != null && (
                            <span className="pct-badge">{student.percentageOverride}%</span>
                          )}
                        </div>
                        <div className="student-amounts">
                          <span className="amount-label">30d Unpaid: <strong>{formatMoney(cd.unpaid30Day as number || student.unpaid30Day)}</strong></span>
                          <span className="amount-label">30d Due: <strong>{formatMoney(cd.dueNow30Day as number || student.dueNow30Day)}</strong></span>
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
                          <button className="btn-remove" onClick={() => handleRemoveStudent(student.email)}>Remove</button>
                        </div>
                      </div>

                      {/* Student stats expansion */}
                      {viewingStats === student.email && (
                        <div className="stats-expansion">
                          {statsLoading ? (
                            <p className="loading-text">Loading stats...</p>
                          ) : statsData ? (
                            <div className="stats-detail">
                              <div className="mini-stats-grid">
                                <div className="mini-stat"><strong>{(statsData as Record<string, unknown>).totalDays as number || 0}</strong><span>Total Days</span></div>
                                <div className="mini-stat"><strong>{(statsData as Record<string, unknown>).confirmedDays as number || 0}</strong><span>Confirmed</span></div>
                                <div className="mini-stat"><strong>{(statsData as Record<string, unknown>).missedDays as number || 0}</strong><span>Missed</span></div>
                                <div className="mini-stat"><strong>{(statsData as Record<string, unknown>).attendanceRate as string || '0%'}</strong><span>Rate</span></div>
                              </div>
                            </div>
                          ) : (
                            <p className="loading-text">No stats available</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Refresh button */}
            <div className="footer-actions">
              <button className="btn-refresh" onClick={() => { loadTeacherData(targetEmail); loadCommissionData(targetEmail); }}>
                Refresh Data
              </button>
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
        .page-container {
          max-width: 900px; margin: 0 auto;
          background: rgba(255,255,255,0.95); backdrop-filter: blur(10px);
          border-radius: 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          padding: 30px; animation: fadeIn 0.6s ease-out;
        }
        @keyframes fadeIn { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }

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
