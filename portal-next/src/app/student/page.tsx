'use client';

/**
 * Student Dashboard / Attendance Portal
 *
 * Allows students to confirm attendance and view their records.
 */

import { useState, useEffect } from 'react';
import { Navigation } from '@/components/Navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useSession } from '@/hooks/useSession';
import { gsCall, getStoredToken } from '@/lib/client/gs-compat';

interface AttendanceRecord {
  date: string;
  confirmedAt: string;
  type: 'confirmed' | 'missed';
  teacherEmail?: string;
}

interface AttendanceData {
  user: {
    email: string;
    teacherEmail?: string;
    createdAt: string;
  };
  records: AttendanceRecord[];
  stats: {
    totalConfirmed: number;
    totalMissed: number;
    streak: number;
    firstConfirmationDate?: string;
  };
  needsTeacherAssignment: boolean;
}

interface Teacher {
  email: string;
  name: string;
}

function StudentContent() {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<AttendanceData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');

  // Teacher selection state
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [loadingTeachers, setLoadingTeachers] = useState(false);

  // Load attendance data
  useEffect(() => {
    if (user?.email) {
      loadAttendanceData();
    }
  }, [user]);

  const loadAttendanceData = async () => {
    setLoading(true);
    setError('');

    try {
      const token = getStoredToken();
      const result = await gsCall<{ success: boolean; data?: AttendanceData; error?: string }>(
        'getAttendanceData',
        user?.email,
        token
      );

      if (result.success && result.data) {
        setData(result.data);

        if (result.data.needsTeacherAssignment) {
          loadTeachers();
        }
      } else {
        setError(result.error || 'Failed to load attendance data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadTeachers = async () => {
    setLoadingTeachers(true);
    try {
      const result = await gsCall<{ success: boolean; teachers?: Teacher[] }>('getAllValidTeachers');
      if (result.success && result.teachers) {
        setTeachers(result.teachers);
      }
    } catch (err) {
      console.error('Failed to load teachers:', err);
    } finally {
      setLoadingTeachers(false);
    }
  };

  const handleConfirmAttendance = async () => {
    if (confirming) return;

    setConfirming(true);
    setConfirmMessage('');

    try {
      const token = getStoredToken();
      const today = new Date().toISOString().split('T')[0];

      const result = await gsCall<{ success: boolean; error?: string; alreadyConfirmed?: boolean }>(
        'confirmAttendance',
        user?.email,
        today,
        token
      );

      if (result.success) {
        setConfirmMessage(
          result.alreadyConfirmed
            ? 'Attendance already confirmed for today!'
            : 'Attendance confirmed successfully!'
        );
        loadAttendanceData();
      } else {
        setConfirmMessage(result.error || 'Failed to confirm attendance');
      }
    } catch (err) {
      setConfirmMessage(err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setConfirming(false);
    }
  };

  const handleTeacherSelect = async () => {
    if (!selectedTeacher) return;

    try {
      const result = await gsCall<{ success: boolean; error?: string }>(
        'setTeacherForAttendanceUser',
        user?.email,
        selectedTeacher
      );

      if (result.success) {
        loadAttendanceData();
      } else {
        setError(result.error || 'Failed to set teacher');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set teacher');
    }
  };

  const getTodayDate = () => new Date().toISOString().split('T')[0];

  const hasConfirmedToday = data?.records.some(
    (r) => r.date === getTodayDate() && r.type === 'confirmed'
  );

  return (
    <div className="page-wrapper">
      <Navigation />

      <main className="main-content">
        <div className="page-header">
          <h1>Student Dashboard</h1>
          <p>Track your attendance and learning progress</p>
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

        {/* Teacher selection */}
        {data?.needsTeacherAssignment && !loading && (
          <div className="teacher-selection">
            <h2>Select Your Teacher</h2>
            <p>Please select your teacher to continue</p>

            {loadingTeachers ? (
              <p>Loading teachers...</p>
            ) : (
              <div className="teacher-form">
                <select
                  value={selectedTeacher}
                  onChange={(e) => setSelectedTeacher(e.target.value)}
                >
                  <option value="">Select a teacher...</option>
                  {teachers.map((t) => (
                    <option key={t.email} value={t.email}>
                      {t.name || t.email}
                    </option>
                  ))}
                </select>
                <button onClick={handleTeacherSelect} disabled={!selectedTeacher}>
                  Confirm Selection
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main content */}
        {data && !data.needsTeacherAssignment && !loading && (
          <div className="attendance-grid">
            {/* Confirm button */}
            <div className="confirm-card">
              <h2>Daily Attendance</h2>
              <p className="date">{new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}</p>

              <button
                onClick={handleConfirmAttendance}
                disabled={confirming || hasConfirmedToday}
                className={`confirm-btn ${hasConfirmedToday ? 'confirmed' : ''}`}
              >
                {hasConfirmedToday
                  ? '✓ Confirmed Today'
                  : confirming
                    ? 'Confirming...'
                    : 'Confirm Attendance'}
              </button>

              {confirmMessage && (
                <p className="confirm-message">{confirmMessage}</p>
              )}
            </div>

            {/* Stats */}
            <div className="stats-card">
              <h2>Your Stats</h2>
              <div className="stats-grid">
                <div className="stat">
                  <span className="stat-value">{data.stats.totalConfirmed}</span>
                  <span className="stat-label">Days Confirmed</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{data.stats.streak}</span>
                  <span className="stat-label">Current Streak</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{data.stats.totalMissed}</span>
                  <span className="stat-label">Days Missed</span>
                </div>
              </div>
            </div>

            {/* Teacher info */}
            {data.user.teacherEmail && (
              <div className="teacher-card">
                <h3>Your Teacher</h3>
                <p>{data.user.teacherEmail}</p>
              </div>
            )}

            {/* Records */}
            <div className="records-card">
              <h2>Attendance History</h2>
              <div className="records-list">
                {data.records.slice(0, 30).map((record, idx) => (
                  <div key={idx} className={`record ${record.type}`}>
                    <span className="record-date">{record.date}</span>
                    <span className={`record-status ${record.type}`}>
                      {record.type === 'confirmed' ? '✓ Confirmed' : '✗ Missed'}
                    </span>
                  </div>
                ))}
                {data.records.length === 0 && (
                  <p className="no-records">No attendance records yet</p>
                )}
              </div>
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
          max-width: 900px;
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

        .teacher-selection {
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 2rem;
          text-align: center;
        }

        .teacher-selection h2 {
          color: #e0e0e0;
          margin: 0 0 0.5rem;
        }

        .teacher-selection p {
          color: #888;
          margin: 0 0 1.5rem;
        }

        .teacher-form {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }

        .teacher-form select {
          padding: 0.75rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: #e0e0e0;
          font-size: 1rem;
          min-width: 200px;
        }

        .teacher-form button {
          padding: 0.75rem 1.5rem;
          background: #00d4ff;
          color: #0f0f1a;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }

        .teacher-form button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .attendance-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .confirm-card {
          grid-column: 1 / -1;
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 2rem;
          text-align: center;
        }

        .confirm-card h2 {
          color: #00d4ff;
          margin: 0 0 0.5rem;
        }

        .confirm-card .date {
          color: #888;
          margin: 0 0 1.5rem;
        }

        .confirm-btn {
          padding: 1rem 3rem;
          font-size: 1.1rem;
          background: linear-gradient(135deg, #44aa44 0%, #338833 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .confirm-btn:hover:not(:disabled) {
          transform: scale(1.02);
        }

        .confirm-btn.confirmed {
          background: rgba(68, 170, 68, 0.3);
          color: #6fcf6f;
          cursor: default;
        }

        .confirm-btn:disabled {
          cursor: not-allowed;
        }

        .confirm-message {
          margin-top: 1rem;
          color: #6fcf6f;
        }

        .stats-card {
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .stats-card h2 {
          color: #00d4ff;
          font-size: 1rem;
          margin: 0 0 1rem;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
        }

        .stat {
          text-align: center;
        }

        .stat-value {
          display: block;
          font-size: 1.75rem;
          font-weight: bold;
          color: #e0e0e0;
        }

        .stat-label {
          font-size: 0.8rem;
          color: #888;
        }

        .teacher-card {
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .teacher-card h3 {
          color: #888;
          font-size: 0.9rem;
          margin: 0 0 0.5rem;
        }

        .teacher-card p {
          color: #e0e0e0;
          margin: 0;
        }

        .records-card {
          grid-column: 1 / -1;
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .records-card h2 {
          color: #00d4ff;
          font-size: 1rem;
          margin: 0 0 1rem;
        }

        .records-list {
          max-height: 300px;
          overflow-y: auto;
        }

        .record {
          display: flex;
          justify-content: space-between;
          padding: 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .record:last-child {
          border-bottom: none;
        }

        .record-date {
          color: #e0e0e0;
        }

        .record-status.confirmed {
          color: #6fcf6f;
        }

        .record-status.missed {
          color: #ff6b6b;
        }

        .no-records {
          color: #888;
          text-align: center;
          padding: 2rem;
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
