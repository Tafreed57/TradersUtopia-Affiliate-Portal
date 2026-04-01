/**
 * Teacher Service
 *
 * Handles teacher portal functionality including student management,
 * commission viewing, and ledger-based earnings tracking.
 *
 * Earnings are driven by Rewardful webhooks (payout.paid events).
 * When a student gets paid on Rewardful, the teacher's cut is
 * automatically credited via the webhook → processPayoutWebhook().
 */

import { prisma } from '@/lib/db';
import { config, normalizeEmail, isAdminEmail, isTeacherOverrideEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { getSessionUser, validateAdminSession } from './session.service';
import { rewardfulApi } from './rewardful.service';
import type {
  ApiResponse,
  TeacherData,
  TeacherEarningsData,
  StudentCommissionData,
  LedgerEntryData,
  TeacherPaymentInfo,
} from '@/types';

const log = logger.child({ service: 'teacher' });

/**
 * Extract percentage from email address pattern like "user50%@gmail.com" -> 50
 */
function extractEmailPercentage(email: string): number | null {
  if (!email) return null;
  const match = email.toLowerCase().match(/(\d{1,3})%@/);
  if (!match?.[1]) return null;
  let pct = parseInt(match[1], 10);
  if (isNaN(pct)) return null;
  if (pct > 100) pct = 100;
  if (pct < 1) pct = 1;
  return pct;
}

// ============================================================================
// TEACHER ACCESS
// ============================================================================

/**
 * Verify teacher access
 */
export async function verifyTeacherAccess(
  email: string
): Promise<{ hasAccess: boolean; isAdmin: boolean; isTeacher: boolean; reason?: string }> {
  const normalizedEmail = normalizeEmail(email);
  log.info('verifyTeacherAccess called', { email: normalizedEmail });

  // Check admin
  if (isAdminEmail(normalizedEmail)) {
    return { hasAccess: true, isAdmin: true, isTeacher: true };
  }

  // Check override list
  if (isTeacherOverrideEmail(normalizedEmail)) {
    return { hasAccess: true, isAdmin: false, isTeacher: true };
  }

  // Check user record
  const user = await prisma.user.findUnique({
    where: { aliasEmail: normalizedEmail },
  });

  if (user?.isTeacher) {
    return { hasAccess: true, isAdmin: user.isAdmin, isTeacher: true };
  }

  // Check Rewardful for "teacher" in name
  const lookupEmail = user?.internalEmail || normalizedEmail;
  const affiliateResult = await rewardfulApi.getAffiliateByEmail(lookupEmail);

  if (affiliateResult.success && affiliateResult.affiliate) {
    const firstName = affiliateResult.affiliate.first_name || '';
    if (firstName.toLowerCase().includes('teacher')) {
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { isTeacher: true },
        });
      }
      return { hasAccess: true, isAdmin: false, isTeacher: true };
    }
  }

  return { hasAccess: false, isAdmin: false, isTeacher: false, reason: 'not_teacher' };
}

// ============================================================================
// TEACHER DATA
// ============================================================================

/**
 * Get teacher data with context (dashboard load)
 */
export async function getTeacherDataWithContext(
  email: string,
  token: string
): Promise<ApiResponse & { data?: TeacherData }> {
  const normalizedEmail = normalizeEmail(email);

  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }
  if (sessionUser.aliasEmail !== normalizedEmail && !sessionUser.isAdmin) {
    return { success: false, error: 'Not authorized to view this teacher\'s data' };
  }

  const access = await verifyTeacherAccess(normalizedEmail);
  if (!access.hasAccess) {
    return { success: false, error: 'Not authorized as teacher' };
  }

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    // Get linked students with today's attendance
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const links = await prisma.teacherStudentLink.findMany({
      where: { teacherId: teacher.id, status: 'ACTIVE' },
      include: {
        student: {
          include: {
            attendanceProfile: {
              include: {
                records: {
                  where: {
                    date: { startsWith: todayStr },
                  },
                },
              },
            },
          },
        },
      },
    });

    const students = links.map((link) => {
      const todayRecords = link.student.attendanceProfile?.records || [];
      return {
        id: link.student.id,
        email: link.student.aliasEmail,
        internalEmail: link.student.internalEmail || undefined,
        name:
          [link.student.firstName, link.student.lastName].filter(Boolean).join(' ') ||
          link.student.aliasEmail,
        affiliateId: link.student.rewardfulAffiliateId || undefined,
        percentageOverride: link.percentageOverride,
        addedDate: link.createdAt.toISOString(),
        todayAttendance: {
          attended: todayRecords.length > 0,
          count: todayRecords.length,
        },
      };
    });

    // Get earnings from ledger
    const earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });

    const earningsData: TeacherEarningsData = {
      totalOwed: earnings?.totalOwed || 0,
      totalCredited: earnings?.totalCredited || 0,
      totalPaid: earnings?.totalPaid || 0,
      lastUpdatedAt: earnings?.lastUpdatedAt?.toISOString(),
    };

    const data: TeacherData = {
      teacher: {
        email: teacher.aliasEmail,
        name:
          [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') ||
          teacher.aliasEmail,
        isAdmin: teacher.isAdmin,
      },
      students,
      earnings: earningsData,
    };

    return { success: true, data };
  } catch (error) {
    log.error('Get teacher data error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to fetch teacher data' };
  }
}

/**
 * Get students commission data for teacher
 */
export async function getStudentsCommissionData(
  teacherEmail: string,
  token: string
): Promise<ApiResponse & { students?: StudentCommissionData[] }> {
  const normalizedEmail = normalizeEmail(teacherEmail);

  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }
  if (sessionUser.aliasEmail !== normalizedEmail && !sessionUser.isAdmin) {
    return { success: false, error: 'Not authorized to view this teacher\'s data' };
  }

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    const links = await prisma.teacherStudentLink.findMany({
      where: { teacherId: teacher.id, status: 'ACTIVE' },
      include: { student: true },
    });

    const students: StudentCommissionData[] = [];

    for (const link of links) {
      const studentInternalEmail = link.student.internalEmail || link.student.aliasEmail;
      const studentAliasEmail = link.student.aliasEmail;
      const pct = link.percentageOverride;
      const multiplier = pct / 100;

      const affiliateResult = await rewardfulApi.getAffiliateByEmail(studentInternalEmail);

      if (!affiliateResult.success || !affiliateResult.affiliate) {
        students.push({
          email: studentAliasEmail,
          name: [link.student.firstName, link.student.lastName].filter(Boolean).join(' ') || studentAliasEmail,
          totalUnpaid: 0, totalDueNow: 0, totalPaid: 0,
          unpaid30Days: 0, dueNow30Days: 0,
          teacherPercentage: pct,
          teacherCutUnpaid: 0, teacherCutDueNow: 0, teacherCut30Days: 0,
        });
        continue;
      }

      const affId = affiliateResult.affiliate.id;
      const totals = await rewardfulApi.getCommissionTotals(affId);
      const thirtyDay = await rewardfulApi.getCommissions30Day(affId);

      students.push({
        email: studentAliasEmail,
        name: [link.student.firstName, link.student.lastName].filter(Boolean).join(' ') || studentAliasEmail,
        totalUnpaid: totals.unpaid,
        totalDueNow: totals.dueNow,
        totalPaid: totals.paid,
        unpaid30Days: thirtyDay.unpaid,
        dueNow30Days: thirtyDay.dueNow,
        teacherPercentage: pct,
        teacherCutUnpaid: Math.round(totals.unpaid * multiplier * 100) / 100,
        teacherCutDueNow: Math.round(totals.dueNow * multiplier * 100) / 100,
        teacherCut30Days: Math.round(thirtyDay.unpaid * multiplier * 100) / 100,
      });
    }

    return { success: true, students };
  } catch (error) {
    log.error('Get students commission error', { error });
    return { success: false, error: 'Failed to fetch students data' };
  }
}

// ============================================================================
// STUDENT MANAGEMENT
// ============================================================================

/**
 * Add student to teacher with required percentage
 */
export async function addStudentToTeacherWithContext(
  teacherEmail: string,
  studentEmail: string,
  token: string,
  percentage?: number
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  if (percentage == null || percentage < 1 || percentage > 100) {
    return { success: false, error: 'Percentage is required and must be between 1 and 100' };
  }

  const normalizedTeacher = normalizeEmail(teacherEmail);
  const normalizedStudent = normalizeEmail(studentEmail);

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedTeacher },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    // Find student - check DB first
    let student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
    });

    if (!student) {
      // Verify student exists in Rewardful before creating
      const affiliateResult = await rewardfulApi.getAffiliateByEmail(normalizedStudent);
      if (!affiliateResult.success || !affiliateResult.affiliate) {
        return {
          success: false,
          error: 'Student email not found in the affiliate system. Please ensure the account is approved.',
        };
      }

      student = await prisma.user.create({
        data: {
          aliasEmail: normalizedStudent,
          email: normalizedStudent,
          internalEmail: normalizedStudent,
          firstName: affiliateResult.affiliate.first_name || null,
          lastName: affiliateResult.affiliate.last_name || null,
          rewardfulAffiliateId: affiliateResult.affiliate.id || null,
          accountStatus: 'ACTIVE',
        },
      });
    }

    // Check if link already exists
    const existingLink = await prisma.teacherStudentLink.findUnique({
      where: {
        teacherId_studentId: { teacherId: teacher.id, studentId: student.id },
      },
    });

    if (existingLink) {
      if (existingLink.status === 'ACTIVE') {
        return { success: false, error: 'Student already linked to this teacher' };
      }

      // Reactivate removed link with new percentage
      await prisma.teacherStudentLink.update({
        where: { id: existingLink.id },
        data: {
          status: 'ACTIVE',
          percentageOverride: percentage,
          removedAt: null,
          removedBy: null,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.teacherStudentLink.create({
        data: {
          teacherId: teacher.id,
          studentId: student.id,
          status: 'ACTIVE',
          createdBy: 'teacher',
          percentageOverride: percentage,
        },
      });
    }

    log.info('Student added to teacher', {
      teacher: normalizedTeacher,
      student: normalizedStudent,
      percentage,
    });

    return { success: true, message: 'Student added successfully' };
  } catch (error) {
    log.error('Add student error', { error });
    return { success: false, error: 'Failed to add student' };
  }
}

/**
 * Remove student from teacher (soft delete)
 */
export async function removeStudentFromTeacher(
  teacherEmail: string,
  studentEmail: string
): Promise<ApiResponse> {
  const normalizedTeacher = normalizeEmail(teacherEmail);
  const normalizedStudent = normalizeEmail(studentEmail);

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedTeacher },
    });

    const student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
    });

    if (!teacher || !student) {
      return { success: false, error: 'Teacher or student not found' };
    }

    await prisma.teacherStudentLink.updateMany({
      where: { teacherId: teacher.id, studentId: student.id },
      data: { status: 'REMOVED', removedAt: new Date(), removedBy: 'teacher' },
    });

    log.info('Student removed from teacher', {
      teacher: normalizedTeacher,
      student: normalizedStudent,
    });

    return { success: true, message: 'Student removed' };
  } catch (error) {
    log.error('Remove student error', { error });
    return { success: false, error: 'Failed to remove student' };
  }
}

/**
 * Set student percentage override (1-100)
 */
export async function setStudentPercentageOverride(
  teacherEmail: string,
  studentEmail: string,
  percentage: number
): Promise<ApiResponse> {
  const normalizedTeacher = normalizeEmail(teacherEmail);
  const normalizedStudent = normalizeEmail(studentEmail);

  if (percentage < 1 || percentage > 100) {
    return { success: false, error: 'Percentage must be between 1 and 100' };
  }

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedTeacher },
    });

    const student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
    });

    if (!teacher || !student) {
      return { success: false, error: 'Teacher or student not found' };
    }

    await prisma.teacherStudentLink.updateMany({
      where: { teacherId: teacher.id, studentId: student.id, status: 'ACTIVE' },
      data: { percentageOverride: percentage },
    });

    return { success: true, percentage };
  } catch (error) {
    log.error('Set percentage error', { error });
    return { success: false, error: 'Failed to set percentage' };
  }
}

// ============================================================================
// EARNINGS (Ledger-based)
// ============================================================================

/**
 * Get teacher earnings from ledger
 */
export async function getTeacherEarningsHistory(
  teacherEmail: string
): Promise<ApiResponse> {
  const normalizedEmail = normalizeEmail(teacherEmail);

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return {
        success: true,
        totalOwed: 0,
        totalCredited: 0,
        totalPaid: 0,
        lastUpdatedAt: null,
      };
    }

    const earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });

    return {
      success: true,
      totalOwed: earnings?.totalOwed || 0,
      totalCredited: earnings?.totalCredited || 0,
      totalPaid: earnings?.totalPaid || 0,
      lastUpdatedAt: earnings?.lastUpdatedAt?.toISOString() || null,
    } as ApiResponse;
  } catch (error) {
    log.error('Get teacher earnings error', { error });
    return { success: true, totalOwed: 0, totalCredited: 0, totalPaid: 0, lastUpdatedAt: null };
  }
}

/**
 * Refresh teacher's estimated earnings from live Rewardful data.
 * Display only — does NOT modify totalOwed (that's driven by webhooks).
 * Updates lastUpdatedAt timestamp.
 */
export async function refreshTeacherEstimate(
  teacherEmail: string,
  token: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const normalizedEmail = normalizeEmail(teacherEmail);

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    // Fetch live commission data for all students
    const studentsResult = await getStudentsCommissionData(normalizedEmail, token);
    const students = studentsResult.students || [];

    let totalUnpaid = 0; // Rewardful "unpaid" = pending + due combined
    let totalDueNow = 0; // Rewardful "due" = subset of unpaid ready to pay

    for (const student of students) {
      totalUnpaid += student.teacherCutUnpaid;
      totalDueNow += student.teacherCutDueNow;
    }

    // Update lastUpdatedAt only
    await prisma.teacherEarnings.upsert({
      where: { userId: teacher.id },
      create: { userId: teacher.id, lastUpdatedAt: new Date() },
      update: { lastUpdatedAt: new Date() },
    });

    // Rewardful "unpaid" already includes "due" — do NOT sum them.
    // pending-only = unpaid - due
    const pendingOnly = Math.round((totalUnpaid - totalDueNow) * 100) / 100;
    const dueNow = Math.round(totalDueNow * 100) / 100;
    const totalEstimate = Math.round(totalUnpaid * 100) / 100;

    log.info('Teacher estimate refreshed', {
      teacher: normalizedEmail,
      students: students.length,
      pendingOnly,
      dueNow,
      totalEstimate,
    });

    return {
      success: true,
      message: 'Estimate refreshed',
      estimatedUnpaid: pendingOnly,
      estimatedDueNow: dueNow,
      totalEstimate,
    };
  } catch (error) {
    log.error('Refresh estimate error', { error });
    return { success: false, error: 'Failed to refresh estimate' };
  }
}

// Keep backward-compatible alias
export const updateTeacherEarnings = refreshTeacherEstimate;

/**
 * Record admin payment to teacher (DEBIT ledger entry)
 */
export async function recordTeacherPayment(
  teacherEmail: string,
  amount: number,
  token: string
): Promise<ApiResponse> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const normalizedEmail = normalizeEmail(teacherEmail);

  if (amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    const { user: adminUser } = await getSessionUser(token);

    // Get or create earnings record
    let earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });

    if (!earnings) {
      earnings = await prisma.teacherEarnings.create({
        data: { userId: teacher.id },
      });
    }

    // Create DEBIT ledger entry
    await prisma.teacherLedgerEntry.create({
      data: {
        earningsId: earnings.id,
        type: 'DEBIT',
        amount,
        paidBy: adminUser?.aliasEmail,
        note: `Admin payment by ${adminUser?.aliasEmail}`,
      },
    });

    // Update running totals
    const newOwed = Math.max(0, earnings.totalOwed - amount);
    await prisma.teacherEarnings.update({
      where: { id: earnings.id },
      data: {
        totalOwed: newOwed,
        totalPaid: { increment: amount },
        lastUpdatedAt: new Date(),
      },
    });

    log.info('Teacher payment recorded', {
      teacher: normalizedEmail,
      amount,
      admin: adminUser?.aliasEmail,
      remainingOwed: newOwed,
    });

    return { success: true, message: 'Payment recorded', remainingOwed: newOwed };
  } catch (error) {
    log.error('Record payment error', { error });
    return { success: false, error: 'Failed to record payment' };
  }
}

// Keep backward-compatible alias
export const recordTeacherPayout = recordTeacherPayment;

// ============================================================================
// WEBHOOK PROCESSING
// ============================================================================

interface PayoutWebhookData {
  payoutId: string;
  affiliateEmail: string;
  affiliateId?: string;
  amountCents: number;
  currency: string;
  paidAt: string;
}

/**
 * Process a Rewardful payout.paid webhook event.
 * Finds all teachers who have this affiliate as a student,
 * creates idempotent CREDIT ledger entries for each.
 */
export async function processPayoutWebhook(
  data: PayoutWebhookData
): Promise<{ processed: boolean; message: string; creditsCreated?: number }> {
  const { payoutId, affiliateEmail, affiliateId, amountCents, currency, paidAt } = data;

  if (!payoutId || !affiliateEmail) {
    return { processed: false, message: 'Missing payoutId or affiliateEmail' };
  }

  log.info('Processing payout webhook', { payoutId, affiliateEmail, amountCents, currency });

  // Convert cents to dollars
  const amountDollars = amountCents / 100;

  // Convert to CAD if needed
  const isUsd = currency?.toUpperCase() === 'USD';
  const amountCad = isUsd
    ? Math.round(amountDollars * config.currency.usdToCadRate * 100) / 100
    : Math.round(amountDollars * 100) / 100;

  // Match affiliate to portal user
  const user = await findUserByRewardfulIdentity(affiliateEmail, affiliateId);

  if (!user) {
    log.warn('Webhook: no matching portal user', { affiliateEmail, affiliateId });
    return { processed: false, message: `No portal user found for ${affiliateEmail}` };
  }

  // Find all teachers who have this user as a student
  const teacherLinks = await prisma.teacherStudentLink.findMany({
    where: { studentId: user.id, status: 'ACTIVE' },
    include: { teacher: true },
  });

  if (teacherLinks.length === 0) {
    log.info('Webhook: affiliate has no teachers', { affiliateEmail, userId: user.id });
    return { processed: false, message: 'Affiliate has no teacher links' };
  }

  let creditsCreated = 0;

  for (const link of teacherLinks) {
    const teacherCut = Math.round(amountCad * (link.percentageOverride / 100) * 100) / 100;

    if (teacherCut <= 0) continue;

    // Get or create teacher earnings
    let earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: link.teacherId },
    });

    if (!earnings) {
      earnings = await prisma.teacherEarnings.create({
        data: { userId: link.teacherId },
      });
    }

    // Create idempotent CREDIT entry (unique on [rewardfulPayoutId, studentUserId])
    try {
      await prisma.teacherLedgerEntry.create({
        data: {
          earningsId: earnings.id,
          type: 'CREDIT',
          amount: teacherCut,
          currency: 'CAD',
          rewardfulPayoutId: payoutId,
          studentUserId: user.id,
          studentEmail: user.aliasEmail,
          percentageApplied: link.percentageOverride,
          payoutAmountCents: amountCents,
          payoutCurrency: currency,
        },
      });

      // Update running totals
      await prisma.teacherEarnings.update({
        where: { id: earnings.id },
        data: {
          totalOwed: { increment: teacherCut },
          totalCredited: { increment: teacherCut },
          lastUpdatedAt: new Date(),
        },
      });

      creditsCreated++;

      log.info('Webhook: credit created', {
        teacher: link.teacher.aliasEmail,
        student: user.aliasEmail,
        teacherCut,
        percentage: link.percentageOverride,
        payoutId,
      });
    } catch (error: unknown) {
      // Unique constraint violation = already processed (idempotent)
      const prismaError = error as { code?: string };
      if (prismaError.code === 'P2002') {
        log.info('Webhook: duplicate credit skipped', { payoutId, studentId: user.id, teacherId: link.teacherId });
      } else {
        throw error;
      }
    }
  }

  return {
    processed: true,
    message: `Created ${creditsCreated} credit(s) for ${teacherLinks.length} teacher(s)`,
    creditsCreated,
  };
}

/**
 * Find a portal user by Rewardful identity (affiliateId, internalEmail, aliasEmail, email)
 */
async function findUserByRewardfulIdentity(
  affiliateEmail: string,
  affiliateId?: string
): Promise<{ id: string; aliasEmail: string } | null> {
  const normalized = normalizeEmail(affiliateEmail);

  // Try by Rewardful affiliate ID first
  if (affiliateId) {
    const user = await prisma.user.findFirst({
      where: { rewardfulAffiliateId: affiliateId },
      select: { id: true, aliasEmail: true },
    });
    if (user) return user;
  }

  // Try by internalEmail (Rewardful email)
  const byInternal = await prisma.user.findFirst({
    where: { internalEmail: normalized },
    select: { id: true, aliasEmail: true },
  });
  if (byInternal) return byInternal;

  // Try by aliasEmail
  const byAlias = await prisma.user.findFirst({
    where: { aliasEmail: normalized },
    select: { id: true, aliasEmail: true },
  });
  if (byAlias) return byAlias;

  // Try by canonical email
  const byEmail = await prisma.user.findFirst({
    where: { email: normalized },
    select: { id: true, aliasEmail: true },
  });
  return byEmail;
}

// ============================================================================
// TEACHER LEDGER
// ============================================================================

/**
 * Get paginated transaction history for a teacher
 */
export async function getTeacherLedger(
  teacherEmail: string,
  token: string,
  page: number = 1,
  pageSize: number = 20
): Promise<ApiResponse & { entries?: LedgerEntryData[]; totalCount?: number; totalPages?: number }> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const normalizedEmail = normalizeEmail(teacherEmail);
  if (sessionUser.aliasEmail !== normalizedEmail && !sessionUser.isAdmin) {
    return { success: false, error: 'Not authorized' };
  }

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: true, entries: [], totalCount: 0, totalPages: 0 };
    }

    const earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });

    if (!earnings) {
      return { success: true, entries: [], totalCount: 0, totalPages: 0 };
    }

    const totalCount = await prisma.teacherLedgerEntry.count({
      where: { earningsId: earnings.id },
    });

    const entries = await prisma.teacherLedgerEntry.findMany({
      where: { earningsId: earnings.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const mapped: LedgerEntryData[] = entries.map((e) => ({
      id: e.id,
      type: e.type as 'CREDIT' | 'DEBIT',
      amount: e.amount,
      currency: e.currency,
      createdAt: e.createdAt.toISOString(),
      studentEmail: e.studentEmail || undefined,
      percentageApplied: e.percentageApplied || undefined,
      payoutAmountCents: e.payoutAmountCents || undefined,
      payoutCurrency: e.payoutCurrency || undefined,
      paidBy: e.paidBy || undefined,
      note: e.note || undefined,
    }));

    return {
      success: true,
      entries: mapped,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  } catch (error) {
    log.error('Get teacher ledger error', { error });
    return { success: false, error: 'Failed to fetch ledger' };
  }
}

// ============================================================================
// ADMIN: ALL TEACHERS PAYMENT DATA
// ============================================================================

/**
 * Get payment data for all teachers (admin only)
 */
export async function getAllTeachersPaymentData(
  token: string
): Promise<ApiResponse & { teachers?: TeacherPaymentInfo[] }> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  try {
    const teachers = await prisma.user.findMany({
      where: { isTeacher: true },
      select: {
        id: true,
        aliasEmail: true,
        firstName: true,
        lastName: true,
      },
    });

    const results: TeacherPaymentInfo[] = [];

    for (const teacher of teachers) {
      if (isAdminEmail(teacher.aliasEmail)) continue;

      const studentCount = await prisma.teacherStudentLink.count({
        where: { teacherId: teacher.id, status: 'ACTIVE' },
      });

      const earnings = await prisma.teacherEarnings.findUnique({
        where: { userId: teacher.id },
        include: {
          ledgerEntries: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      const name = `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() || teacher.aliasEmail;

      const recentEntries: LedgerEntryData[] = (earnings?.ledgerEntries || []).map((e) => ({
        id: e.id,
        type: e.type as 'CREDIT' | 'DEBIT',
        amount: e.amount,
        currency: e.currency,
        createdAt: e.createdAt.toISOString(),
        studentEmail: e.studentEmail || undefined,
        percentageApplied: e.percentageApplied || undefined,
        paidBy: e.paidBy || undefined,
        note: e.note || undefined,
      }));

      results.push({
        email: teacher.aliasEmail,
        name,
        studentCount,
        totalOwed: earnings?.totalOwed || 0,
        totalCredited: earnings?.totalCredited || 0,
        totalPaid: earnings?.totalPaid || 0,
        lastUpdatedAt: earnings?.lastUpdatedAt?.toISOString(),
        recentLedgerEntries: recentEntries,
      });
    }

    return { success: true, teachers: results };
  } catch (error) {
    log.error('Get all teachers payment data error', { error });
    return { success: false, error: 'Failed to load teacher data' };
  }
}

// ============================================================================
// BACKFILL: Historical paid commissions → teacher ledger
// ============================================================================

/**
 * Backfill teacher ledger from ALL historical paid commissions in Rewardful.
 * For each student, fetches every paid commission, creates idempotent CREDIT
 * entries (using commission ID as rewardfulPayoutId), then recalculates totals
 * from the full ledger.
 *
 * Admin-only. Safe to run multiple times (idempotent via unique constraint).
 */
export async function backfillTeacherEarnings(
  teacherEmail: string,
  token: string
): Promise<ApiResponse & { creditsCreated?: number; totalCredited?: number; totalOwed?: number }> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const normalizedEmail = normalizeEmail(teacherEmail);

  try {
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    // Get or create earnings record
    let earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });
    if (!earnings) {
      earnings = await prisma.teacherEarnings.create({
        data: { userId: teacher.id },
      });
    }

    const links = await prisma.teacherStudentLink.findMany({
      where: { teacherId: teacher.id, status: 'ACTIVE' },
      include: { student: true },
    });

    let creditsCreated = 0;
    const conversionRate = config.currency.usdToCadRate;

    for (const link of links) {
      const studentInternalEmail = link.student.internalEmail || link.student.aliasEmail;
      const affiliateResult = await rewardfulApi.getAffiliateByEmail(studentInternalEmail);

      if (!affiliateResult.success || !affiliateResult.affiliate) {
        log.info('Backfill: no affiliate found', { student: link.student.aliasEmail });
        continue;
      }

      const affId = affiliateResult.affiliate.id;

      // Fetch all paid commissions via raw commission listing
      let page = 1;
      const maxPages = 20;
      while (page <= maxPages) {
        let pageItems: Record<string, unknown>[] = [];

        try {
          const commResponse = await fetch(
            `${config.rewardful.baseUrl}/commissions?affiliate_id=${encodeURIComponent(affId)}&page=${page}&limit=200`,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(`${config.rewardful.apiKey}:`).toString('base64')}`,
                'Content-Type': 'application/json',
              },
            }
          );

          if (!commResponse.ok) break;

          const commData = await commResponse.json();
          if (Array.isArray(commData)) {
            pageItems = commData;
          } else if (commData?.data && Array.isArray(commData.data)) {
            pageItems = commData.data;
          }
        } catch {
          log.error('Backfill: commission fetch failed', { page, affId });
          break;
        }

        if (pageItems.length === 0) break;

        for (const c of pageItems) {
          const state = ((c.state || c.status || '') as string).toLowerCase();
          if (state !== 'paid') continue;

          const commissionId = c.id as string;
          if (!commissionId) continue;

          const amountCents = Number(c.amount || c.commission_amount || 0);
          const currIso = ((c.currency || c.currency_iso || 'USD') as string).toUpperCase();

          // Convert cents → dollars → CAD
          let amountCad = amountCents / 100;
          if (currIso === 'USD') {
            amountCad = amountCad * conversionRate;
          }
          amountCad = Math.round(amountCad * 100) / 100;

          const teacherCut = Math.round(amountCad * (link.percentageOverride / 100) * 100) / 100;
          if (teacherCut <= 0) continue;

          // Create idempotent CREDIT entry (commission ID as rewardfulPayoutId)
          try {
            await prisma.teacherLedgerEntry.create({
              data: {
                earningsId: earnings.id,
                type: 'CREDIT',
                amount: teacherCut,
                currency: 'CAD',
                rewardfulPayoutId: commissionId,
                studentUserId: link.student.id,
                studentEmail: link.student.aliasEmail,
                percentageApplied: link.percentageOverride,
                payoutAmountCents: amountCents,
                payoutCurrency: currIso,
                note: 'Historical backfill',
              },
            });
            creditsCreated++;
          } catch (error: unknown) {
            const prismaError = error as { code?: string };
            if (prismaError.code === 'P2002') {
              // Already exists — skip (idempotent)
            } else {
              throw error;
            }
          }
        }

        if (pageItems.length < 200) break;
        page++;
      }
    }

    // Recalculate totals from the full ledger
    const creditSum = await prisma.teacherLedgerEntry.aggregate({
      where: { earningsId: earnings.id, type: 'CREDIT' },
      _sum: { amount: true },
    });
    const debitSum = await prisma.teacherLedgerEntry.aggregate({
      where: { earningsId: earnings.id, type: 'DEBIT' },
      _sum: { amount: true },
    });

    const totalCredited = Math.round((creditSum._sum.amount || 0) * 100) / 100;
    const totalPaid = Math.round((debitSum._sum.amount || 0) * 100) / 100;
    const totalOwed = Math.round((totalCredited - totalPaid) * 100) / 100;

    await prisma.teacherEarnings.update({
      where: { id: earnings.id },
      data: {
        totalCredited,
        totalPaid,
        totalOwed,
        lastUpdatedAt: new Date(),
      },
    });

    log.info('Backfill complete', {
      teacher: normalizedEmail,
      creditsCreated,
      totalCredited,
      totalOwed,
    });

    return { success: true, creditsCreated, totalCredited, totalOwed };
  } catch (error) {
    log.error('Backfill teacher earnings error', { error });
    return { success: false, error: 'Failed to backfill earnings' };
  }
}
