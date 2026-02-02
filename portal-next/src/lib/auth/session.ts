/**
 * Session Management
 *
 * Handles JWT-based sessions compatible with the legacy system.
 * Sessions are stored in the database with JWT tokens for stateless validation.
 */

import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { config } from '../config';
import { generateToken } from '../utils';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionPayload extends JWTPayload {
  userId: string;
  email: string;
  aliasEmail: string;
  rewardfulEmail?: string;
  isTeacher: boolean;
  isAdmin: boolean;
  userName?: string;
}

export interface SessionData {
  token: string;
  userId: string;
  email: string;
  aliasEmail: string;
  rewardfulEmail?: string;
  isTeacher: boolean;
  isAdmin: boolean;
  userName?: string;
  expiresAt: Date;
  createdAt: Date;
}

// ============================================================================
// TOKEN GENERATION
// ============================================================================

/**
 * Get the secret key for JWT operations
 */
function getSecretKey(): Uint8Array {
  const secret = config.auth.jwtSecret;
  return new TextEncoder().encode(secret);
}

/**
 * Generate session expiry timestamp
 */
export function getSessionExpiry(): Date {
  const hours = config.auth.sessionDurationHours;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Create a new session token (JWT)
 */
export async function createSessionToken(
  payload: Omit<SessionPayload, 'iat' | 'exp'>
): Promise<string> {
  const expiresAt = getSessionExpiry();

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecretKey());

  return token;
}

/**
 * Verify and decode a session token
 */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Generate a legacy-compatible session token
 * (64 chars + underscore + timestamp, matching GAS format)
 */
export function generateLegacySessionToken(): string {
  return generateToken(config.auth.sessionTokenLength);
}

// ============================================================================
// SESSION HELPERS
// ============================================================================

/**
 * Build session data object from user info
 */
export function buildSessionData(
  userId: string,
  email: string,
  options: {
    aliasEmail?: string;
    rewardfulEmail?: string;
    isTeacher?: boolean;
    isAdmin?: boolean;
    userName?: string;
  } = {}
): Omit<SessionData, 'token' | 'createdAt'> {
  return {
    userId,
    email,
    aliasEmail: options.aliasEmail || email,
    rewardfulEmail: options.rewardfulEmail,
    isTeacher: options.isTeacher || false,
    isAdmin: options.isAdmin || false,
    userName: options.userName,
    expiresAt: getSessionExpiry(),
  };
}

/**
 * Check if a session is expired
 */
export function isSessionExpired(expiresAt: Date | number): boolean {
  const expiry = typeof expiresAt === 'number' ? expiresAt : expiresAt.getTime();
  return Date.now() > expiry;
}

/**
 * Extract session token from Authorization header or cookie
 */
export function extractTokenFromRequest(
  authHeader?: string | null,
  cookieValue?: string | null
): string | null {
  // Try Authorization header first (Bearer token)
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Fall back to cookie
  if (cookieValue) {
    return cookieValue;
  }

  return null;
}
