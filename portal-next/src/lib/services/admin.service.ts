/**
 * Admin Service
 *
 * Handles administrative functions including account approvals,
 * user management, and attendance administration.
 */

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { getSessionUser, validateAdminSession } from './session.service';
import { rewardfulApi } from './rewardful.service';
import type { ApiResponse, PendingAccount, ApprovalData, ApprovalResult, PreCheckResult } from '@/types';

const log = logger.child({ service: 'admin' });

// ============================================================================
// PENDING ACCOUNTS
// ============================================================================

/**
 * Get pending account requests
 * Legacy: adminGetPendingAccounts(sessionToken)
 */
export async function adminGetPendingAccounts(
  sessionToken: string
): Promise<ApiResponse & { pending?: PendingAccount[]; count?: number }> {
  // Validate admin
  const isAdmin = await validateAdminSession(sessionToken);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  try {
    const pendingUsers = await prisma.user.findMany({
      where: { accountStatus: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
    });

    const pending: PendingAccount[] = pendingUsers.map((user) => ({
      aliasEmail: user.aliasEmail,
      email: user.aliasEmail,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      requestedAt: user.requestedAt?.toISOString() || '',
      requestedPortalType: user.requestedPortalType || 'affiliate',
      rewardfulEmail: user.internalEmail,
    }));

    return {
      success: true,
      pending,
      count: pending.length,
    };
  } catch (error) {
    log.error('Get pending accounts error', { error });
    return { success: false, error: 'Failed to fetch pending accounts' };
  }
}

/**
 * Pre-check internal email before approval
 * Legacy: adminPreCheckInternalEmail(internalEmail, sessionToken)
 */
export async function adminPreCheckInternalEmail(
  internalEmail: string,
  sessionToken: string
): Promise<ApiResponse & PreCheckResult> {
  const isAdmin = await validateAdminSession(sessionToken);
  if (!isAdmin) {
    return {
      success: false,
      error: 'Unauthorized - admin only',
      exists: false,
      actionWillBe: 'NEW_USER',
      message: '',
      description: '',
      affiliate: null,
    };
  }

  const normalized = normalizeEmail(internalEmail);

  if (!normalized) {
    return {
      success: false,
      error: 'Please enter an internal email to check',
      exists: false,
      actionWillBe: 'NEW_USER',
      message: '',
      description: '',
      affiliate: null,
    };
  }

  try {
    // Check Rewardful for existing affiliate
    const result = await rewardfulApi.getAffiliateByEmail(normalized);

    if (result.success && result.affiliate) {
      const aff = result.affiliate;

      // Get commission stats
      const commissions = await rewardfulApi.getCommissionTotals(aff.id);

      return {
        success: true,
        exists: true,
        actionWillBe: 'MIGRATION',
        message: 'EXISTING AFFILIATE FOUND — This will be a MIGRATION',
        description:
          'This email already exists in the affiliate system. Approving will LINK this alias email to the existing affiliate.',
        affiliate: {
          id: aff.id,
          name: `${aff.first_name || ''} ${aff.last_name || ''}`.trim(),
          firstName: aff.first_name || '',
          lastName: aff.last_name || '',
          email: aff.email,
          state: aff.state,
          unpaidCommission: commissions.unpaid,
          totalPaid: commissions.paid,
        },
      };
    }

    return {
      success: true,
      exists: false,
      actionWillBe: 'NEW_USER',
      message: 'NO AFFILIATE FOUND — This will be a NEW USER creation',
      description:
        'This email does NOT exist in the affiliate system. Approving will CREATE a new affiliate.',
      affiliate: null,
    };
  } catch (error) {
    log.error('Pre-check internal email error', { error });
    return {
      success: false,
      error: 'Failed to check email',
      exists: false,
      actionWillBe: 'NEW_USER',
      message: '',
      description: '',
      affiliate: null,
    };
  }
}

/**
 * Approve account request
 * Legacy: adminApproveAccount(originalAliasEmail, approvalData, sessionToken)
 */
export async function adminApproveAccount(
  originalAliasEmail: string,
  approvalData: ApprovalData,
  sessionToken: string
): Promise<ApprovalResult | { success: false; error: string }> {
  const isAdmin = await validateAdminSession(sessionToken);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const { user: adminUser } = await getSessionUser(sessionToken);
  const normalizedOriginal = normalizeEmail(originalAliasEmail);

  if (!normalizedOriginal) {
    return { success: false, error: 'Original alias email is required' };
  }

  if (!approvalData.rewardfulEmail?.trim()) {
    return { success: false, error: 'Internal Commission Email is required' };
  }

  const normalizedRewardful = normalizeEmail(approvalData.rewardfulEmail);
  const normalizedNewAlias = approvalData.newAliasEmail
    ? normalizeEmail(approvalData.newAliasEmail)
    : normalizedOriginal;

  try {
    // Find pending user
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedOriginal },
    });

    if (!user) {
      return { success: false, error: 'No account request found for this email' };
    }

    if (user.accountStatus !== 'PENDING') {
      if (user.accountStatus === 'ACTIVE' || user.accountStatus === 'COMPLETED') {
        return { success: false, error: 'This account is already active' };
      }
    }

    // Check if new alias conflicts
    if (normalizedNewAlias !== normalizedOriginal) {
      const existingAlias = await prisma.user.findUnique({
        where: { aliasEmail: normalizedNewAlias },
      });
      if (existingAlias && existingAlias.id !== user.id) {
        return { success: false, error: 'The new alias email is already in use' };
      }
    }

    // Check if affiliate exists or needs to be created
    let affiliateId: string;
    let actionTaken: 'linked' | 'created';
    let affiliateName: string;

    const existingAffiliate = await rewardfulApi.getAffiliateByEmail(normalizedRewardful);

    if (existingAffiliate.success && existingAffiliate.affiliate) {
      // Link to existing
      affiliateId = existingAffiliate.affiliate.id;
      affiliateName = `${existingAffiliate.affiliate.first_name || ''} ${existingAffiliate.affiliate.last_name || ''}`.trim();
      actionTaken = 'linked';
      log.info('Linking to existing affiliate', { affiliateId });
    } else {
      // Create new affiliate
      const createResult = await rewardfulApi.createAffiliate({
        email: normalizedRewardful,
        first_name: approvalData.firstName || user.firstName || 'Unknown',
        last_name: approvalData.lastName || user.lastName || 'User',
        campaign_id: approvalData.campaignId,
        paypal_email: approvalData.paypalEmail,
        state: approvalData.state || 'active',
      });

      if (!createResult.success || !createResult.affiliate) {
        return {
          success: false,
          error: `Failed to create affiliate: ${createResult.error}`,
        };
      }

      affiliateId = createResult.affiliate.id;
      affiliateName = `${approvalData.firstName || ''} ${approvalData.lastName || ''}`.trim();
      actionTaken = 'created';
      log.info('Created new affiliate', { affiliateId });
    }

    // Update user record
    await prisma.user.update({
      where: { id: user.id },
      data: {
        aliasEmail: normalizedNewAlias,
        email: normalizedNewAlias,
        originalAliasEmail: normalizedOriginal,
        internalEmail: normalizedRewardful,
        firstName: approvalData.firstName || user.firstName,
        lastName: approvalData.lastName || user.lastName,
        accountStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: adminUser?.aliasEmail || 'admin',
        rewardfulAffiliateId: affiliateId,
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        action: 'ACCOUNT_APPROVED',
        userId: user.id,
        adminId: adminUser?.id,
        details: JSON.stringify({
          originalAliasEmail: normalizedOriginal,
          newAliasEmail: normalizedNewAlias,
          internalEmail: normalizedRewardful,
          affiliateId,
          actionTaken,
        }),
      },
    });

    log.info('Account approved', {
      email: normalizedNewAlias,
      admin: adminUser?.aliasEmail,
      actionTaken,
    });

    return {
      success: true,
      message:
        actionTaken === 'linked'
          ? `MIGRATION COMPLETE: Linked existing affiliate to "${normalizedNewAlias}"`
          : `NEW AFFILIATE CREATED: "${affiliateName}" with internal email "${normalizedRewardful}"`,
      actionDescription:
        actionTaken === 'linked'
          ? 'This was a MIGRATION — the internal email already existed in the affiliate system.'
          : 'This was a NEW USER — the internal email did NOT exist in the affiliate system.',
      aliasEmail: normalizedNewAlias,
      originalAliasEmail: normalizedOriginal,
      internalEmail: normalizedRewardful,
      actionTaken,
      actionLabel:
        actionTaken === 'linked'
          ? 'MIGRATION (Linked Existing)'
          : 'NEW USER (Created New)',
      affiliateId,
      affiliateName,
      aliasEmailChanged: normalizedNewAlias !== normalizedOriginal,
      statusNote: 'User must check their status and set a password to complete setup.',
    };
  } catch (error) {
    log.error('Approve account error', { error });
    return { success: false, error: 'Failed to approve account' };
  }
}

/**
 * Reject account request
 * Legacy: adminRejectAccount(email, reason, sessionToken)
 */
export async function adminRejectAccount(
  email: string,
  reason: string,
  sessionToken: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(sessionToken);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const { user: adminUser } = await getSessionUser(sessionToken);
  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!user) {
      return { success: false, error: 'No account found for this email' };
    }

    if (user.accountStatus !== 'PENDING') {
      return { success: false, error: 'This account is not pending approval' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        accountStatus: 'REJECTED',
        rejectedAt: new Date(),
        rejectedBy: adminUser?.aliasEmail || 'admin',
        rejectionReason: reason || null,
      },
    });

    log.info('Account rejected', { email: normalizedEmail, admin: adminUser?.aliasEmail });

    return { success: true, message: 'Account request rejected', email: normalizedEmail } as ApiResponse;
  } catch (error) {
    log.error('Reject account error', { error });
    return { success: false, error: 'Failed to reject account' };
  }
}

// ============================================================================
// ATTENDANCE ADMIN
// ============================================================================

/**
 * Get all attendance users
 * Legacy: getAllAttendanceUsers()
 */
export async function getAllAttendanceUsers(): Promise<ApiResponse & {
  users?: Array<{
    email: string;
    aliasEmail: string;
    internalEmail?: string;
    teacherEmail?: string;
    createdAt: string;
    isLegacy: boolean;
    isOrphaned: boolean;
  }>;
}> {
  try {
    const profiles = await prisma.attendanceProfile.findMany({
      include: { user: true },
    });

    const users = profiles.map((profile) => ({
      email: profile.user.aliasEmail,
      aliasEmail: profile.user.aliasEmail,
      internalEmail: profile.user.internalEmail || undefined,
      teacherEmail: profile.currentTeacherEmail || undefined,
      createdAt: profile.createdAt.toISOString(),
      isLegacy: !!profile.legacyPasswordHash,
      isOrphaned: false, // Would need more logic to determine
    }));

    return { success: true, users };
  } catch (error) {
    log.error('Get all attendance users error', { error });
    return { success: false, error: 'Failed to fetch users' };
  }
}

/**
 * Search attendance users
 * Legacy: searchAttendanceUsers(query)
 */
export async function searchAttendanceUsers(
  query: string
): Promise<ApiResponse & { users?: Array<object> }> {
  const searchTerm = query.toLowerCase().trim();

  if (!searchTerm) {
    return getAllAttendanceUsers();
  }

  try {
    const profiles = await prisma.attendanceProfile.findMany({
      where: {
        OR: [
          { user: { aliasEmail: { contains: searchTerm, mode: 'insensitive' } } },
          { user: { firstName: { contains: searchTerm, mode: 'insensitive' } } },
          { user: { lastName: { contains: searchTerm, mode: 'insensitive' } } },
        ],
      },
      include: { user: true },
    });

    const users = profiles.map((profile) => ({
      email: profile.user.aliasEmail,
      aliasEmail: profile.user.aliasEmail,
      internalEmail: profile.user.internalEmail || undefined,
      teacherEmail: profile.currentTeacherEmail || undefined,
      createdAt: profile.createdAt.toISOString(),
      isLegacy: !!profile.legacyPasswordHash,
      isOrphaned: false,
    }));

    return { success: true, users };
  } catch (error) {
    log.error('Search attendance users error', { error });
    return { success: false, error: 'Failed to search users' };
  }
}

/**
 * Get student attendance stats for teacher
 * Legacy: getStudentAttendanceStats(teacherEmail, studentEmail, token)
 */
export async function getStudentAttendanceStats(
  teacherEmail: string,
  studentEmail: string,
  token: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const normalizedTeacher = normalizeEmail(teacherEmail);
  const normalizedStudent = normalizeEmail(studentEmail);

  try {
    // Verify teacher-student link
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedTeacher },
    });

    const student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
      include: {
        attendanceProfile: {
          include: {
            records: true,
          },
        },
      },
    });

    if (!teacher || !student) {
      return { success: false, error: 'Teacher or student not found' };
    }

    const link = await prisma.teacherStudentLink.findFirst({
      where: {
        teacherId: teacher.id,
        studentId: student.id,
        status: 'ACTIVE',
      },
    });

    if (!link && !sessionUser.isAdmin) {
      return { success: false, error: 'Not authorized to view this student' };
    }

    const records = student.attendanceProfile?.records || [];
    const confirmed = records.length;
    const name =
      [student.firstName, student.lastName].filter(Boolean).join(' ') ||
      student.aliasEmail;

    return {
      success: true,
      student: {
        email: student.aliasEmail,
        name,
        teacherEmail: student.attendanceProfile?.currentTeacherEmail,
      },
      stats: {
        totalConfirmed: confirmed,
        totalMissed: 0, // Would need calculation
        streak: 0, // Would need calculation
      },
    } as ApiResponse;
  } catch (error) {
    log.error('Get student stats error', { error });
    return { success: false, error: 'Failed to get student stats' };
  }
}

/**
 * Delete attendance record
 * Legacy: deleteAttendanceRecord(email, dateStr, token)
 */
export async function deleteAttendanceRecord(
  email: string,
  dateStr: string,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: { attendanceProfile: true },
    });

    if (!user?.attendanceProfile) {
      return { success: false, error: 'User or profile not found' };
    }

    await prisma.attendanceRecord.deleteMany({
      where: {
        profileId: user.attendanceProfile.id,
        date: dateStr,
      },
    });

    log.info('Attendance record deleted', { email: normalizedEmail, date: dateStr });

    return { success: true, message: 'Record deleted' } as ApiResponse;
  } catch (error) {
    log.error('Delete attendance record error', { error });
    return { success: false, error: 'Failed to delete record' };
  }
}
