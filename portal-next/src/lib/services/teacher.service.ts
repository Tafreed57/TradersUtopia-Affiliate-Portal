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
      const studentEmail = link.student.internalEmail || link.student.aliasEmail;

      // Fetch commission data
      const affiliateResult = await rewardfulApi.getAffiliateByEmail(studentEmail);
      if (!affiliateResult.success || !affiliateResult.affiliate) {
        continue;
      }

      const commissions = await rewardfulApi.getCommissionTotals(
        affiliateResult.affiliate.id
      );

      const percentage = link.percentageOverride || 100;
      const multiplier = percentage / 100;

      students.push({
        email: link.student.aliasEmail,
        name:
          [link.student.firstName, link.student.lastName].filter(Boolean).join(' ') ||
          link.student.aliasEmail,
        rawDueNow: commissions.dueNow,
        adjustedDueNow: commissions.dueNow * multiplier,
        percentage,
        last30DaysRaw: 0, // TODO: Calculate 30-day commissions
        last30DaysAdjusted: 0,
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

    // Find or create student
    let student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
    });

    if (!student) {
      // Try to find affiliate
      const affiliateResult = await rewardfulApi.getAffiliateByEmail(normalizedStudent);

      student = await prisma.user.create({
        data: {
          aliasEmail: normalizedStudent,
          email: normalizedStudent,
          internalEmail: normalizedStudent,
          firstName: affiliateResult.affiliate?.first_name || null,
          lastName: affiliateResult.affiliate?.last_name || null,
          rewardfulAffiliateId: affiliateResult.affiliate?.id || null,
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

    // Calculate current earnings from students
    // This is a simplified version - full implementation would sum student commissions
    const links = await prisma.teacherStudentLink.findMany({
      where: { teacherId: teacher.id, status: 'ACTIVE' },
    });

    // For now, just update the locked timestamp
    await prisma.teacherEarnings.upsert({
      where: { userId: teacher.id },
      create: {
        userId: teacher.id,
        lockedEarnings: 0,
        lockedAt: new Date(),
      },
      update: {
        lockedAt: new Date(),
      },
    });

    return { success: true, message: 'Earnings updated' };
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
