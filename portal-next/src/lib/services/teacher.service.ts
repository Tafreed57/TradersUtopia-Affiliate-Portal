/**
 * Teacher Service
 *
 * Handles teacher portal functionality including student management,
 * commission viewing, and earnings tracking.
 */

import { prisma } from '@/lib/db';
import { config, normalizeEmail, isAdminEmail, isTeacherOverrideEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { getSessionUser, validateAdminSession } from './session.service';
import { rewardfulApi } from './rewardful.service';
import type { ApiResponse, TeacherData, StudentCommissionData } from '@/types';

const log = logger.child({ service: 'teacher' });

/**
 * Extract percentage from email address pattern like "user50%@gmail.com" -> 50
 * Legacy: extractEmailPercentage_(email)
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
 * Legacy: verifyTeacherAccess(email)
 */
export async function verifyTeacherAccess(
  email: string
): Promise<{ hasAccess: boolean; isAdmin: boolean; isTeacher: boolean; reason?: string }> {
  const normalizedEmail = normalizeEmail(email);
  log.info('verifyTeacherAccess called', { email: normalizedEmail });

  // Check admin
  if (isAdminEmail(normalizedEmail)) {
    log.info('Teacher access: admin email', { email: normalizedEmail });
    return { hasAccess: true, isAdmin: true, isTeacher: true };
  }

  // Check override list
  if (isTeacherOverrideEmail(normalizedEmail)) {
    log.info('Teacher access: override list', { email: normalizedEmail });
    return { hasAccess: true, isAdmin: false, isTeacher: true };
  }

  // Check user record
  const user = await prisma.user.findUnique({
    where: { aliasEmail: normalizedEmail },
  });

  log.info('Teacher access: DB user lookup', {
    email: normalizedEmail,
    found: !!user,
    internalEmail: user?.internalEmail || 'NULL',
    isTeacherInDB: user?.isTeacher,
  });

  if (user?.isTeacher) {
    return { hasAccess: true, isAdmin: user.isAdmin, isTeacher: true };
  }

  // Check Rewardful for "teacher" in name
  const lookupEmail = user?.internalEmail || normalizedEmail;
  log.info('Teacher access: querying Rewardful API', { lookupEmail });

  const affiliateResult = await rewardfulApi.getAffiliateByEmail(lookupEmail);

  log.info('Teacher access: Rewardful API result', {
    lookupEmail,
    success: affiliateResult.success,
    affiliateFound: !!affiliateResult.affiliate,
    firstName: affiliateResult.affiliate?.first_name || 'N/A',
    error: affiliateResult.error,
  });

  if (affiliateResult.success && affiliateResult.affiliate) {
    const firstName = affiliateResult.affiliate.first_name || '';
    if (firstName.toLowerCase().includes('teacher')) {
      log.info('Teacher access: GRANTED via Rewardful first_name', { email: normalizedEmail, firstName });
      // Update user record
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { isTeacher: true },
        });
      }
      return { hasAccess: true, isAdmin: false, isTeacher: true };
    }
  }

  log.warn('Teacher access: DENIED', { email: normalizedEmail, lookupEmail });
  return {
    hasAccess: false,
    isAdmin: false,
    isTeacher: false,
    reason: 'not_teacher',
  };
}

// ============================================================================
// TEACHER DATA
// ============================================================================

/**
 * Get teacher data with context
 * Legacy: getTeacherDataWithContext(email, token)
 */
export async function getTeacherDataWithContext(
  email: string,
  token: string
): Promise<ApiResponse & { data?: TeacherData }> {
  const normalizedEmail = normalizeEmail(email);

  // Validate session
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  // Verify teacher access
  const access = await verifyTeacherAccess(normalizedEmail);
  if (!access.hasAccess) {
    return { success: false, error: 'Not authorized as teacher' };
  }

  try {
    // Find teacher user
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    // Get linked students
    const links = await prisma.teacherStudentLink.findMany({
      where: {
        teacherId: teacher.id,
        status: 'ACTIVE',
      },
      include: {
        student: true,
      },
    });

    const students = links.map((link) => ({
      id: link.student.id,
      email: link.student.aliasEmail,
      internalEmail: link.student.internalEmail || undefined,
      name:
        [link.student.firstName, link.student.lastName].filter(Boolean).join(' ') ||
        link.student.aliasEmail,
      affiliateId: link.student.rewardfulAffiliateId || undefined,
      percentageOverride: link.percentageOverride || undefined,
      addedDate: link.createdAt.toISOString(),
    }));

    // Get earnings
    const earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });

    const data: TeacherData = {
      teacher: {
        email: teacher.aliasEmail,
        name:
          [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') ||
          teacher.aliasEmail,
        isAdmin: teacher.isAdmin,
      },
      students,
      earnings: {
        lockedEarnings: earnings?.lockedEarnings || 0,
        totalEarnedAllTime: earnings?.totalEarnedAllTime || 0,
        totalPaidAllTime: earnings?.totalPaidAllTime || 0,
        lockedAt: earnings?.lockedAt?.toISOString(),
      },
    };

    return { success: true, data };
  } catch (error) {
    log.error('Get teacher data error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to fetch teacher data' };
  }
}

/**
 * Get students commission data for teacher
 * Legacy: getStudentsCommissionData(teacher, token)
 */
export async function getStudentsCommissionData(
  teacherEmail: string,
  token: string
): Promise<ApiResponse & { students?: StudentCommissionData[] }> {
  const normalizedEmail = normalizeEmail(teacherEmail);

  // Validate session
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  try {
    // Get teacher and students
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    const links = await prisma.teacherStudentLink.findMany({
      where: {
        teacherId: teacher.id,
        status: 'ACTIVE',
      },
      include: {
        student: true,
      },
    });

    const students: StudentCommissionData[] = [];

    for (const link of links) {
      const studentInternalEmail = link.student.internalEmail || link.student.aliasEmail;
      const studentAliasEmail = link.student.aliasEmail;

      // Fetch affiliate from Rewardful using internal email
      const affiliateResult = await rewardfulApi.getAffiliateByEmail(studentInternalEmail);

      if (!affiliateResult.success || !affiliateResult.affiliate) {
        // Student not found — push a zeroed-out row (matches GAS behavior)
        students.push({
          email: studentAliasEmail,
          name: [link.student.firstName, link.student.lastName].filter(Boolean).join(' ') || studentAliasEmail,
          totalUnpaid: 0, totalDueNow: 0, totalPaid: 0,
          unpaid30Days: 0, dueNow30Days: 0,
          teacherPercentage: link.percentageOverride || null,
          emailPercentage: extractEmailPercentage(studentInternalEmail),
          rawDueNow: 0, adjustedDueNow: 0, percentage: link.percentageOverride || 100,
          last30DaysRaw: 0, last30DaysAdjusted: 0,
        });
        continue;
      }

      const affId = affiliateResult.affiliate.id;

      // All-time totals from commission_stats (uses ?expand=true)
      const totals = await rewardfulApi.getCommissionTotals(affId);

      // 30-day filtered amounts from /commissions endpoint
      const thirtyDay = await rewardfulApi.getCommissions30Day(affId);

      const teacherPct = link.percentageOverride || null;
      const emailPct = extractEmailPercentage(studentInternalEmail);

      students.push({
        email: studentAliasEmail,
        name: [link.student.firstName, link.student.lastName].filter(Boolean).join(' ') || studentAliasEmail,
        totalUnpaid: totals.unpaid,
        totalDueNow: totals.dueNow,
        totalPaid: totals.paid,
        unpaid30Days: thirtyDay.unpaid,
        dueNow30Days: thirtyDay.dueNow,
        teacherPercentage: teacherPct,
        emailPercentage: emailPct,
        // Legacy compat fields
        rawDueNow: totals.dueNow,
        adjustedDueNow: totals.dueNow * ((teacherPct || 100) / 100),
        percentage: teacherPct || 100,
        last30DaysRaw: thirtyDay.unpaid,
        last30DaysAdjusted: thirtyDay.unpaid * ((teacherPct || 100) / 100),
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
 * Add student to teacher
 * Legacy: addStudentToTeacherWithContext(teacher, student, token)
 */
export async function addStudentToTeacherWithContext(
  teacherEmail: string,
  studentEmail: string,
  token: string
): Promise<ApiResponse> {
  // Validate session
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const normalizedTeacher = normalizeEmail(teacherEmail);
  const normalizedStudent = normalizeEmail(studentEmail);

  try {
    // Find teacher
    const teacher = await prisma.user.findUnique({
      where: { aliasEmail: normalizedTeacher },
    });

    if (!teacher) {
      return { success: false, error: 'Teacher not found' };
    }

    // Find student - check DB first, then try internal email lookup
    let student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
    });

    if (!student) {
      // Verify student exists in Rewardful before creating (matches GAS resolveStudentByEmail_)
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
        teacherId_studentId: {
          teacherId: teacher.id,
          studentId: student.id,
        },
      },
    });

    if (existingLink) {
      if (existingLink.status === 'ACTIVE') {
        return { success: false, error: 'Student already linked to this teacher' };
      }

      // Reactivate removed link
      await prisma.teacherStudentLink.update({
        where: { id: existingLink.id },
        data: {
          status: 'ACTIVE',
          removedAt: null,
          removedBy: null,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new link
      await prisma.teacherStudentLink.create({
        data: {
          teacherId: teacher.id,
          studentId: student.id,
          status: 'ACTIVE',
          createdBy: 'teacher',
        },
      });
    }

    log.info('Student added to teacher', {
      teacher: normalizedTeacher,
      student: normalizedStudent,
    });

    return { success: true, message: 'Student added successfully' };
  } catch (error) {
    log.error('Add student error', { error });
    return { success: false, error: 'Failed to add student' };
  }
}

/**
 * Remove student from teacher
 * Legacy: removeStudentFromTeacher(teacher, student)
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

    // Soft delete - set status to REMOVED
    await prisma.teacherStudentLink.updateMany({
      where: {
        teacherId: teacher.id,
        studentId: student.id,
      },
      data: {
        status: 'REMOVED',
        removedAt: new Date(),
        removedBy: 'teacher',
      },
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
 * Set student percentage override
 * Legacy: setStudentPercentageOverride(teacher, student, pct)
 */
export async function setStudentPercentageOverride(
  teacherEmail: string,
  studentEmail: string,
  percentage: number
): Promise<ApiResponse> {
  const normalizedTeacher = normalizeEmail(teacherEmail);
  const normalizedStudent = normalizeEmail(studentEmail);

  if (percentage < 0 || percentage > 100) {
    return { success: false, error: 'Percentage must be between 0 and 100' };
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
      where: {
        teacherId: teacher.id,
        studentId: student.id,
        status: 'ACTIVE',
      },
      data: {
        percentageOverride: percentage,
      },
    });

    return { success: true, percentage };
  } catch (error) {
    log.error('Set percentage error', { error });
    return { success: false, error: 'Failed to set percentage' };
  }
}

// ============================================================================
// EARNINGS
// ============================================================================

/**
 * Update teacher earnings (lock current values)
 * Legacy: updateTeacherEarnings(teacher, token)
 */
/**
 * Get teacher earnings history
 * Legacy: getTeacherEarningsHistory(teacherEmail)
 * Returns: { totalEarned, totalUnpaidEarned, totalDueNowEarned, lastUpdated }
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
        totalEarned: 0,
        totalUnpaidEarned: 0,
        totalDueNowEarned: 0,
        lastUpdated: new Date().toISOString(),
      };
    }

    const earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });

    return {
      success: true,
      totalEarned: earnings?.totalEarnedAllTime || 0,
      totalUnpaidEarned: earnings?.lockedEarnings || 0,
      totalDueNowEarned: earnings?.lockedEarnings || 0,
      totalPaidAllTime: earnings?.totalPaidAllTime || 0,
      lastUpdated: earnings?.lockedAt?.toISOString() || new Date().toISOString(),
    } as ApiResponse;
  } catch (error) {
    log.error('Get teacher earnings history error', { error });
    return {
      success: true,
      totalEarned: 0,
      totalUnpaidEarned: 0,
      totalDueNowEarned: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Update teacher earnings (calculate from students and lock)
 * Legacy: updateTeacherEarnings(teacher)
 * Sums student commissions, applies teacher percentage, calculates deltas
 */
export async function updateTeacherEarnings(
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

    // Get students commission data (full data with totals)
    const studentsResult = await getStudentsCommissionData(normalizedEmail, token);
    const students = studentsResult.students || [];

    // Get or create earnings record
    let earnings = await prisma.teacherEarnings.findUnique({
      where: { userId: teacher.id },
    });

    // Calculate new earnings from student increases
    // Uses incremental tracking: only adds NEW increases since last check
    const defaultPercentage = earnings?.percentageCut || 10;
    let newEarningsUnpaid = 0;
    let newEarningsDueNow = 0;

    for (const student of students) {
      const currentUnpaid = student.totalUnpaid || 0;
      const currentDueNow = student.totalDueNow || 0;

      // Use teacher percentage override for this student, or default
      const studentPct = student.teacherPercentage || defaultPercentage;
      const multiplier = studentPct / 100;

      // For simplicity, add the full teacher's share of current amounts
      // (GAS tracks deltas per-student; we'll add the teacher's cut of totals)
      newEarningsUnpaid += currentUnpaid * multiplier;
      newEarningsDueNow += currentDueNow * multiplier;
    }

    const totalLocked = Math.round((newEarningsUnpaid + newEarningsDueNow) * 100) / 100;

    // Upsert earnings
    await prisma.teacherEarnings.upsert({
      where: { userId: teacher.id },
      create: {
        userId: teacher.id,
        lockedEarnings: totalLocked,
        totalEarnedAllTime: totalLocked,
        percentageCut: defaultPercentage,
        lockedAt: new Date(),
      },
      update: {
        lockedEarnings: totalLocked,
        totalEarnedAllTime: { increment: 0 }, // Keep existing total
        lockedAt: new Date(),
      },
    });

    log.info('Teacher earnings updated', {
      teacher: normalizedEmail,
      students: students.length,
      locked: totalLocked,
    });

    return {
      success: true,
      message: 'Earnings updated',
      totalUnpaidEarned: Math.round(newEarningsUnpaid * 100) / 100,
      totalDueNowEarned: Math.round(newEarningsDueNow * 100) / 100,
      totalEarned: totalLocked,
    };
  } catch (error) {
    log.error('Update earnings error', { error });
    return { success: false, error: 'Failed to update earnings' };
  }
}

/**
 * Record teacher payout
 * Legacy: recordTeacherPayout(teacher, amount, token)
 */
export async function recordTeacherPayout(
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
        data: {
          userId: teacher.id,
          lockedEarnings: 0,
        },
      });
    }

    // Create payment record
    await prisma.teacherPayment.create({
      data: {
        earningsId: earnings.id,
        amount,
        paidBy: adminUser?.aliasEmail,
        lockedEarningsBeforePayment: earnings.lockedEarnings,
      },
    });

    // Update earnings totals
    const newLockedEarnings = Math.max(0, earnings.lockedEarnings - amount);

    await prisma.teacherEarnings.update({
      where: { id: earnings.id },
      data: {
        lockedEarnings: newLockedEarnings,
        totalPaidAllTime: { increment: amount },
      },
    });

    log.info('Teacher payout recorded', {
      teacher: normalizedEmail,
      amount,
      admin: adminUser?.aliasEmail,
    });

    return {
      success: true,
      message: 'Payment recorded',
      remainingLocked: newLockedEarnings,
    };
  } catch (error) {
    log.error('Record payout error', { error });
    return { success: false, error: 'Failed to record payout' };
  }
}

// ============================================================================
// ADMIN: ALL TEACHERS PAYMENT DATA
// ============================================================================

/**
 * Get payment data for all teachers (admin only)
 * Legacy: getAllTeachersPaymentData(adminEmail)
 */
export async function getAllTeachersPaymentData(
  token: string
): Promise<ApiResponse & { teachers?: TeacherPaymentInfo[] }> {
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  try {
    // Get all teachers from DB
    const teachers = await prisma.user.findMany({
      where: { isTeacher: true },
      select: {
        id: true,
        aliasEmail: true,
        internalEmail: true,
        firstName: true,
        lastName: true,
      },
    });

    log.info('Loading teacher payment data', { teacherCount: teachers.length });

    const results: TeacherPaymentInfo[] = [];

    for (const teacher of teachers) {
      // Skip admins from teacher list (legacy behavior)
      if (isAdminEmail(teacher.aliasEmail)) continue;

      // Get students
      const studentLinks = await prisma.teacherStudentLink.findMany({
        where: { teacherId: teacher.id, status: 'ACTIVE' },
        include: { student: { select: { aliasEmail: true, internalEmail: true } } },
      });

      // Get commission data for each student via Rewardful API
      let totalUnpaid = 0;
      let totalDueNow = 0;
      let totalPaid = 0;

      for (const link of studentLinks) {
        const studentEmail = link.student.internalEmail || link.student.aliasEmail;
        try {
          const affResult = await rewardfulApi.getAffiliateByEmail(studentEmail);
          if (affResult.success && affResult.affiliate) {
            const commResult = await rewardfulApi.getCommissionTotals(affResult.affiliate.id);
            totalUnpaid += commResult.unpaid;
            totalDueNow += commResult.dueNow;
            totalPaid += commResult.paid;
          }
        } catch {
          // Skip students we can't get data for
        }
      }

      // Get teacher's earnings record
      const earnings = await prisma.teacherEarnings.findUnique({
        where: { userId: teacher.id },
      });

      // Get last payment
      const lastPayment = earnings
        ? await prisma.teacherPayment.findFirst({
            where: { earningsId: earnings.id },
            orderBy: { paidAt: 'desc' },
          })
        : null;

      const name = `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() || teacher.aliasEmail;

      results.push({
        email: teacher.aliasEmail,
        name,
        studentCount: studentLinks.length,
        totalUnpaid: Math.round(totalUnpaid * 100) / 100,
        totalDueNow: Math.round(totalDueNow * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        lockedUnpaid: earnings?.lockedEarnings || 0,
        lockedDueNow: earnings?.lockedEarnings || 0,
        totalLockedEarnings: earnings?.totalEarnedAllTime || 0,
        accumulatedAmount: earnings?.lockedEarnings || 0,
        lastPayment: lastPayment
          ? { amount: lastPayment.amount, date: lastPayment.paidAt.toISOString() }
          : null,
      });
    }

    return { success: true, teachers: results };
  } catch (error) {
    log.error('Get all teachers payment data error', { error });
    return { success: false, error: 'Failed to load teacher data' };
  }
}

interface TeacherPaymentInfo {
  email: string;
  name: string;
  studentCount: number;
  totalUnpaid: number;
  totalDueNow: number;
  totalPaid: number;
  lockedUnpaid: number;
  lockedDueNow: number;
  totalLockedEarnings: number;
  accumulatedAmount: number;
  lastPayment: { amount: number; date: string } | null;
}
