'use client';

/**
 * Dashboard / Home Page
 *
 * Carbon copy of legacy home.html:
 * - Dark navy gradient background
 * - White frosted container with border-radius: 28px
 * - Welcome section with avatar, name, email
 * - 3 nav cards: Commission, Teacher (with badge), Student
 * - Hover effects with red/pink gradient overlay
 * - Logout button
 */

import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useSession } from '@/hooks/useSession';
import { LoadingOverlay } from '@/components/LoadingSkeleton';
import { gs, getStoredToken } from '@/lib/client/gs-compat';

function DashboardContent() {
  const router = useRouter();
  const { user, logout, isLoading } = useSession();

  if (isLoading) {
    return <LoadingOverlay message="Loading your dashboard..." />;
  }

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const handleNavigation = async (page: string, href: string) => {
    const token = getStoredToken();
    if (!token) {
      router.push(href);
      return;
    }

    try {
      const result = await gs.checkPortalAccess(token, page);
      if (result.hasAccess) {
        router.push(href);
      } else {
        if (result.reason === 'not_teacher') {
          alert('Access denied: You must be a registered teacher to access the Teacher Portal.');
        } else if (result.reason === 'not_logged_in') {
          alert('Session expired. Please log in again.');
          router.push('/login');
        } else {
          alert('Access denied to this portal.');
        }
      }
    } catch {
      // Try anyway on error
      router.push(href);
    }
  };

  const firstName = user?.name ? user.name.split(' ')[0] : 'User';
  const initial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  const isTeacherOrAdmin = user?.isTeacher || user?.isAdmin;

  return (
    <div className="page-bg">
      <div className="home-container">
        {/* Header bar */}
        <div className="header-bar">
          <div className="welcome-section">
            <div className="user-avatar">{initial}</div>
            <div className="welcome-text">
              <h2>Welcome, {firstName}!</h2>
              <p>{user?.displayEmail || user?.email}</p>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <svg viewBox="0 0 24 24">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
            </svg>
            Sign Out
          </button>
        </div>

        {/* Logo section */}
        <div className="logo-section">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V7.89l7-3.11v8.2z" />
            </svg>
          </div>
          <h1>Traders Utopia Portal</h1>
          <p className="subtitle">Select a portal to continue</p>
          <p className="version">v5.0 - Single Sign-On Edition</p>
        </div>

        {/* Navigation grid */}
        <div className="nav-grid">
          {/* Commission Lookup */}
          <div
            className="nav-card"
            onClick={() => handleNavigation('commission', '/commission')}
            tabIndex={0}
            role="button"
          >
            <div className="nav-card-content">
              <div className="nav-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" />
                </svg>
              </div>
              <div className="nav-title">Commission Lookup</div>
              <div className="nav-description">View affiliate commissions, payouts, and detailed financial reports</div>
            </div>
          </div>

          {/* Teacher Portal */}
          <div
            className={`nav-card teacher-only ${!isTeacherOrAdmin ? 'disabled' : ''}`}
            onClick={() => isTeacherOrAdmin && handleNavigation('teacher', '/teacher')}
            tabIndex={0}
            role="button"
          >
            <span className="teacher-badge">
              {isTeacherOrAdmin ? 'Teachers Only' : 'No Access'}
            </span>
            <div className="nav-card-content">
              <div className="nav-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z" />
                </svg>
              </div>
              <div className="nav-title">Teacher Portal</div>
              <div className="nav-description">Manage courses, student progress, and educational resources</div>
            </div>
          </div>

          {/* Student Dashboard */}
          <div
            className="nav-card"
            onClick={() => handleNavigation('attendance', '/student')}
            tabIndex={0}
            role="button"
          >
            <div className="nav-card-content">
              <div className="nav-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
                </svg>
              </div>
              <div className="nav-title">Student Dashboard</div>
              <div className="nav-description">Track attendance, view referrals, and monitor your progress</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          <p className="footer-text">&copy; {new Date().getFullYear()} Traders Utopia. All rights reserved.</p>
        </div>
      </div>

      <style jsx>{`
        .page-bg {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
          padding: 20px;
          overflow-x: hidden;
        }

        .home-container {
          width: 100%;
          max-width: 1000px;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 28px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
          padding: 48px 40px;
          animation: fadeIn 0.6s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 32px;
          padding-bottom: 24px;
          border-bottom: 2px solid #e2e8f0;
          flex-wrap: wrap;
          gap: 16px;
        }

        .welcome-section {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .user-avatar {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 24px;
          font-weight: 700;
          box-shadow: 0 8px 24px rgba(233, 69, 96, 0.3);
        }

        .welcome-text h2 {
          font-size: 24px;
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 4px;
        }

        .welcome-text p {
          font-size: 14px;
          color: #64748b;
          margin: 0;
        }

        .logout-btn {
          background: linear-gradient(135deg, #64748b 0%, #475569 100%);
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: inherit;
        }

        .logout-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
          background: linear-gradient(135deg, #475569 0%, #334155 100%);
        }

        .logout-btn svg {
          width: 18px;
          height: 18px;
          fill: white;
        }

        .logo-section {
          text-align: center;
          margin-bottom: 40px;
        }

        .logo-icon {
          width: 80px;
          height: 80px;
          margin: 0 auto 20px;
          background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%);
          border-radius: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 40px rgba(233, 69, 96, 0.35);
        }

        .logo-icon svg {
          width: 45px;
          height: 45px;
          fill: white;
        }

        h1 {
          font-size: 38px;
          font-weight: 700;
          background: linear-gradient(135deg, #1e293b 0%, #475569 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 12px;
          letter-spacing: -0.5px;
        }

        .subtitle {
          font-size: 17px;
          color: #64748b;
          font-weight: 400;
          margin: 0;
        }

        .version {
          font-size: 12px;
          color: #94a3b8;
          font-weight: 500;
          margin-top: 8px;
        }

        .nav-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 24px;
          margin-top: 32px;
        }

        .nav-card {
          background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          border: 2px solid #e2e8f0;
          border-radius: 20px;
          padding: 36px 28px;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }

        .nav-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%);
          opacity: 0;
          transition: opacity 0.3s ease;
          z-index: 0;
        }

        .nav-card:hover:not(.disabled) {
          transform: translateY(-8px);
          box-shadow: 0 20px 50px rgba(233, 69, 96, 0.25);
          border-color: #e94560;
        }

        .nav-card:hover:not(.disabled)::before {
          opacity: 1;
        }

        .nav-card:active:not(.disabled) {
          transform: translateY(-4px);
        }

        .nav-card:focus {
          outline: 3px solid #e94560;
          outline-offset: 4px;
        }

        .nav-card.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }

        .nav-card-content {
          position: relative;
          z-index: 1;
        }

        .nav-card:hover:not(.disabled) .nav-card-content {
          color: white;
        }

        .nav-icon {
          width: 64px;
          height: 64px;
          margin: 0 auto 20px;
          background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%);
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
          box-shadow: 0 8px 24px rgba(233, 69, 96, 0.25);
        }

        .nav-card:hover:not(.disabled) .nav-icon {
          background: white;
          transform: scale(1.1) rotate(5deg);
        }

        .nav-icon svg {
          width: 36px;
          height: 36px;
          fill: white;
          transition: fill 0.3s ease;
        }

        .nav-card:hover:not(.disabled) .nav-icon svg {
          fill: #e94560;
        }

        .nav-title {
          font-size: 22px;
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 10px;
          transition: color 0.3s ease;
        }

        .nav-card:hover:not(.disabled) .nav-title {
          color: white;
        }

        .nav-description {
          font-size: 14px;
          color: #64748b;
          line-height: 1.6;
          transition: color 0.3s ease;
        }

        .nav-card:hover:not(.disabled) .nav-description {
          color: rgba(255, 255, 255, 0.9);
        }

        .teacher-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          font-size: 10px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 20px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          z-index: 2;
        }

        .footer {
          text-align: center;
          margin-top: 48px;
          padding-top: 24px;
          border-top: 1px solid #e2e8f0;
        }

        .footer-text {
          font-size: 14px;
          color: #94a3b8;
          margin: 0;
        }

        @media (max-width: 768px) {
          .home-container {
            padding: 32px 20px;
          }

          .header-bar {
            flex-direction: column;
            align-items: stretch;
            text-align: center;
          }

          .welcome-section {
            justify-content: center;
          }

          .logout-btn {
            width: 100%;
            justify-content: center;
          }

          h1 {
            font-size: 28px;
          }

          .subtitle {
            font-size: 15px;
          }

          .nav-grid {
            grid-template-columns: 1fr;
            gap: 20px;
          }

          .nav-card {
            padding: 28px 20px;
          }
        }
      `}</style>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
