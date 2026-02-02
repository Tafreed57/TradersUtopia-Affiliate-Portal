'use client';

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors in child components and displays a fallback UI.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }

    // TODO: Log to error reporting service (e.g., Sentry)
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="error-content">
            <h2>Something went wrong</h2>
            <p>We&apos;re sorry, but something unexpected happened.</p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-details">
                <summary>Error Details</summary>
                <pre>{this.state.error.toString()}</pre>
                {this.state.errorInfo && (
                  <pre>{this.state.errorInfo.componentStack}</pre>
                )}
              </details>
            )}

            <div className="error-actions">
              <button onClick={this.handleReset} className="btn-retry">
                Try Again
              </button>
              <button onClick={() => window.location.reload()} className="btn-reload">
                Reload Page
              </button>
            </div>
          </div>

          <style jsx>{`
            .error-boundary {
              min-height: 400px;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 2rem;
              background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
            }

            .error-content {
              text-align: center;
              max-width: 500px;
              background: rgba(26, 26, 46, 0.9);
              border: 1px solid rgba(255, 107, 107, 0.3);
              border-radius: 12px;
              padding: 2rem;
            }

            h2 {
              color: #ff6b6b;
              margin: 0 0 0.5rem;
            }

            p {
              color: #a0a0a0;
              margin: 0 0 1.5rem;
            }

            .error-details {
              text-align: left;
              background: rgba(0, 0, 0, 0.3);
              border-radius: 6px;
              padding: 1rem;
              margin-bottom: 1.5rem;
            }

            .error-details summary {
              color: #888;
              cursor: pointer;
              margin-bottom: 0.5rem;
            }

            .error-details pre {
              color: #ff6b6b;
              font-size: 0.8rem;
              overflow-x: auto;
              white-space: pre-wrap;
              word-break: break-word;
            }

            .error-actions {
              display: flex;
              gap: 1rem;
              justify-content: center;
            }

            .btn-retry,
            .btn-reload {
              padding: 0.75rem 1.5rem;
              border-radius: 6px;
              font-size: 0.9rem;
              cursor: pointer;
              transition: all 0.2s;
            }

            .btn-retry {
              background: #00d4ff;
              color: #0f0f1a;
              border: none;
            }

            .btn-retry:hover {
              background: #00e5ff;
            }

            .btn-reload {
              background: transparent;
              color: #a0a0a0;
              border: 1px solid rgba(255, 255, 255, 0.2);
            }

            .btn-reload:hover {
              border-color: rgba(255, 255, 255, 0.4);
              color: #e0e0e0;
            }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
