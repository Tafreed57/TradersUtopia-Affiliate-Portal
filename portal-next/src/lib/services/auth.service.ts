/**
 * Auth Service
 *
 * Handles password verification, account status, and access requests.
 * Maps to legacy AUTH_* functions.
 */

import { prisma } from '@/lib/db';
import { config, isAdminEmail, normalizeEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import {
  verifyPasswordUnified,
  hashPassword,
  generateLegacySalt,
  hashPasswordLegacy,
} from '@/lib/auth/password';
import type {
  AccountStatusResponse,
  RequestStatusResponse,
  ApiResponse,
} from '@/types';

const log = logger.child({ service: 'auth' });

// ============================================================================
// PASSWORD VERIFICATION
// ============================================================================

/**
 * Verify affiliate password
 * Legacy: verifyAffiliatePassword(aliasEmail, password)
 */
export async function verifyAffiliatePassword(
  aliasEmail: string,
  password: string
): Promise<ApiResponse> {
  const email = normalizeEmail(aliasEmail);

  if (!email) {
    return { success: false, error: 'Email is required' };
  }

  if (!password) {
    return { success: false, error: 'Password is required' };
  }

  log.debug('Verifying password', { email });

  try {
    // Check for legacy/internal email login attempt
    const legacyCheck = await checkLegacyEmailLogin(email);
    if (legacyCheck.isLegacy) {
      return {
        success: false,
        error: legacyCheck.error || 'This is an internal email. Please use your login email.',
        isLegacyEmail: true,
        aliasEmail: legacyCheck.aliasEmail,
      };
    }

    // Find user by alias email
    const user = await prisma.user.findUnique({
      where: { aliasEmail: email },
    });

    if (!user || !user.passwordHash) {
      // Check if user exists with different status
      if (user) {
        if (user.accountStatus === 'PENDING') {
          return {
            success: false,
            error: 'Your account is pending approval.',
            isPending: true,
          };
        }
        if (user.accountStatus === 'APPROVED') {
          return {
            success: false,
            error: 'Your account is approved but no password is set.',
            noPasswordSet: true,
          };
        }
      }

      // Check if admin without password
      if (isAdminEmail(email)) {
        return {
          success: false,
          error: 'No password set. Please set your password first.',
          noPasswordSet: true,
        };
      }

      return {
        success: false,
        error: 'Account not found. Please request access first.',
        needsAccessRequest: true,
      };
    }

    // Check account status
    if (user.accountStatus === 'PENDING') {
      return {
        success: false,
        error: 'Your account is pending approval.',
        isPending: true,
      };
    }

    if (user.accountStatus === 'REJECTED') {
      return {
        success: false,
        error: 'Your access request was not approved.',
        isRejected: true,
      };
    }

    // Check rate limiting
    if (user.lockUntilTimestamp && user.lockUntilTimestamp > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.lockUntilTimestamp.getTime() - Date.now()) / (1000 * 60)
      );
      return {
        success: false,
        error: `Too many failed attempts. Try again in ${remainingMinutes} minute(s).`,
      };
    }

    // Verify password
    const isValid = await verifyPasswordUnified(
      password,
      user.passwordHash,
      user.passwordSalt
    );

    if (!isValid) {
      // Record failed attempt
      const newFailedCount = (user.failedLoginCount || 0) + 1;
      const updates: { failedLoginCount: number; lockUntilTimestamp?: Date } = {
        failedLoginCount: newFailedCount,
      };

      if (newFailedCount >= config.auth.maxFailedLoginAttempts) {
        updates.lockUntilTimestamp = new Date(
          Date.now() + config.auth.lockoutDurationMinutes * 60 * 1000
        );
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updates,
      });

      return { success: false, error: 'Invalid password' };
    }

    // Reset failed attempts on success
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockUntilTimestamp: null,
        lastLoginAt: new Date(),
      },
    });

    log.info('Password verified successfully', { email });

    return {
      success: true,
      email,
      message: 'Login successful',
    };
  } catch (error) {
    log.error('Password verification error', { error });
    return { success: false, error: 'An error occurred during login' };
  }
}

// ============================================================================
// PASSWORD SETTING
// ============================================================================

/**
 * Set affiliate password
 * Legacy: setAffiliatePassword(email, password, confirmPassword)
 */
export async function setAffiliatePassword(
  email: string,
  password: string,
  confirmPassword: string
): Promise<ApiResponse> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }

  if (!password) {
    return { success: false, error: 'Password is required' };
  }

  if (password !== confirmPassword) {
    return { success: false, error: 'Passwords do not match' };
  }

  // Validate password strength
  if (password.length < config.auth.minPasswordLength) {
    return {
      success: false,
      error: `Password must be at least ${config.auth.minPasswordLength} characters`,
    };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return { success: false, error: 'Password must contain at least one letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { success: false, error: 'Password must contain at least one number' };
  }

  try {
    // Hash password with bcrypt
    const passwordHash = await hashPassword(password);

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (user) {
      // Update existing user
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordSalt: null, // bcrypt doesn't need separate salt
          passwordSetAt: new Date(),
          failedLoginCount: 0,
          lockUntilTimestamp: null,
          accountStatus: 'ACTIVE',
        },
      });
    } else {
      // Check if admin
      const admin = isAdminEmail(normalizedEmail);

      // Create new user
      user = await prisma.user.create({
        data: {
          aliasEmail: normalizedEmail,
          email: normalizedEmail,
          passwordHash,
          passwordSetAt: new Date(),
          accountStatus: 'ACTIVE',
          isAdmin: admin,
        },
      });
    }

    log.info('Password set successfully', { email: normalizedEmail });

    return {
      success: true,
      message: 'Password set successfully. You can now log in.',
    };
  } catch (error) {
    log.error('Set password error', { error });
    return { success: false, error: 'Failed to set password' };
  }
}

/**
 * Set password for approved account
 * Legacy: setApprovedAccountPassword(aliasEmail, password, confirmPassword)
 */
export async function setApprovedAccountPassword(
  aliasEmail: string,
  password: string,
  confirmPassword: string
): Promise<ApiResponse> {
  const email = normalizeEmail(aliasEmail);

  if (!email) {
    return { success: false, error: 'Email is required' };
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { aliasEmail: email },
  });

  if (!user) {
    // Check if admin
    if (isAdminEmail(email)) {
      return setAffiliatePassword(email, password, confirmPassword);
    }
    return { success: false, error: 'No approved account found for this email.' };
  }

  // Check status
  if (user.accountStatus === 'PENDING') {
    return {
      success: false,
      error: 'Your account is still pending approval.',
    };
  }

  if (user.accountStatus === 'REJECTED') {
    return {
      success: false,
      error: 'Your account request was rejected.',
    };
  }

  if (
    (user.accountStatus === 'COMPLETED' || user.accountStatus === 'ACTIVE') &&
    user.passwordHash
  ) {
    return {
      success: false,
      error: 'Password is already set. Please use the login page.',
    };
  }

  // Set password using common function
  return setAffiliatePassword(email, password, confirmPassword);
}

/**
 * Set password with token
 * Legacy: setPasswordWithToken(token, password, confirmPassword)
 */
export async function setPasswordWithToken(
  token: string,
  password: string,
  confirmPassword: string
): Promise<ApiResponse> {
  if (!token) {
    return { success: false, error: 'Token is required' };
  }

  // Find and validate token
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!resetToken) {
    return {
      success: false,
      error: 'Invalid or expired link. Please request a new one.',
    };
  }

  if (resetToken.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
    return {
      success: false,
      error: 'This link has expired. Please request a new one.',
    };
  }

  if (resetToken.usedAt) {
    return {
      success: false,
      error: 'This link has already been used.',
    };
  }

  // Set password
  const result = await setAffiliatePassword(
    resetToken.user.aliasEmail,
    password,
    confirmPassword
  );

  if (result.success) {
    // Mark token as used
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });
  }

  return result;
}

/**
 * Validate password setup token
 * Legacy: validatePasswordSetupToken(token)
 */
export async function validatePasswordSetupToken(
  token: string
): Promise<{ valid: boolean; email?: string; error?: string }> {
  if (!token) {
    return { valid: false, error: 'Token is required' };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!resetToken) {
    return { valid: false, error: 'Invalid or expired link.' };
  }

  if (resetToken.expiresAt < new Date()) {
    return { valid: false, error: 'This link has expired.' };
  }

  if (resetToken.usedAt) {
    return { valid: false, error: 'This link has already been used.' };
  }

  return { valid: true, email: resetToken.user.aliasEmail };
}

// ============================================================================
// ACCOUNT STATUS
// ============================================================================

/**
 * Check account status
 * Legacy: checkAccountStatus(aliasEmail)
 */
export async function checkAccountStatus(
  aliasEmail: string
): Promise<AccountStatusResponse> {
  const email = normalizeEmail(aliasEmail);

  if (!email) {
    return { status: 'new', canSetPassword: false };
  }

  // Check if admin
  if (isAdminEmail(email)) {
    return {
      status: 'admin',
      canSetPassword: true,
      message: 'You can set or reset your password.',
    };
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { aliasEmail: email },
  });

  if (!user) {
    return { status: 'new', canSetPassword: false };
  }

  switch (user.accountStatus) {
    case 'PENDING':
      return {
        status: 'pending',
        canSetPassword: false,
        message: 'Your account is pending approval.',
      };

    case 'REJECTED':
      return {
        status: 'rejected',
        canSetPassword: false,
        message: 'Your access request was not approved.',
      };

    case 'APPROVED':
      return {
        status: 'approved_needs_password',
        canSetPassword: true,
        message: 'Your account has been approved! Please set your password.',
        currentAliasEmail: user.aliasEmail,
      };

    case 'COMPLETED':
    case 'ACTIVE':
      if (user.passwordHash) {
        return {
          status: 'active',
          canSetPassword: false,
          message: 'Your account is already set up. Please use the login page.',
        };
      }
      return {
        status: 'approved_needs_password',
        canSetPassword: true,
        message: 'Please set your password.',
      };

    default:
      return { status: 'new', canSetPassword: false };
  }
}

/**
 * Get request status
 * Legacy: getRequestStatus(email)
 */
export async function getRequestStatus(
  email: string
): Promise<RequestStatusResponse> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      found: false,
      status: 'NOT_FOUND',
      message: 'Please enter a valid email address.',
    };
  }

  // Check if admin
  if (isAdminEmail(normalizedEmail)) {
    return {
      found: true,
      status: 'ADMIN',
      canSetPassword: true,
      message: 'You can set or reset your password.',
    };
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { aliasEmail: normalizedEmail },
  });

  if (!user) {
    return {
      found: false,
      status: 'NOT_FOUND',
      message: 'No access request found for this email.',
    };
  }

  switch (user.accountStatus) {
    case 'PENDING':
      return {
        found: true,
        status: 'PENDING',
        canSetPassword: false,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        requestedAt: user.requestedAt?.toISOString(),
        message: 'Your access request is pending approval.',
      };

    case 'REJECTED':
      return {
        found: true,
        status: 'REJECTED',
        canSetPassword: false,
        message: 'Your access request was not approved.',
      };

    case 'APPROVED':
      return {
        found: true,
        status: 'APPROVED',
        canSetPassword: true,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        approvedAt: user.approvedAt?.toISOString(),
        currentAliasEmail: user.aliasEmail,
        message: 'Your account has been approved! You can now set your password.',
      };

    case 'COMPLETED':
    case 'ACTIVE':
      return {
        found: true,
        status: 'COMPLETED',
        canSetPassword: false,
        message: 'Your account is already set up! Please use the login page.',
      };

    default:
      return {
        found: true,
        status: 'UNKNOWN',
        canSetPassword: false,
        message: 'Account status unknown.',
      };
  }
}

/**
 * Request account access
 * Legacy: requestAccountAccess(aliasEmail, firstName, lastName, portalType)
 */
export async function requestAccountAccess(
  aliasEmail: string,
  firstName?: string,
  lastName?: string,
  portalType?: string
): Promise<ApiResponse> {
  const email = normalizeEmail(aliasEmail);

  if (!email) {
    return { success: false, error: 'Email is required' };
  }

  // Check for legacy email
  const legacyCheck = await checkLegacyEmailLogin(email);
  if (legacyCheck.isLegacy) {
    return {
      success: false,
      error: 'This is an internal system email. Please use your regular email.',
      isLegacyEmail: true,
      aliasEmail: legacyCheck.aliasEmail,
    };
  }

  // Check if already exists
  const existingUser = await prisma.user.findUnique({
    where: { aliasEmail: email },
  });

  if (existingUser) {
    if (existingUser.accountStatus === 'PENDING') {
      return {
        success: false,
        error: 'You already have a pending access request.',
        isPending: true,
      };
    }

    if (
      (existingUser.accountStatus === 'APPROVED' ||
        existingUser.accountStatus === 'ACTIVE' ||
        existingUser.accountStatus === 'COMPLETED') &&
      !existingUser.passwordHash
    ) {
      return {
        success: false,
        error: 'Your account is approved! Please set your password.',
        isApproved: true,
        needsPassword: true,
      };
    }

    return {
      success: false,
      error: 'This email is already registered. Please use the login page.',
    };
  }

  // Check if admin
  if (isAdminEmail(email)) {
    return {
      success: false,
      error: 'Please set your password to activate your account.',
      isAdmin: true,
    };
  }

  // Create pending request
  await prisma.user.create({
    data: {
      aliasEmail: email,
      email: email,
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      requestedPortalType: portalType || 'affiliate',
      accountStatus: 'PENDING',
      requestedAt: new Date(),
    },
  });

  log.info('Account access requested', { email });

  return {
    success: true,
    pending: true,
    message: 'Your access request has been submitted! Please check back later.',
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if affiliate exists
 * Legacy: checkAffiliateExists(email)
 */
export async function checkAffiliateExists(
  email: string
): Promise<{ exists: boolean; email: string; isAdmin: boolean }> {
  const normalizedEmail = normalizeEmail(email);

  if (isAdminEmail(normalizedEmail)) {
    return { exists: true, email: normalizedEmail, isAdmin: true };
  }

  const user = await prisma.user.findUnique({
    where: { aliasEmail: normalizedEmail },
  });

  return {
    exists: !!user,
    email: normalizedEmail,
    isAdmin: false,
  };
}

/**
 * Check if user has password set
 * Legacy: hasPasswordSet(email)
 */
export async function hasPasswordSet(
  email: string
): Promise<{ hasPassword: boolean; email: string }> {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: { aliasEmail: normalizedEmail },
    select: { passwordHash: true },
  });

  return {
    hasPassword: !!(user?.passwordHash),
    email: normalizedEmail,
  };
}

/**
 * Check for legacy/internal email login
 * Legacy: checkLegacyEmailLogin(email)
 */
export async function checkLegacyEmailLogin(email: string): Promise<{
  isLegacy: boolean;
  error?: string;
  aliasEmail?: string;
}> {
  const normalizedEmail = normalizeEmail(email);

  // Check if this is an internal email (contains encoded % or other patterns)
  // Internal emails might have format like "user100%@gmail.com"
  if (normalizedEmail.includes('%')) {
    // Try to find the alias for this internal email
    const user = await prisma.user.findFirst({
      where: { internalEmail: normalizedEmail },
      select: { aliasEmail: true },
    });

    return {
      isLegacy: true,
      error: 'This is an internal system email. Please use your login email.',
      aliasEmail: user?.aliasEmail || undefined,
    };
  }

  return { isLegacy: false };
}

// ============================================================================
// GOOGLE SIGN-IN
// ============================================================================

/**
 * Handle Google Sign-In
 * Called after Clerk authenticates the user with Google.
 * Creates a PENDING request for new users, or creates a session for existing active users.
 */
export async function handleGoogleSignIn(
  googleEmail: string,
  firstName: string,
  lastName: string,
  googleId: string
): Promise<ApiResponse & { token?: string; status?: string }> {
  const normalizedEmail = normalizeEmail(googleEmail);

  if (!normalizedEmail) {
    return { success: false, error: 'Invalid email from Google' };
  }

  const log = logger.child({ service: 'google-auth' });
  log.info('Google sign-in attempt', { email: normalizedEmail });

  try {
    // Check if user exists in our database
    let user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    // Also check by googleId
    if (!user && googleId) {
      user = await prisma.user.findFirst({
        where: { googleId },
      });
    }

    if (user) {
      // Link Google ID if not already linked
      if (!user.googleId && googleId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { googleId },
        });
      }

      const status = user.accountStatus;

      if (status === 'ACTIVE' || status === 'COMPLETED') {
        // Active user — create our session
        const { createSession } = await import('./session.service');
        const sessionResult = await createSession(user.aliasEmail);

        if (sessionResult.success && sessionResult.token) {
          return { success: true, token: sessionResult.token };
        }

        return { success: false, error: 'Failed to create session' };
      }

      if (status === 'APPROVED') {
        // Approved but hasn't set password — activate via Google
        await prisma.user.update({
          where: { id: user.id },
          data: { accountStatus: 'ACTIVE', completedAt: new Date() },
        });

        const { createSession } = await import('./session.service');
        const sessionResult = await createSession(user.aliasEmail);

        if (sessionResult.success && sessionResult.token) {
          return { success: true, token: sessionResult.token };
        }

        return { success: false, error: 'Failed to create session' };
      }

      if (status === 'PENDING') {
        return { success: false, error: 'Account pending', status: 'pending' };
      }

      if (status === 'REJECTED') {
        return { success: false, error: 'Account rejected', status: 'rejected' };
      }

      return { success: false, error: 'Unknown account status' };
    }

    // New user — create PENDING request
    log.info('Google sign-in: creating pending request', { email: normalizedEmail });

    await prisma.user.create({
      data: {
        aliasEmail: normalizedEmail,
        email: normalizedEmail,
        firstName: firstName || null,
        lastName: lastName || null,
        googleId: googleId || null,
        accountStatus: 'PENDING',
        requestedAt: new Date(),
        requestedPortalType: 'affiliate',
      },
    });

    return { success: false, error: 'Request submitted', status: 'request_submitted' };
  } catch (error) {
    log.error('Google sign-in error', { error: error instanceof Error ? error.message : String(error) });
    return { success: false, error: 'Google sign-in failed' };
  }
}
