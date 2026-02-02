'use client';

/**
 * Loading Skeleton Components
 *
 * Provides loading placeholder UI for various content types.
 */

import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  borderRadius = '4px',
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
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
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
          background: rgba(26, 26, 46, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
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
      <Skeleton height={40} borderRadius={6} />
      <div style={{ height: '1rem' }} />
      <Skeleton width="30%" height={14} />
      <div style={{ height: '0.5rem' }} />
      <Skeleton height={40} borderRadius={6} />
      <div style={{ height: '1.5rem' }} />
      <Skeleton height={44} borderRadius={6} />
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
    <div className="page-skeleton">
      <div className="header">
        <Skeleton width={200} height={32} />
        <div style={{ height: '0.5rem' }} />
        <Skeleton width={300} height={16} />
      </div>
      <div className="content">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <style jsx>{`
        .page-skeleton {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
          padding: 2rem;
        }

        .header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .content {
          max-width: 1000px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }
      `}</style>
    </div>
  );
}

export function LoadingSpinner({ size = 40 }: { size?: number }) {
  return (
    <div className="spinner-container">
      <div
        className="spinner"
        style={{
          width: size,
          height: size,
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
          border: 3px solid rgba(0, 212, 255, 0.2);
          border-top-color: #00d4ff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
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

export default {
  Skeleton,
  CardSkeleton,
  TableRowSkeleton,
  FormSkeleton,
  PageSkeleton,
  LoadingSpinner,
};
