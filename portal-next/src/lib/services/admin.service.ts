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
import { getCachedReferralCounts } from './referral.service';
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
export async function getAllAttendanceUsers(): Promise<ApiResponse & { users?: Array<object> }> {
  try {
    const users = await prisma.user.findMany({
      include: {
        attendanceProfile: { select: { currentTeacherEmail: true } },
      },
      orderBy: [{ firstName: 'asc' }, { aliasEmail: 'asc' }],
    });

    const results = users.map((u) => ({
      email: u.aliasEmail,
      aliasEmail: u.aliasEmail,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined,
      accountStatus: u.accountStatus,
      isTeacher: u.isTeacher,
      isAdmin: u.isAdmin,
      isSupervisor: u.isSupervisor,
      isHidden: u.isHidden,
      teacherEmail: u.attendanceProfile?.currentTeacherEmail || undefined,
      createdAt: u.createdAt.toISOString(),
      hasPassword: !!u.passwordHash,
      hasAttendanceProfile: !!u.attendanceProfile,
    }));

    return { success: true, users: results };
  } catch (error) {
    log.error('Get all users error', { error });
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
    // Search ALL users in the database (not just those with attendance profiles)
    // This includes legacy users, pending users, everyone
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { aliasEmail: { contains: searchTerm, mode: 'insensitive' } },
          { internalEmail: { contains: searchTerm, mode: 'insensitive' } },
          { firstName: { contains: searchTerm, mode: 'insensitive' } },
          { lastName: { contains: searchTerm, mode: 'insensitive' } },
          { email: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      include: {
        attendanceProfile: { select: { currentTeacherEmail: true } },
      },
      take: 50, // Limit results for performance
      orderBy: { aliasEmail: 'asc' },
    });

    const results = users.map((u) => ({
      email: u.aliasEmail,
      aliasEmail: u.aliasEmail,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined,
      accountStatus: u.accountStatus,
      isTeacher: u.isTeacher,
      isAdmin: u.isAdmin,
      isSupervisor: u.isSupervisor,
      isHidden: u.isHidden,
      teacherEmail: u.attendanceProfile?.currentTeacherEmail || undefined,
      createdAt: u.createdAt.toISOString(),
      hasPassword: !!u.passwordHash,
      hasAttendanceProfile: !!u.attendanceProfile,
    }));

    return { success: true, users: results };
  } catch (error) {
    log.error('Search users error', { error });
    return { success: false, error: 'Failed to search users' };
  }
}

/**
 * Get student attendance stats for teacher
 * Legacy: getStudentAttendanceStats(teacherEmail, studentEmail, token)
 *
 * Returns full stats including attendance records, streak, rate, and referral counts.
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
            records: {
              orderBy: { date: 'desc' },
            },
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

    const allRecords = student.attendanceProfile?.records || [];
    const name =
      [student.firstName, student.lastName].filter(Boolean).join(' ') ||
      student.aliasEmail;

    // Helper to compute stats for a given set of records
    const computeStats = (records: typeof allRecords) => {
      const confirmed = records.length;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let streak = 0;
      const sortedDates = records
        .map(r => {
          const d = new Date(r.date);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })
        .sort((a, b) => b - a);

      if (sortedDates.length > 0) {
        let checkDate = today.getTime();
        for (const d of sortedDates) {
          if (d === checkDate || d === checkDate - 86400000) {
            streak++;
            checkDate = d - 86400000;
          } else if (d < checkDate - 86400000) {
            break;
          }
        }
      }

      const firstRecord = records.length > 0
        ? new Date(records[records.length - 1].date)
        : null;
      const totalDaysSinceStart = firstRecord
        ? Math.max(1, Math.ceil((today.getTime() - firstRecord.getTime()) / 86400000))
        : 0;
      const missedDays = Math.max(0, totalDaysSinceStart - confirmed);
      const attendanceRate = totalDaysSinceStart > 0
        ? Math.round((confirmed / totalDaysSinceStart) * 100)
        : 0;

      const recentRecords = records.slice(0, 10).map(r => ({
        date: String(r.date).split('T')[0],
        confirmed: true,
      }));

      return {
        totalConfirmed: confirmed,
        totalMissed: missedDays,
        streak,
        attendanceRate: `${attendanceRate}%`,
        totalDays: totalDaysSinceStart,
        confirmedDays: confirmed,
        missedDays,
        recentRecords,
      };
    };

    // Split records by mode
    const liveRecords = allRecords.filter(r => (r.mode || 'live') === 'live');
    const clipperRecords = allRecords.filter(r => r.mode === 'clipper');

    const liveStats = computeStats(liveRecords);
    const clipperStats = computeStats(clipperRecords);

    // Get referral counts
    let leadsCount = 0;
    let conversionsCount = 0;
    try {
      const { rewardfulApi } = await import('./rewardful.service');
      const emailForApi = student.internalEmail || student.aliasEmail;
      const affResult = await rewardfulApi.getAffiliateByEmail(emailForApi);
      if (affResult.success && affResult.affiliate) {
        const referrals = await rewardfulApi.getAllReferrals(affResult.affiliate.id);
        for (const ref of referrals) {
          const state = (ref.conversion_state || '').toLowerCase();
          if (state === 'conversion' || ref.became_conversion_at || ref.sale_occurred_at) {
            conversionsCount++;
          } else if (state !== 'visitor' && (state === 'lead' || ref.became_lead_at)) {
            leadsCount++;
          }
        }
      }
    } catch {
      // Referral data is optional - don't fail the whole request
    }

    return {
      success: true,
      student: {
        email: student.aliasEmail,
        name,
        teacherEmail: student.attendanceProfile?.currentTeacherEmail,
        createdAt: student.createdAt?.toISOString(),
      },
      stats: liveStats,
      recentRecords: liveStats.recentRecords,
      clipperStats,
      clipperRecentRecords: clipperStats.recentRecords,
      referrals: {
        leadsCount,
        conversionsCount,
        totalCount: leadsCount + conversionsCount,
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

// ============================================================================
// CLEAR CACHES
// ============================================================================

/**
 * Clear all caches (referral cache, API cache)
 * Legacy: clearAllCaches()
 */
export async function clearAllCaches(): Promise<ApiResponse> {
  try {
    await prisma.referralCache.deleteMany();
    await prisma.apiCache.deleteMany();
    log.info('All caches cleared');
    return { success: true, message: 'All caches cleared' };
  } catch (error) {
    log.error('Clear caches error', { error });
    return { success: false, error: 'Failed to clear caches' };
  }
}

// ============================================================================
// ADMIN MANAGE MODE (audit logging)
// ============================================================================

/**
 * Admin start managing a user (audit log)
 * Legacy: adminStartManageUser(adminEmail, targetEmail)
 */
export async function adminStartManageUser(
  adminEmail: string,
  targetEmail: string
): Promise<ApiResponse> {
  log.info('Admin manage mode started', { admin: adminEmail, target: targetEmail });
  return { success: true };
}

/**
 * Admin stop managing a user (audit log)
 * Legacy: adminStopManageUser(adminEmail, targetEmail)
 */
export async function adminStopManageUser(
  adminEmail: string,
  targetEmail: string
): Promise<ApiResponse> {
  log.info('Admin manage mode stopped', { admin: adminEmail, target: targetEmail });
  return { success: true };
}

// ============================================================================
// ADMIN STUDENT DASHBOARD
// ============================================================================

/**
 * Get full student dashboard for admin or supervisor
 * Legacy: adminGetStudentDashboard(studentEmail, token)
 * Supervisors get same data but without internal email, status, or role flags.
 */
export async function adminGetStudentDashboard(
  studentEmail: string,
  token: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  const isAdmin = !!sessionUser?.isAdmin;
  const isSupervisor = !!sessionUser?.isSupervisor;
  if (!isAdmin && !isSupervisor) {
    return { success: false, error: 'Unauthorized' };
  }

  const normalizedEmail = normalizeEmail(studentEmail);

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: {
        attendanceProfile: {
          include: { records: { orderBy: { date: 'desc' }, take: 50 } },
        },
      },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Use cached referral counts (instant - no Rewardful API calls)
    const { leadsCount, conversionsCount } = await getCachedReferralCounts(user.aliasEmail);

    const records = user.attendanceProfile?.records || [];
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.aliasEmail;

    const studentPayload = isAdmin
      ? {
          email: user.aliasEmail,
          aliasEmail: user.aliasEmail,
          internalEmail: user.internalEmail,
          name,
          accountStatus: user.accountStatus,
          isTeacher: user.isTeacher,
          isAdmin: user.isAdmin,
          isSupervisor: user.isSupervisor,
          isHidden: user.isHidden,
          teacherEmail: user.attendanceProfile?.currentTeacherEmail,
          createdAt: user.createdAt?.toISOString(),
        }
      : {
          email: user.aliasEmail,
          aliasEmail: user.aliasEmail,
          name,
          isTeacher: user.isTeacher,
          teacherEmail: user.attendanceProfile?.currentTeacherEmail,
          createdAt: user.createdAt?.toISOString(),
        };

    return {
      success: true,
      student: studentPayload,
      attendance: {
        totalConfirmed: records.length,
        recentRecords: records.slice(0, 30).map(r => ({
          date: String(r.date).split('T')[0],
          confirmed: true,
        })),
      },
      referrals: { leadsCount, conversionsCount, totalCount: leadsCount + conversionsCount },
    } as ApiResponse;
  } catch (error) {
    log.error('Admin get student dashboard error', { error });
    return { success: false, error: 'Failed to load student dashboard' };
  }
}

// ============================================================================
// ADMIN EMAIL EDITING
// ============================================================================

/**
 * Update a user's alias email (login email)
 * Legacy: adminUpdateAliasEmail(studentEmail, newAliasEmail, token)
 */
export async function adminUpdateAliasEmail(
  studentEmail: string,
  newAliasEmail: string,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(studentEmail);
  const newNormalized = normalizeEmail(newAliasEmail);
  if (!newNormalized || !newNormalized.includes('@')) {
    return { success: false, error: 'Invalid email format' };
  }

  try {
    const user = await prisma.user.findUnique({ where: { aliasEmail: normalized } });
    if (!user) return { success: false, error: 'User not found' };

    // Check if new email already taken
    const existing = await prisma.user.findUnique({ where: { aliasEmail: newNormalized } });
    if (existing && existing.id !== user.id) {
      return { success: false, error: 'Email already in use by another account' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        aliasEmail: newNormalized,
        email: newNormalized,
        originalAliasEmail: user.originalAliasEmail || user.aliasEmail,
      },
    });

    log.info('Admin updated alias email', { old: normalized, new: newNormalized });
    return { success: true, message: 'Alias email updated' };
  } catch (error) {
    log.error('Admin update alias email error', { error });
    return { success: false, error: 'Failed to update email' };
  }
}

/**
 * Update a user's internal email (Rewardful/commission email)
 * Legacy: adminUpdateInternalEmail(studentEmail, newInternalEmail, token)
 */
export async function adminUpdateInternalEmail(
  studentEmail: string,
  newInternalEmail: string,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(studentEmail);

  try {
    const user = await prisma.user.findUnique({ where: { aliasEmail: normalized } });
    if (!user) return { success: false, error: 'User not found' };

    // Verify the new internal email exists in Rewardful
    const affResult = await rewardfulApi.getAffiliateByEmail(newInternalEmail);
    if (!affResult.success || !affResult.affiliate) {
      return { success: false, error: 'Email not found in affiliate system. Please verify it exists.' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        internalEmail: newInternalEmail.toLowerCase().trim(),
        rewardfulAffiliateId: affResult.affiliate.id,
      },
    });

    log.info('Admin updated internal email', { user: normalized, newInternal: newInternalEmail });
    return { success: true, message: 'Internal email updated' };
  } catch (error) {
    log.error('Admin update internal email error', { error });
    return { success: false, error: 'Failed to update internal email' };
  }
}

/**
 * Update a student's teacher assignment
 * Legacy: adminUpdateStudentTeacher(studentEmail, newTeacherEmail, token)
 */
export async function adminUpdateStudentTeacher(
  studentEmail: string,
  newTeacherEmail: string,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(studentEmail);
  const normalizedTeacher = normalizeEmail(newTeacherEmail);

  try {
    const student = await prisma.user.findUnique({
      where: { aliasEmail: normalized },
      include: { attendanceProfile: true },
    });
    if (!student) return { success: false, error: 'Student not found' };

    // Update attendance profile
    if (student.attendanceProfile) {
      await prisma.attendanceProfile.update({
        where: { id: student.attendanceProfile.id },
        data: { currentTeacherEmail: normalizedTeacher },
      });
    }

    // Update teacher-student link
    const teacher = await prisma.user.findUnique({ where: { aliasEmail: normalizedTeacher } });
    if (teacher) {
      // Remove old links
      await prisma.teacherStudentLink.updateMany({
        where: { studentId: student.id, status: 'ACTIVE' },
        data: { status: 'REMOVED', removedAt: new Date(), removedBy: 'admin' },
      });

      // Create new link
      await prisma.teacherStudentLink.upsert({
        where: { teacherId_studentId: { teacherId: teacher.id, studentId: student.id } },
        create: { teacherId: teacher.id, studentId: student.id, status: 'ACTIVE', createdBy: 'admin', percentageOverride: 10 },
        update: { status: 'ACTIVE', removedAt: null, removedBy: null },
      });
    }

    log.info('Admin updated student teacher', { student: normalized, teacher: normalizedTeacher });
    return { success: true, message: 'Teacher updated' };
  } catch (error) {
    log.error('Admin update student teacher error', { error });
    return { success: false, error: 'Failed to update teacher' };
  }
}

/**
 * Set or unset a user as supervisor. Admin only.
 * Legacy: adminSetSupervisor(userEmail, isSupervisor, token)
 */
export async function adminSetSupervisor(
  userEmail: string,
  isSupervisor: boolean,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(userEmail);

  try {
    const user = await prisma.user.findUnique({ where: { aliasEmail: normalized } });
    if (!user) return { success: false, error: 'User not found' };

    await prisma.user.update({
      where: { id: user.id },
      data: { isSupervisor },
    });

    log.info('Admin set supervisor', { email: normalized, isSupervisor });
    return { success: true, message: isSupervisor ? 'User set as supervisor' : 'Supervisor role removed' };
  } catch (error) {
    log.error('Admin set supervisor error', { error });
    return { success: false, error: 'Failed to update supervisor' };
  }
}

/**
 * Reset all attendance data for a user
 * Legacy: resetAllAttendance(email, token)
 */
export async function resetAllAttendance(
  email: string,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalized },
      include: { attendanceProfile: true },
    });
    if (!user?.attendanceProfile) return { success: false, error: 'No attendance data found' };

    await prisma.attendanceRecord.deleteMany({
      where: { profileId: user.attendanceProfile.id },
    });

    log.info('Admin reset attendance', { email: normalized });
    return { success: true, message: 'All attendance records deleted' };
  } catch (error) {
    log.error('Reset attendance error', { error });
    return { success: false, error: 'Failed to reset attendance' };
  }
}

/**
 * Fetch affiliate campaigns from Rewardful
 * Legacy: fetchAffiliateCampaigns(token)
 */
export async function fetchAffiliateCampaigns(
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  try {
    const result = await rewardfulApi.getCampaigns();
    return {
      success: true,
      campaigns: result.campaigns.map(c => ({
        id: c.id,
        name: c.name,
        commissionPercent: c.commission_percent || c.default_commission_percent,
      })),
    } as ApiResponse;
  } catch (error) {
    log.error('Fetch campaigns error', { error });
    return { success: false, error: 'Failed to fetch campaigns' };
  }
}

/**
 * Delete orphaned legacy account
 * Legacy: adminDeleteOrphanedLegacy(email, token)
 */
export async function adminDeleteOrphanedLegacy(
  email: string,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({ where: { aliasEmail: normalized } });
    if (!user) return { success: false, error: 'User not found' };

    // Delete the user and all related data (cascading)
    await prisma.user.delete({ where: { id: user.id } });

    log.info('Admin deleted orphaned legacy account', { email: normalized });
    return { success: true, message: 'Account deleted' };
  } catch (error) {
    log.error('Admin delete orphaned legacy error', { error });
    return { success: false, error: 'Failed to delete account' };
  }
}

/**
 * Toggle hidden status on a user account.
 * Hidden accounts don't appear in supervisor lookup but show in admin's hidden section.
 */
export async function adminToggleHideUser(
  email: string,
  hidden: boolean,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({ where: { aliasEmail: normalized } });
    if (!user) return { success: false, error: 'User not found' };

    await prisma.user.update({ where: { id: user.id }, data: { isHidden: hidden } });

    log.info('Admin toggled user hidden status', { email: normalized, hidden });
    return { success: true };
  } catch (error) {
    log.error('Admin toggle hide user error', { error, email: normalized });
    return { success: false, error: 'Failed to update user' };
  }
}

/**
 * Permanently delete a user and all related data.
 * Admin-only. Cascading deletes handle sessions, attendance, links, etc.
 */
export async function adminDeleteUser(
  email: string,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  const normalized = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({ where: { aliasEmail: normalized } });
    if (!user) return { success: false, error: 'User not found' };

    if (user.isAdmin) {
      return { success: false, error: 'Cannot delete an admin account' };
    }

    await prisma.user.delete({ where: { id: user.id } });

    log.info('Admin permanently deleted user', { email: normalized, userId: user.id });
    return { success: true };
  } catch (error) {
    log.error('Admin delete user error', { error, email: normalized });
    return { success: false, error: 'Failed to delete user' };
  }
}

/**
 * Cleanup all orphaned legacy accounts
 * Legacy: adminCleanupAllOrphanedLegacy(token)
 */
export async function adminCleanupAllOrphanedLegacy(
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) return { success: false, error: 'Unauthorized' };

  try {
    // Find users with no password and no attendance profile (orphaned)
    const orphaned = await prisma.user.findMany({
      where: {
        passwordHash: null,
        accountStatus: { in: ['PENDING', 'APPROVED'] },
        attendanceProfile: null,
      },
    });

    let deleted = 0;
    for (const user of orphaned) {
      try {
        await prisma.user.delete({ where: { id: user.id } });
        deleted++;
      } catch { /* skip if cascading fails */ }
    }

    log.info('Admin bulk cleanup', { found: orphaned.length, deleted });
    return { success: true, message: `Cleaned up ${deleted} orphaned accounts`, count: deleted } as ApiResponse;
  } catch (error) {
    log.error('Cleanup orphaned legacy error', { error });
    return { success: false, error: 'Failed to cleanup' };
  }
}
