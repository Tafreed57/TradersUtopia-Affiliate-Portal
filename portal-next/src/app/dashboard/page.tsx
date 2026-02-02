'use client';

/**
 * Dashboard Page
 *
 * Main landing page after login. Shows navigation to different portals.
 */

import Link from 'next/link';
import { Navigation } from '@/components/Navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useSession } from '@/hooks/useSession';

function DashboardContent() {
  const { user } = useSession();

  const portals = [
    {
      title: 'Commission Lookup',
      description: 'View your affiliate commission earnings, pending payouts, and historical data.',
      href: '/commission',
      icon: '💰',
      color: '#00d4ff',
    },
    {
      title: 'Student Dashboard',
      description: 'Track your attendance, view your learning progress, and manage your profile.',
      href: '/student',
      icon: '📚',
      color: '#44aa44',
    },
    ...(user?.isTeacher || user?.isAdmin
      ? [
          {
            title: 'Teacher Portal',
            description: 'Manage your students, track their progress, and view your earnings.',
            href: '/teacher',
            icon: '👨‍🏫',
            color: '#ff9900',
          },
        ]
      : []),
    ...(user?.isAdmin
      ? [
          {
            title: 'Admin Panel',
            description: 'Manage pending account requests, approve users, and system administration.',
            href: '/admin',
            icon: '⚙️',
            color: '#ff4444',
          },
        ]
      : []),
  ];

  return (
    <div className="page-wrapper">
      <Navigation />

      <main className="main-content">
        <div className="welcome-section">
          <h1>Welcome back, {user?.name || user?.email}!</h1>
          <p>Choose a portal to get started</p>
        </div>

        <div className="portals-grid">
          {portals.map((portal) => (
            <Link key={portal.href} href={portal.href} className="portal-card">
              <div className="portal-icon" style={{ background: portal.color }}>
                {portal.icon}
              </div>
              <div className="portal-content">
                <h2>{portal.title}</h2>
                <p>{portal.description}</p>
              </div>
              <div className="portal-arrow">→</div>
            </Link>
          ))}
        </div>

        <div className="quick-info">
          <div className="info-card">
            <h3>Account Info</h3>
            <dl>
              <dt>Email</dt>
              <dd>{user?.email}</dd>
              <dt>Display Name</dt>
              <dd>{user?.name || 'Not set'}</dd>
              <dt>Role</dt>
              <dd>
                {user?.isAdmin ? 'Administrator' : user?.isTeacher ? 'Teacher' : 'Affiliate'}
              </dd>
            </dl>
          </div>
        </div>
      </main>

      <style jsx>{`
        .page-wrapper {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
        }

        .main-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        .welcome-section {
          text-align: center;
          margin-bottom: 3rem;
        }

        .welcome-section h1 {
          color: #e0e0e0;
          font-size: 2rem;
          margin: 0 0 0.5rem;
        }

        .welcome-section p {
          color: #888;
          margin: 0;
        }

        .portals-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
          margin-bottom: 3rem;
        }

        .portal-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          background: rgba(26, 26, 46, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
          text-decoration: none;
          transition: all 0.2s;
        }

        .portal-card:hover {
          background: rgba(26, 26, 46, 0.95);
          border-color: rgba(0, 212, 255, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }

        .portal-icon {
          width: 60px;
          height: 60px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .portal-content {
          flex: 1;
        }

        .portal-content h2 {
          color: #e0e0e0;
          font-size: 1.1rem;
          margin: 0 0 0.5rem;
        }

        .portal-content p {
          color: #888;
          font-size: 0.85rem;
          margin: 0;
          line-height: 1.4;
        }

        .portal-arrow {
          color: #00d4ff;
          font-size: 1.5rem;
          opacity: 0;
          transform: translateX(-10px);
          transition: all 0.2s;
        }

        .portal-card:hover .portal-arrow {
          opacity: 1;
          transform: translateX(0);
        }

        .quick-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1.5rem;
        }

        .info-card {
          background: rgba(26, 26, 46, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .info-card h3 {
          color: #00d4ff;
          font-size: 1rem;
          margin: 0 0 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .info-card dl {
          margin: 0;
        }

        .info-card dt {
          color: #888;
          font-size: 0.8rem;
          margin-top: 0.75rem;
        }

        .info-card dd {
          color: #e0e0e0;
          margin: 0.25rem 0 0;
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
