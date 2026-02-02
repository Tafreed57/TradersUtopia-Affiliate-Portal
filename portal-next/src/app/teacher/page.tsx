'use client';

/**
 * Teacher Portal
 *
 * Allows teachers to manage students and view earnings.
 */

import { useState, useEffect } from 'react';
import { Navigation } from '@/components/Navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useSession } from '@/hooks/useSession';
import { gsCall, getStoredToken } from '@/lib/client/gs-compat';

interface Student {
  email: string;
  name: string;
  internalEmail?: string;
  affiliateId?: string;
  percentageOverride?: number;
  addedDate: string;
}

interface TeacherData {
  teacher: {
    email: string;
    name: string;
    isAdmin: boolean;
  };
  students: Student[];
  earnings: {
    lockedEarnings: number;
    totalEarnedAllTime: number;
    totalPaidAllTime: number;
    lockedAt?: string;
  };
}

type Tab = 'students' | 'earnings' | 'referrals';

function TeacherContent() {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<TeacherData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('students');

  // Add student form
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);
  const [addMessage, setAddMessage] = useState('');

  useEffect(() => {
    if (user?.email) {
      loadTeacherData();
    }
  }, [user]);

  const loadTeacherData = async () => {
    setLoading(true);
    setError('');

    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; data?: TeacherData; error?: string }>(
        'getTeacherDataWithContext',
        user?.email,
        token
      );

      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error || 'Failed to load teacher data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentEmail.trim()) return;

    setAddingStudent(true);
    setAddMessage('');

    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; error?: string }>(
        'addStudentToTeacherWithContext',
        user?.email,
        newStudentEmail.trim(),
        token
      );

      if (result.success) {
        setAddMessage('Student added successfully!');
        setNewStudentEmail('');
        loadTeacherData();
      } else {
        setAddMessage(result.error || 'Failed to add student');
      }
    } catch (err) {
      setAddMessage(err instanceof Error ? err.message : 'Failed to add student');
    } finally {
      setAddingStudent(false);
    }
  };

  const handleRemoveStudent = async (studentEmail: string) => {
    if (!confirm(`Remove ${studentEmail} from your students?`)) return;

    try {
      const result = await gsCall<{ success: boolean; error?: string }>(
        'removeStudentFromTeacher',
        user?.email,
        studentEmail
      );

      if (result.success) {
        loadTeacherData();
      } else {
        alert(result.error || 'Failed to remove student');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove student');
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
          <h1>Teacher Portal</h1>
          <p>Manage your students and track your earnings</p>
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

        {data && !loading && (
          <>
            {/* Tabs */}
            <div className="tabs">
              <button
                className={`tab ${activeTab === 'students' ? 'active' : ''}`}
                onClick={() => setActiveTab('students')}
              >
                Students ({data.students.length})
              </button>
              <button
                className={`tab ${activeTab === 'earnings' ? 'active' : ''}`}
                onClick={() => setActiveTab('earnings')}
              >
                Earnings
              </button>
              <button
                className={`tab ${activeTab === 'referrals' ? 'active' : ''}`}
                onClick={() => setActiveTab('referrals')}
              >
                Student Referrals
              </button>
            </div>

            {/* Students Tab */}
            {activeTab === 'students' && (
              <div className="tab-content">
                {/* Add student form */}
                <div className="add-form">
                  <h3>Add Student</h3>
                  <form onSubmit={handleAddStudent}>
                    <input
                      type="email"
                      value={newStudentEmail}
                      onChange={(e) => setNewStudentEmail(e.target.value)}
                      placeholder="Student email address"
                      required
                    />
                    <button type="submit" disabled={addingStudent}>
                      {addingStudent ? 'Adding...' : 'Add Student'}
                    </button>
                  </form>
                  {addMessage && (
                    <p className={`message ${addMessage.includes('success') ? 'success' : 'error'}`}>
                      {addMessage}
                    </p>
                  )}
                </div>

                {/* Students list */}
                <div className="students-list">
                  {data.students.length === 0 ? (
                    <p className="empty">No students added yet</p>
                  ) : (
                    data.students.map((student) => (
                      <div key={student.email} className="student-card">
                        <div className="student-info">
                          <h4>{student.name || student.email}</h4>
                          <p>{student.email}</p>
                          {student.percentageOverride && (
                            <span className="badge">
                              {student.percentageOverride}% commission
                            </span>
                          )}
                        </div>
                        <div className="student-actions">
                          <button
                            onClick={() => handleRemoveStudent(student.email)}
                            className="btn-remove"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Earnings Tab */}
            {activeTab === 'earnings' && (
              <div className="tab-content">
                <div className="earnings-grid">
                  <div className="earnings-card">
                    <h3>Locked Earnings</h3>
                    <div className="amount">{formatCurrency(data.earnings.lockedEarnings)}</div>
                    <p>Available for payout</p>
                    {data.earnings.lockedAt && (
                      <span className="meta">
                        Locked at: {new Date(data.earnings.lockedAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="earnings-card">
                    <h3>Total Earned</h3>
                    <div className="amount">{formatCurrency(data.earnings.totalEarnedAllTime)}</div>
                    <p>All-time earnings</p>
                  </div>

                  <div className="earnings-card">
                    <h3>Total Paid</h3>
                    <div className="amount">{formatCurrency(data.earnings.totalPaidAllTime)}</div>
                    <p>All-time payouts</p>
                  </div>
                </div>
              </div>
            )}

            {/* Referrals Tab */}
            {activeTab === 'referrals' && (
              <div className="tab-content">
                <p className="info-text">
                  View leads and conversions for each of your students.
                  Select a student to view their referral data.
                </p>
                <div className="students-list compact">
                  {data.students.map((student) => (
                    <div key={student.email} className="student-card compact">
                      <div className="student-info">
                        <h4>{student.name || student.email}</h4>
                        <p>{student.email}</p>
                      </div>
                      <button className="btn-view">View Referrals →</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
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

        .tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .tab {
          padding: 1rem 1.5rem;
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
        }

        .tab:hover {
          color: #e0e0e0;
        }

        .tab.active {
          color: #00d4ff;
          border-bottom: 2px solid #00d4ff;
          margin-bottom: -1px;
        }

        .tab-content {
          background: rgba(26, 26, 46, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .add-form {
          margin-bottom: 1.5rem;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .add-form h3 {
          color: #e0e0e0;
          font-size: 1rem;
          margin: 0 0 1rem;
        }

        .add-form form {
          display: flex;
          gap: 0.5rem;
        }

        .add-form input {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: #e0e0e0;
          font-size: 1rem;
        }

        .add-form input:focus {
          outline: none;
          border-color: #00d4ff;
        }

        .add-form button {
          padding: 0.75rem 1.5rem;
          background: #00d4ff;
          color: #0f0f1a;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }

        .add-form button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .message {
          margin-top: 0.5rem;
          font-size: 0.9rem;
        }

        .message.success {
          color: #6fcf6f;
        }

        .message.error {
          color: #ff6b6b;
        }

        .students-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .empty {
          color: #888;
          text-align: center;
          padding: 2rem;
        }

        .student-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 1rem;
        }

        .student-info h4 {
          color: #e0e0e0;
          margin: 0 0 0.25rem;
        }

        .student-info p {
          color: #888;
          font-size: 0.85rem;
          margin: 0;
        }

        .badge {
          display: inline-block;
          margin-top: 0.5rem;
          padding: 0.25rem 0.5rem;
          background: rgba(255, 170, 68, 0.2);
          color: #ffaa44;
          border-radius: 4px;
          font-size: 0.75rem;
        }

        .btn-remove {
          padding: 0.5rem 1rem;
          background: transparent;
          border: 1px solid rgba(255, 107, 107, 0.3);
          color: #ff6b6b;
          border-radius: 6px;
          cursor: pointer;
        }

        .btn-remove:hover {
          background: rgba(255, 107, 107, 0.1);
        }

        .btn-view {
          padding: 0.5rem 1rem;
          background: transparent;
          border: 1px solid rgba(0, 212, 255, 0.3);
          color: #00d4ff;
          border-radius: 6px;
          cursor: pointer;
        }

        .btn-view:hover {
          background: rgba(0, 212, 255, 0.1);
        }

        .earnings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1rem;
        }

        .earnings-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 1.5rem;
          text-align: center;
        }

        .earnings-card h3 {
          color: #888;
          font-size: 0.9rem;
          font-weight: normal;
          margin: 0 0 0.5rem;
        }

        .earnings-card .amount {
          font-size: 1.75rem;
          font-weight: bold;
          color: #00d4ff;
          margin-bottom: 0.25rem;
        }

        .earnings-card p {
          color: #666;
          font-size: 0.8rem;
          margin: 0;
        }

        .earnings-card .meta {
          display: block;
          margin-top: 0.5rem;
          font-size: 0.75rem;
          color: #666;
        }

        .info-text {
          color: #888;
          margin: 0 0 1.5rem;
        }

        .students-list.compact .student-card {
          padding: 0.75rem 1rem;
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
