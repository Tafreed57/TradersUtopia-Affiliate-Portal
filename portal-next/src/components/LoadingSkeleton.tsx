'use client';

/**
 * Loading Components
 *
 * Legacy-matching loading overlays and skeleton placeholders.
 */

import React from 'react';

/**
 * Full-screen loading overlay matching the legacy GAS portal style.
 * Used during session checks and page transitions.
 */
export function LoadingOverlay({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <div className="loading-spinner" />
        <p>{message}</p>
      </div>
    </div>
  );
}

/**
 * Access Denied overlay for restricted pages (e.g., teacher portal for non-teachers).
 */
export function AccessDeniedOverlay({ message = 'Access Denied' }: { message?: string }) {
  return (
    <div className="access-denied-overlay">
      <div className="access-denied-content">
        <div className="access-denied-icon">
          <svg viewBox="0 0 24 24" width="64" height="64">
            <path
              d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"
              fill="rgba(255,255,255,0.5)"
            />
          </svg>
        </div>
        <h2>{message}</h2>
        <p>You do not have permission to view this page.</p>
      </div>
      <style jsx>{`
        .access-denied-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }

        .access-denied-content {
          text-align: center;
          color: white;
        }

        .access-denied-icon {
          margin-bottom: 24px;
        }

        h2 {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 12px;
          color: #ef4444;
        }

        p {
          color: rgba(255, 255, 255, 0.6);
          font-size: 16px;
        }
      `}</style>
    </div>
  );
}

/**
 * Inline loading spinner (matches legacy button spinner).
 */
export function LoadingSpinner({ size = 40, color = '#e94560' }: { size?: number; color?: string }) {
  return (
    <div className="spinner-container">
      <div
        className="spinner"
        style={{
          width: size,
          height: size,
          borderTopColor: color,
        }}
      />
      <style jsx>{`
        .spinner-container {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }

        .spinner {
          border: 4px solid rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
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

/**
 * Skeleton shimmer placeholder
 */
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  borderRadius = '8px',
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
      }}
    >
      <style jsx>{`
        .skeleton {
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.05) 25%,
            rgba(255, 255, 255, 0.1) 50%,
            rgba(255, 255, 255, 0.05) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }

        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card-skeleton">
      <Skeleton height={60} borderRadius={12} />
      <div style={{ padding: '1rem' }}>
        <Skeleton width="60%" height={20} />
        <div style={{ height: '0.5rem' }} />
        <Skeleton width="80%" height={16} />
        <div style={{ height: '0.5rem' }} />
        <Skeleton width="40%" height={16} />
      </div>
      <style jsx>{`
        .card-skeleton {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="table-row-skeleton">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} width={`${100 / columns - 2}%`} height={16} />
      ))}
      <style jsx>{`
        .table-row-skeleton {
          display: flex;
          gap: 1rem;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
      `}</style>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="form-skeleton">
      <Skeleton width="30%" height={14} />
      <div style={{ height: '0.5rem' }} />
      <Skeleton height={40} borderRadius={10} />
      <div style={{ height: '1rem' }} />
      <Skeleton width="30%" height={14} />
      <div style={{ height: '0.5rem' }} />
      <Skeleton height={40} borderRadius={10} />
      <div style={{ height: '1.5rem' }} />
      <Skeleton height={48} borderRadius={14} />
      <style jsx>{`
        .form-skeleton {
          padding: 1.5rem;
        }
      `}</style>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <LoadingOverlay message="Loading your dashboard..." />
  );
}

export default {
  LoadingOverlay,
  AccessDeniedOverlay,
  LoadingSpinner,
  Skeleton,
  CardSkeleton,
  TableRowSkeleton,
  FormSkeleton,
  PageSkeleton,
};
