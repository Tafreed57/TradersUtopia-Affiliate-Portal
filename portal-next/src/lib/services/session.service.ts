/**
 * Session Service
 *
 * Handles session creation, validation, and management.
 * Maps to legacy SESSION_* functions.
 */

import { prisma } from '@/lib/db';
import { config, isAdminEmail, normalizeEmail, isTeacherOverrideEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import {
  createSessionToken,
  verifySessionToken,
  getSessionExpiry,
  type SessionPayload,
} from '@/lib/auth/session';
import { verifyAffiliatePassword } from './auth.service';
import type { SessionValidationResult, ApiResponse, SessionUser, PortalType } from '@/types';

const log = logger.child({ service: 'session' });

// ============================================================================
// SESSION VALIDATION
// ============================================================================

/**
 * Validate session token
 * Legacy: validateSessionToken(token)
 */
export async function validateSessionToken(
  token: string
): Promise<SessionValidationResult> {
  if (!token) {
    return { valid: false };
  }

  try {
    // Verify JWT
    const payload = await verifySessionToken(token);
    if (!payload) {
      return { valid: false };
    }

    // Check if session exists in database
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session) {
      return { valid: false };
    }

    // Check expiration
    if (session.expiresAt < new Date()) {
      // Clean up expired session
      await prisma.session.delete({ where: { id: session.id } });
      return { valid: false };
    }

    // Update last seen
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return {
      valid: true,
      user: {
        email: session.user.aliasEmail,
        displayEmail: session.user.aliasEmail,
        canonicalEmail: session.user.email,
        name: [session.user.firstName, session.user.lastName]
          .filter(Boolean)
          .join(' ') || session.user.aliasEmail,
        isTeacher: session.user.isTeacher,
        isAdmin: session.user.isAdmin,
      },
      expiresAt: session.expiresAt.getTime(),
    };
  } catch (error) {
    log.error('Session validation error', { error });
    return { valid: false };
  }
}

/**
 * Create a new session
 * Legacy: createSession(email)
 */
export async function createSession(aliasEmail: string): Promise<ApiResponse & {
  token?: string;
  expiresAt?: number;
  user?: SessionUser;
}> {
  const email = normalizeEmail(aliasEmail);

  if (!email) {
    return { success: false, error: 'Invalid email' };
  }

  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { aliasEmail: email },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Live teacher check via Rewardful (matches legacy getUserInfoForSession_ behavior)
    let isTeacher = user.isTeacher;
    const isAdmin = user.isAdmin || isAdminEmail(email);

    // Admins are always teachers (legacy behavior)
    if (isAdmin) {
      isTeacher = true;
    }

    // Check teacher override list
    if (!isTeacher && isTeacherOverrideEmail(email)) {
      isTeacher = true;
    }

    // Check Rewardful first_name for "teacher" (live, like legacy)
    if (!isTeacher) {
      try {
        const { verifyTeacherAccess } = await import('@/lib/services/teacher.service');
        log.info('Running live teacher check for', { email, internalEmail: user.internalEmail });
        const teacherCheck = await verifyTeacherAccess(email);
        log.info('Teacher check result', { email, hasAccess: teacherCheck.hasAccess, reason: teacherCheck.reason });
        if (teacherCheck.hasAccess) {
          isTeacher = true;
        }
      } catch (err) {
        log.error('Teacher check FAILED — falling back to DB value', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Update DB if teacher status changed
    if (isTeacher !== user.isTeacher || isAdmin !== user.isAdmin) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isTeacher, isAdmin },
      });
    }

    // Build session payload
    const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.aliasEmail,
      aliasEmail: user.aliasEmail,
      rewardfulEmail: user.internalEmail || undefined,
      isTeacher,
      isAdmin,
      userName: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
    };

    // Create JWT token
    const token = await createSessionToken(payload);
    const expiresAt = getSessionExpiry();

    // Store session in database
    await prisma.session.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    log.info('Session created', { email });

    return {
      success: true,
      token,
      expiresAt: expiresAt.getTime(),
      user: {
        email: user.aliasEmail,
        displayEmail: user.aliasEmail,
        rewardfulEmail: user.internalEmail || undefined,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.aliasEmail,
        isTeacher,
        isAdmin,
      },
    };
  } catch (error) {
    log.error('Session creation error', { error });
    return { success: false, error: 'Failed to create session' };
  }
}

/**
 * Login and create session (full flow)
 * Legacy: loginAndCreateSession(email, password)
 */
export async function loginAndCreateSession(
  email: string,
  password: string
): Promise<ApiResponse & {
  token?: string;
  expiresAt?: number;
  user?: SessionUser;
}> {
  // Verify password first
  const verifyResult = await verifyAffiliatePassword(email, password);

  if (!verifyResult.success) {
    return verifyResult;
  }

  // Create session
  const sessionResult = await createSession(email);

  if (!sessionResult.success) {
    return { success: false, error: 'Failed to create session' };
  }

  return {
    success: true,
    token: sessionResult.token,
    expiresAt: sessionResult.expiresAt,
    user: sessionResult.user,
    message: 'Login successful',
  };
}

/**
 * Logout - invalidate session
 * Legacy: logoutSession(token)
 */
export async function logoutSession(
  token: string
): Promise<ApiResponse> {
  if (!token) {
    return { success: false, error: 'No token provided' };
  }

  try {
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: { select: { aliasEmail: true } } },
    });

    if (session) {
      await prisma.session.delete({ where: { id: session.id } });
      log.info('Session logged out', { email: session.user.aliasEmail });
    }

    return { success: true, message: 'Logged out successfully' };
  } catch (error) {
    log.error('Logout error', { error });
    return { success: false, error: 'Failed to logout' };
  }
}

/**
 * Get current user from token
 * Legacy: getCurrentUser(token)
 */
export async function getCurrentUser(token: string): Promise<SessionUser | null> {
  const result = await validateSessionToken(token);
  if (!result.valid) {
    return null;
  }
  return result.user;
}

/**
 * Check portal access
 * Legacy: checkPortalAccess(token, portal)
 */
export async function checkPortalAccess(
  token: string,
  portal: PortalType
): Promise<{
  hasAccess: boolean;
  reason?: string;
  user?: SessionUser;
}> {
  const result = await validateSessionToken(token);

  if (!result.valid) {
    return { hasAccess: false, reason: 'not_logged_in' };
  }

  const user = result.user;

  // All logged-in users can access these portals
  if (portal === 'commission' || portal === 'attendance' || portal === 'student') {
    return { hasAccess: true, user };
  }

  // Teacher portal requires teacher role - do a LIVE check via Rewardful
  // (matches legacy behavior which checked Rewardful on every access)
  if (portal === 'teacher') {
    if (user.isTeacher || user.isAdmin) {
      return { hasAccess: true, user };
    }
    // The session flag might be stale -- do a live check
    try {
      const { verifyTeacherAccess } = await import('@/lib/services/teacher.service');
      log.info('Portal access: live teacher check for', { email: user.email });
      const teacherCheck = await verifyTeacherAccess(user.email);
      log.info('Portal access: teacher check result', { email: user.email, hasAccess: teacherCheck.hasAccess, reason: teacherCheck.reason });
      if (teacherCheck.hasAccess) {
        // Update the session user to reflect the new status
        user.isTeacher = true;
        return { hasAccess: true, user };
      }
    } catch (err) {
      log.error('Portal access: teacher check FAILED', {
        email: user.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { hasAccess: false, reason: 'not_teacher', user };
  }

  // Home is always accessible when logged in
  if (portal === 'home') {
    return { hasAccess: true, user };
  }

  return { hasAccess: false, reason: 'unknown_portal' };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get session user by token (internal helper)
 */
export async function getSessionUser(token: string): Promise<{
  user: { id: string; aliasEmail: string; internalEmail: string | null; isAdmin: boolean; isTeacher: boolean } | null;
  isAdmin: boolean;
}> {
  if (!token) {
    return { user: null, isAdmin: false };
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    return { user: null, isAdmin: false };
  }

  return {
    user: session.user,
    isAdmin: session.user.isAdmin,
  };
}

/**
 * Validate admin session
 */
export async function validateAdminSession(token: string): Promise<boolean> {
  const { isAdmin } = await getSessionUser(token);
  return isAdmin;
}
