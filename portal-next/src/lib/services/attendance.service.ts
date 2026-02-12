/**
 * Attendance Service
 *
 * Handles student attendance tracking, confirmation, and teacher assignment.
 */

import { prisma } from '@/lib/db';
import { config, normalizeEmail, isAdminEmail, isTeacherOverrideEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { getSessionUser } from './session.service';
import { rewardfulApi } from './rewardful.service';
import type { ApiResponse, AttendanceData, AttendanceRecord, TeacherOption } from '@/types';

const log = logger.child({ service: 'attendance' });

// ============================================================================
// ATTENDANCE LOGIN
// ============================================================================

/**
 * Login to attendance portal with email
 * Legacy: loginAttendanceWithEmail(email)
 */
export async function loginAttendanceWithEmail(
  email: string
): Promise<ApiResponse & {
  needsTeacherSelection?: boolean;
  isAdmin?: boolean;
  isTeacher?: boolean;
  user?: { email: string; name: string; teacherEmail?: string; isTeacher?: boolean; isAdmin?: boolean };
}> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }

  // Check for legacy email
  if (normalizedEmail.includes('%')) {
    const user = await prisma.user.findFirst({
      where: { internalEmail: normalizedEmail },
    });

    return {
      success: false,
      error: 'This is an internal email. Please use your login email.',
      isLegacyEmail: true,
      aliasEmail: user?.aliasEmail,
    };
  }

  try {
    // Find user in DB
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: { attendanceProfile: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if admin
    const isAdmin = isAdminEmail(normalizedEmail);

    // Check teacher status (matches GAS: checks override list + Rewardful first_name)
    let isTeacher = user.isTeacher;
    if (!isTeacher && !isAdmin) {
      if (isTeacherOverrideEmail(normalizedEmail)) {
        isTeacher = true;
      } else {
        // Check Rewardful first_name for "teacher"
        const emailForApi = user.internalEmail || normalizedEmail;
        try {
          const affResult = await rewardfulApi.getAffiliateByEmail(emailForApi);
          if (affResult.success && affResult.affiliate) {
            const firstName = affResult.affiliate.first_name || '';
            isTeacher = firstName.toLowerCase().includes('teacher');
          }
        } catch {
          // Silent — use DB value
        }
      }
    }

    // Get name
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || normalizedEmail;

    // Check if teacher is assigned
    const teacherEmail = user.attendanceProfile?.currentTeacherEmail;
    const hasTeacher = !!teacherEmail && teacherEmail !== 'none';
    // Teachers who selected "none" don't need teacher selection
    const needsTeacherSelection = !hasTeacher && !isAdmin && !isTeacher;

    return {
      success: true,
      needsTeacherSelection,
      isAdmin,
      isTeacher,
      user: {
        email: normalizedEmail,
        name,
        teacherEmail: teacherEmail || undefined,
        isTeacher,
        isAdmin,
      },
    };
  } catch (error) {
    log.error('Login attendance error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to login' };
  }
}

/**
 * Complete login with teacher selection
 * Legacy: completeAttendanceLoginWithTeacher(email, teacher)
 */
export async function completeAttendanceLoginWithTeacher(
  email: string,
  teacherEmail: string
): Promise<ApiResponse> {
  const result = await setTeacherForAttendanceUser(email, teacherEmail);
  return result;
}

// ============================================================================
// ATTENDANCE DATA
// ============================================================================

/**
 * Get attendance data with missed days calculation
 * Legacy: getAttendanceData(email, token)
 */
export async function getAttendanceData(
  email: string,
  token: string
): Promise<ApiResponse & { data?: AttendanceData }> {
  const normalizedEmail = normalizeEmail(email);

  // Validate session
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  try {
    // Find user with attendance profile
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
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

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Create profile if doesn't exist
    let profile = user.attendanceProfile;
    if (!profile) {
      profile = await prisma.attendanceProfile.create({
        data: {
          userId: user.id,
        },
        include: { records: true },
      });
    }

    // Build records with missed days calculation
    const records: AttendanceRecord[] = [];
    const confirmedDates = new Set<string>();

    // Add confirmed records
    // Records can have date as "2026-02-12" (first) or "2026-02-12T01:17:00.000Z" (subsequent)
    for (const record of profile.records) {
      const baseDate = record.date.split('T')[0]; // Extract YYYY-MM-DD from any format
      const isAdditional = record.date.includes('T');
      records.push({
        date: record.date,
        confirmedAt: record.confirmedAt.toISOString(),
        type: 'confirmed',
        teacherEmail: record.teacherEmail || undefined,
        id: record.id, // Include ID so users can delete specific records
      });
      confirmedDates.add(baseDate); // Track by base date for missed days calculation
    }

    // Calculate missed days
    if (profile.records.length > 0) {
      const firstDate = new Date(
        Math.min(...profile.records.map((r) => new Date(r.date).getTime()))
      );
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const currentDate = new Date(firstDate);
      while (currentDate <= today) {
        const dateStr = currentDate.toISOString().split('T')[0];

        // Skip weekends (optional)
        const dayOfWeek = currentDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        if (!isWeekend && !confirmedDates.has(dateStr)) {
          // Check if it's not today (can't miss today yet)
          if (currentDate < today) {
            records.push({
              date: dateStr,
              confirmedAt: '',
              type: 'missed',
            });
          }
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // Sort by date descending
    records.sort((a, b) => b.date.localeCompare(a.date));

    // Calculate stats
    const confirmedCount = records.filter((r) => r.type === 'confirmed').length;
    const missedCount = records.filter((r) => r.type === 'missed').length;

    // Calculate streak
    let streak = 0;
    const sortedConfirmed = profile.records
      .map((r) => r.date)
      .sort()
      .reverse();

    if (sortedConfirmed.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      let checkDate = today;

      for (const date of sortedConfirmed) {
        if (date === checkDate || date === getPreviousWeekday(checkDate)) {
          streak++;
          checkDate = getPreviousWeekday(date);
        } else {
          break;
        }
      }
    }

    const data: AttendanceData = {
      user: {
        email: normalizedEmail,
        teacherEmail: profile.currentTeacherEmail || undefined,
        createdAt: profile.createdAt.toISOString(),
      },
      records,
      stats: {
        totalConfirmed: confirmedCount,
        totalMissed: missedCount,
        streak,
        firstConfirmationDate: sortedConfirmed[sortedConfirmed.length - 1],
      },
      needsTeacherAssignment: !profile.currentTeacherEmail,
    };

    return { success: true, data };
  } catch (error) {
    log.error('Get attendance data error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to get attendance data' };
  }
}

/**
 * Helper: Get previous weekday
 */
function getPreviousWeekday(dateStr: string): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - 1);

  // Skip weekends
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() - 1);
  }

  return date.toISOString().split('T')[0];
}

// ============================================================================
// ATTENDANCE CONFIRMATION
// ============================================================================

/**
 * Confirm attendance for a date
 * Legacy: confirmAttendance(email, dateStr, token)
 */
export async function confirmAttendance(
  email: string,
  dateStr: string,
  token: string
): Promise<ApiResponse> {
  const normalizedEmail = normalizeEmail(email);

  // Validate session
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { success: false, error: 'Invalid date format. Use YYYY-MM-DD' };
  }

  try {
    // Find user with attendance profile
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: { attendanceProfile: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Create profile if needed
    let profile = user.attendanceProfile;
    if (!profile) {
      profile = await prisma.attendanceProfile.create({
        data: { userId: user.id },
      });
    }

    // Validate teacher assignment (matches GAS: ensures student still has a valid teacher)
    const teacherEmail = profile.currentTeacherEmail;
    if (!teacherEmail) {
      return { success: false, error: 'No teacher assigned. Please select a teacher first.' };
    }

    // Teachers who selected "none" can skip teacher validation
    if (teacherEmail !== 'none') {
      // Verify teacher-student link still exists
      const teacher = await prisma.user.findUnique({
        where: { aliasEmail: teacherEmail },
      });
      if (teacher) {
        const link = await prisma.teacherStudentLink.findFirst({
          where: {
            teacherId: teacher.id,
            studentId: user.id,
            status: 'ACTIVE',
          },
        });
        if (!link) {
          // Student was removed by teacher — require re-selection
          return {
            success: false,
            error: 'Your teacher has removed you from their list. Please select a new teacher.',
            requiresTeacherSelection: true,
          };
        }
      }
    }

    // GAS allows multiple confirmations per day, each as a SEPARATE record.
    // The unique constraint is on [profileId, date], so we append a timestamp
    // suffix for additional confirmations to make each record unique in the DB.
    const now = new Date();
    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        profileId_date: {
          profileId: profile.id,
          date: dateStr,
        },
      },
    });

    // For the first confirmation, use plain date. For subsequent, append timestamp.
    const recordDate = existing
      ? `${dateStr}T${now.toISOString().split('T')[1]}`
      : dateStr;

    await prisma.attendanceRecord.create({
      data: {
        profileId: profile.id,
        date: recordDate,
        confirmedAt: now,
        teacherEmail: profile.currentTeacherEmail,
      },
    });

    // Also increment count on the original record for stats tracking
    if (existing) {
      await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { confirmationCount: { increment: 1 } },
      });
    }

    log.info('Attendance confirmed', { email: normalizedEmail, date: recordDate, isAdditional: !!existing });

    return {
      success: true,
      message: existing ? 'Additional attendance confirmed!' : 'Attendance confirmed',
      date: recordDate,
      confirmationNumber: existing ? (existing.confirmationCount + 1) : 1,
    };
  } catch (error) {
    log.error('Confirm attendance error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to confirm attendance' };
  }
}

/**
 * Delete own attendance record (user-facing, not admin-only)
 * Users can delete their own records if they accidentally confirmed.
 */
export async function deleteOwnAttendanceRecord(
  email: string,
  recordDate: string,
  token: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const normalizedEmail = normalizeEmail(email);

  // Users can only delete their own records
  if (sessionUser.aliasEmail !== normalizedEmail && !sessionUser.isAdmin) {
    return { success: false, error: 'You can only delete your own records' };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: { attendanceProfile: true },
    });

    if (!user?.attendanceProfile) {
      return { success: false, error: 'No attendance profile found' };
    }

    // Delete the specific record (exact date match, including timestamp suffix)
    const deleted = await prisma.attendanceRecord.deleteMany({
      where: {
        profileId: user.attendanceProfile.id,
        date: recordDate,
      },
    });

    if (deleted.count === 0) {
      return { success: false, error: 'Record not found' };
    }

    log.info('Attendance record deleted by user', { email: normalizedEmail, date: recordDate });
    return { success: true, message: 'Record deleted' };
  } catch (error) {
    log.error('Delete own attendance record error', { error });
    return { success: false, error: 'Failed to delete record' };
  }
}

// ============================================================================
// TEACHER MANAGEMENT
// ============================================================================

/**
 * Get all valid teachers
 * Legacy: getAllValidTeachers()
 */
export async function getAllValidTeachers(): Promise<ApiResponse & { teachers?: TeacherOption[] }> {
  try {
    // Get teachers from Rewardful (those with "teacher" in first name)
    const affiliates = await rewardfulApi.getAllAffiliates((aff) => {
      const firstName = aff.first_name || '';
      return firstName.toLowerCase().includes('teacher');
    });

    // Also get from override list
    const overrideEmails = config.admin.teacherOverrideEmails;

    // Filter out admins (legacy: teachers who are admins are excluded from selection)
    const teachers: TeacherOption[] = affiliates
      .filter((aff) => aff.email && !isAdminEmail(aff.email))
      .map((aff) => ({
        email: aff.email,
        name: `${aff.first_name || ''} ${aff.last_name || ''}`.trim(),
        firstName: aff.first_name || '',
        lastName: aff.last_name || '',
      }));

    // Add override emails that aren't already in the list
    for (const email of overrideEmails) {
      if (!teachers.find((t) => t.email.toLowerCase() === email.toLowerCase())) {
        const user = await prisma.user.findUnique({
          where: { aliasEmail: email },
        });

        teachers.push({
          email,
          name: user
            ? [user.firstName, user.lastName].filter(Boolean).join(' ') || email
            : email,
          firstName: user?.firstName || '',
          lastName: user?.lastName || '',
        });
      }
    }

    return { success: true, teachers };
  } catch (error) {
    log.error('Get valid teachers error', { error });
    return { success: false, error: 'Failed to fetch teachers', teachers: [] };
  }
}

/**
 * Set teacher for attendance user
 * Legacy: setTeacherForAttendanceUser(studentEmail, teacherEmail)
 */
export async function setTeacherForAttendanceUser(
  studentEmail: string,
  teacherEmail: string
): Promise<ApiResponse> {
  const normalizedStudent = normalizeEmail(studentEmail);
  const normalizedTeacher = normalizeEmail(teacherEmail);
  const isNoneSelection = normalizedTeacher === 'none';

  try {
    // Find student
    const student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
      include: { attendanceProfile: true },
    });

    if (!student) {
      return { success: false, error: 'Student not found' };
    }

    // If selecting "none", verify the student is actually a teacher
    // (only teachers can skip teacher assignment — matches GAS behavior)
    if (isNoneSelection) {
      if (!student.isTeacher && !isTeacherOverrideEmail(normalizedStudent)) {
        // Do a Rewardful check
        const emailForApi = student.internalEmail || normalizedStudent;
        const affResult = await rewardfulApi.getAffiliateByEmail(emailForApi);
        const firstName = affResult.affiliate?.first_name || '';
        if (!firstName.toLowerCase().includes('teacher')) {
          return { success: false, error: 'Only teachers can skip teacher selection' };
        }
      }
    }

    // Unlink from old teacher first (matches GAS behavior)
    const oldTeacherEmail = student.attendanceProfile?.currentTeacherEmail;
    if (oldTeacherEmail && oldTeacherEmail !== normalizedTeacher && oldTeacherEmail !== 'none') {
      const oldTeacher = await prisma.user.findUnique({
        where: { aliasEmail: oldTeacherEmail },
      });
      if (oldTeacher) {
        await prisma.teacherStudentLink.updateMany({
          where: {
            teacherId: oldTeacher.id,
            studentId: student.id,
            status: 'ACTIVE',
          },
          data: {
            status: 'REMOVED',
            removedAt: new Date(),
            removedBy: 'teacher_change',
          },
        });
      }
    }

    // Update or create attendance profile
    if (student.attendanceProfile) {
      await prisma.attendanceProfile.update({
        where: { id: student.attendanceProfile.id },
        data: { currentTeacherEmail: normalizedTeacher },
      });
    } else {
      await prisma.attendanceProfile.create({
        data: {
          userId: student.id,
          currentTeacherEmail: normalizedTeacher,
        },
      });
    }

    // Create teacher-student link (unless selecting "none")
    if (!isNoneSelection) {
      const teacher = await prisma.user.findUnique({
        where: { aliasEmail: normalizedTeacher },
      });

      if (teacher) {
        await prisma.teacherStudentLink.upsert({
          where: {
            teacherId_studentId: {
              teacherId: teacher.id,
              studentId: student.id,
            },
          },
          create: {
            teacherId: teacher.id,
            studentId: student.id,
            status: 'ACTIVE',
            createdBy: 'student',
          },
          update: {
            status: 'ACTIVE',
            removedAt: null,
            removedBy: null,
          },
        });
      }
    }

    log.info('Teacher set for student', {
      student: normalizedStudent,
      teacher: normalizedTeacher,
    });

    return { success: true, message: 'Teacher assigned successfully' };
  } catch (error) {
    log.error('Set teacher error', { error });
    return { success: false, error: 'Failed to set teacher' };
  }
}

// ============================================================================
// GET TEACHER FOR ATTENDANCE USER
// ============================================================================

/**
 * Get current teacher assignment for a student
 * Legacy: getTeacherForAttendanceUser(studentEmail)
 */
export async function getTeacherForAttendanceUser(
  studentEmail: string
): Promise<ApiResponse & { teacherEmail?: string | null }> {
  const normalizedEmail = normalizeEmail(studentEmail);

  if (!normalizedEmail) {
    return { success: false, error: 'Email required', teacherEmail: null };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: { attendanceProfile: true },
    });

    if (!user || !user.attendanceProfile) {
      return { success: false, error: 'No data found', teacherEmail: null };
    }

    return {
      success: true,
      teacherEmail: user.attendanceProfile.currentTeacherEmail || null,
    };
  } catch (error) {
    log.error('Get teacher for attendance user error', { error });
    return { success: false, error: 'Failed to get teacher', teacherEmail: null };
  }
}

// ============================================================================
// DELETE ATTENDANCE USER
// ============================================================================

/**
 * Delete an attendance user and all their records (admin only)
 * Legacy: deleteAttendanceUser(email)
 */
export async function deleteAttendanceUser(
  email: string,
  token: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser?.isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: { attendanceProfile: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    let deletedRecords = 0;

    // Delete attendance records
    if (user.attendanceProfile) {
      const result = await prisma.attendanceRecord.deleteMany({
        where: { profileId: user.attendanceProfile.id },
      });
      deletedRecords = result.count;

      // Delete attendance profile
      await prisma.attendanceProfile.delete({
        where: { id: user.attendanceProfile.id },
      });
    }

    // Remove teacher-student links
    await prisma.teacherStudentLink.deleteMany({
      where: { studentId: user.id },
    });

    log.info('Admin deleted attendance user', {
      email: normalizedEmail,
      deletedRecords,
    });

    return {
      success: true,
      message: `Deleted user and ${deletedRecords} attendance records`,
    };
  } catch (error) {
    log.error('Delete attendance user error', { error });
    return { success: false, error: 'Failed to delete user' };
  }
}
