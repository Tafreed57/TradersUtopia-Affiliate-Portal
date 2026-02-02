'use client';

/**
 * Navigation Component
 *
 * Main navigation bar for the portal.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/hooks/useSession';

interface NavItem {
  href: string;
  label: string;
  requiresAuth?: boolean;
  requiresTeacher?: boolean;
  requiresAdmin?: boolean;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Home', requiresAuth: true },
  { href: '/commission', label: 'Commission Lookup', requiresAuth: true },
  { href: '/teacher', label: 'Teacher Portal', requiresAuth: true, requiresTeacher: true },
  { href: '/student', label: 'Student Dashboard', requiresAuth: true },
];

export function Navigation() {
  const pathname = usePathname();
  const { user, isAuthenticated, logout, isLoading } = useSession();

  // Filter nav items based on user roles
  const visibleItems = navItems.filter((item) => {
    if (item.requiresAuth && !isAuthenticated) return false;
    if (item.requiresTeacher && !user?.isTeacher && !user?.isAdmin) return false;
    if (item.requiresAdmin && !user?.isAdmin) return false;
    return true;
  });

  return (
    <nav className="nav-container">
      <div className="nav-brand">
        <Link href={isAuthenticated ? '/dashboard' : '/login'}>
          TradersUtopia Portal
        </Link>
      </div>

      {!isLoading && (
        <div className="nav-links">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link ${pathname === item.href ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}

          {isAuthenticated ? (
            <div className="nav-user">
              <span className="nav-user-name">{user?.name || user?.email}</span>
              {user?.isAdmin && <span className="badge badge-admin">Admin</span>}
              {user?.isTeacher && !user?.isAdmin && (
                <span className="badge badge-teacher">Teacher</span>
              )}
              <button onClick={logout} className="btn btn-logout">
                Logout
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn btn-primary">
              Login
            </Link>
          )}
        </div>
      )}

      <style jsx>{`
        .nav-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 2rem;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        }

        .nav-brand a {
          color: #00d4ff;
          font-size: 1.5rem;
          font-weight: bold;
          text-decoration: none;
        }

        .nav-links {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .nav-link {
          color: #e0e0e0;
          text-decoration: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .nav-link:hover {
          color: #00d4ff;
          background: rgba(0, 212, 255, 0.1);
        }

        .nav-link.active {
          color: #00d4ff;
          background: rgba(0, 212, 255, 0.15);
        }

        .nav-user {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding-left: 1rem;
          border-left: 1px solid rgba(255, 255, 255, 0.1);
        }

        .nav-user-name {
          color: #e0e0e0;
          font-size: 0.9rem;
        }

        .badge {
          font-size: 0.7rem;
          padding: 0.2rem 0.5rem;
          border-radius: 3px;
          text-transform: uppercase;
        }

        .badge-admin {
          background: #ff4444;
          color: white;
        }

        .badge-teacher {
          background: #44aa44;
          color: white;
        }

        .btn {
          padding: 0.5rem 1rem;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #00d4ff;
          color: #1a1a2e;
        }

        .btn-primary:hover {
          background: #00b8e0;
        }

        .btn-logout {
          background: transparent;
          color: #ff6b6b;
          border: 1px solid #ff6b6b;
        }

        .btn-logout:hover {
          background: rgba(255, 107, 107, 0.1);
        }
      `}</style>
    </nav>
  );
}

export default Navigation;
