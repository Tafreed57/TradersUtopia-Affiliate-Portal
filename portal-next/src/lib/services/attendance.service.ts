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
  user?: { email: string; name: string; teacherEmail?: string };
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
    // Find or create attendance profile
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      include: { attendanceProfile: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if admin
    const isAdmin = isAdminEmail(normalizedEmail);

    // Get name
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || normalizedEmail;

    // Check if teacher is assigned
    const teacherEmail = user.attendanceProfile?.currentTeacherEmail;
    const needsTeacherSelection = !teacherEmail && !isAdmin;

    return {
      success: true,
      needsTeacherSelection,
      isAdmin,
      user: {
        email: normalizedEmail,
        name,
        teacherEmail: teacherEmail || undefined,
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
    for (const record of profile.records) {
      records.push({
        date: record.date,
        confirmedAt: record.confirmedAt.toISOString(),
        type: 'confirmed',
        teacherEmail: record.teacherEmail || undefined,
      });
      confirmedDates.add(record.date);
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

    // Check for existing record
    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        profileId_date: {
          profileId: profile.id,
          date: dateStr,
        },
      },
    });

    if (existing) {
      // Update confirmation count
      await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          confirmationCount: { increment: 1 },
          confirmedAt: new Date(),
        },
      });

      return {
        success: true,
        alreadyConfirmed: true,
        message: 'Attendance already confirmed for today',
        date: dateStr,
      };
    }

    // Create new record
    await prisma.attendanceRecord.create({
      data: {
        profileId: profile.id,
        date: dateStr,
        confirmedAt: new Date(),
        teacherEmail: profile.currentTeacherEmail,
      },
    });

    log.info('Attendance confirmed', { email: normalizedEmail, date: dateStr });

    return {
      success: true,
      message: 'Attendance confirmed',
      date: dateStr,
    };
  } catch (error) {
    log.error('Confirm attendance error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to confirm attendance' };
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

    const teachers: TeacherOption[] = affiliates.map((aff) => ({
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

  try {
    // Find student
    const student = await prisma.user.findUnique({
      where: { aliasEmail: normalizedStudent },
      include: { attendanceProfile: true },
    });

    if (!student) {
      return { success: false, error: 'Student not found' };
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

    // Also create teacher-student link
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
