'use client';

/**
 * Page Header Component
 *
 * Legacy-matching per-page header with "Back to Dashboard" + "Sign Out" buttons.
 * Each page uses this instead of a persistent navbar.
 */

import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/useSession';

interface NavigationProps {
  title?: string;
  /** Use light text on dark backgrounds (login, home) or dark text on light/white backgrounds */
  variant?: 'dark-bg' | 'light-bg';
  /** Hide the back button (used on dashboard itself) */
  hideBack?: boolean;
}

export function Navigation({ title, variant = 'dark-bg', hideBack = false }: NavigationProps) {
  const router = useRouter();
  const { user, logout, isLoading } = useSession();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const handleBack = () => {
    router.push('/dashboard');
  };

  if (isLoading) return null;

  const isDark = variant === 'dark-bg';

  return (
    <div className="page-header">
      <div className="header-left">
        {!hideBack && (
          <button onClick={handleBack} className="header-btn back-btn">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
            Back to Dashboard
          </button>
        )}
        {title && <h1 className="header-title">{title}</h1>}
      </div>

      <div className="header-right">
        {user && (
          <span className="user-info">
            {user.name || user.email}
            {user.isAdmin && <span className="role-badge admin">Admin</span>}
            {user.isTeacher && !user.isAdmin && <span className="role-badge teacher">Teacher</span>}
          </span>
        )}
        <button onClick={handleLogout} className="header-btn logout-btn">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
          Sign Out
        </button>
      </div>

      <style jsx>{`
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 0;
          overflow: hidden;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          flex-shrink: 1;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex-shrink: 1;
        }

        .header-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: ${isDark ? '#ffffff' : '#1e293b'};
          margin: 0;
          white-space: nowrap;
        }

        .header-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border: none;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          font-family: inherit;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .back-btn {
          background: ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)'};
          color: ${isDark ? 'rgba(255, 255, 255, 0.8)' : '#475569'};
        }

        .back-btn:hover {
          background: ${isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)'};
          transform: translateY(-1px);
        }

        .back-btn svg {
          fill: ${isDark ? 'rgba(255, 255, 255, 0.8)' : '#475569'};
        }

        .logout-btn {
          background: linear-gradient(135deg, #64748b 0%, #475569 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .logout-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
          background: linear-gradient(135deg, #475569 0%, #334155 100%);
        }

        .logout-btn svg {
          fill: white;
        }

        .user-info {
          font-size: 13px;
          color: ${isDark ? 'rgba(255, 255, 255, 0.6)' : '#64748b'};
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 220px;
        }

        .role-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 20px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .role-badge.admin {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
        }

        .role-badge.teacher {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
        }

        @media (max-width: 768px) {
          .page-header {
            flex-direction: column;
            align-items: stretch;
            text-align: center;
          }

          .header-left,
          .header-right {
            justify-content: center;
          }

          .user-info {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

export default Navigation;
