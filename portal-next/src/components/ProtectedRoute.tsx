'use client';

/**
 * ProtectedRoute Component
 *
 * Wraps pages that require authentication.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/useSession';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireTeacher?: boolean;
  requireAdmin?: boolean;
}

export function ProtectedRoute({
  children,
  requireTeacher = false,
  requireAdmin = false,
}: ProtectedRouteProps) {
  const router = useRouter();
  const { user, isLoading, isAuthenticated } = useSession();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    if (requireAdmin && !user?.isAdmin) {
      router.push('/dashboard');
      return;
    }

    if (requireTeacher && !user?.isTeacher && !user?.isAdmin) {
      router.push('/dashboard');
      return;
    }
  }, [isLoading, isAuthenticated, user, requireTeacher, requireAdmin, router]);

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
        <style jsx>{`
          .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 50vh;
            color: #e0e0e0;
          }

          .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(0, 212, 255, 0.2);
            border-top-color: #00d4ff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 1rem;
          }

          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (requireAdmin && !user?.isAdmin) {
    return null;
  }

  if (requireTeacher && !user?.isTeacher && !user?.isAdmin) {
    return null;
  }

  return <>{children}</>;
}

export default ProtectedRoute;
