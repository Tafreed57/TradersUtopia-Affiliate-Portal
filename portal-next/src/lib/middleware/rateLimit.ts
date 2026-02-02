/**
 * Rate Limiting Middleware
 *
 * Implements sliding window rate limiting for API endpoints.
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string;
}

// In-memory store for rate limiting (use Redis in production for multi-instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

/**
 * Get client identifier for rate limiting
 */
function getClientId(request: NextRequest): string {
  // Try to get real IP from headers (for proxied requests)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  // Fallback to a hash of user-agent + some identifier
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `ua:${userAgent.slice(0, 50)}`;
}

/**
 * Check rate limit for a request
 */
export function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const clientId = getClientId(request);
  const key = `ratelimit:${clientId}`;
  const now = Date.now();

  let record = rateLimitStore.get(key);

  // Create new record if none exists or window expired
  if (!record || record.resetAt < now) {
    record = {
      count: 0,
      resetAt: now + config.windowMs,
    };
  }

  // Check if limit exceeded
  if (record.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: record.resetAt,
    };
  }

  // Increment count
  record.count++;
  rateLimitStore.set(key, record);

  return {
    allowed: true,
    remaining: config.maxRequests - record.count,
    resetAt: record.resetAt,
  };
}

/**
 * Create rate limit response headers
 */
export function rateLimitHeaders(
  remaining: number,
  resetAt: number,
  limit: number
): Headers {
  const headers = new Headers();
  headers.set('X-RateLimit-Limit', String(limit));
  headers.set('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  headers.set('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
  return headers;
}

/**
 * Rate limit response when limit exceeded
 */
export function rateLimitExceeded(
  remaining: number,
  resetAt: number,
  limit: number,
  message?: string
): NextResponse {
  const headers = rateLimitHeaders(remaining, resetAt, limit);
  headers.set('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)));

  return NextResponse.json(
    {
      success: false,
      error: message || 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
    },
    {
      status: 429,
      headers,
    }
  );
}

/**
 * Default rate limit configurations
 */
export const rateLimitConfigs = {
  // Standard API endpoints
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60, // 60 requests per minute
    message: 'Too many API requests. Please slow down.',
  },

  // Login attempts (more restrictive)
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10, // 10 attempts per 15 minutes
    message: 'Too many login attempts. Please wait before trying again.',
  },

  // Password reset (very restrictive)
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3, // 3 requests per hour
    message: 'Too many password reset attempts. Please wait an hour.',
  },

  // Rewardful API calls (match their rate limits)
  rewardful: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute
    message: 'API rate limit reached. Please wait a moment.',
  },
};

export type RateLimitType = keyof typeof rateLimitConfigs;
