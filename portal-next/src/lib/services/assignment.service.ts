/**
 * Teacher–Student Assignment Service
 *
 * Request + approval workflow. Never directly overwrite student assignment
 * outside this flow (except admin). Idempotent accept/remove; full audit trail.
 */

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { getSessionUser } from './session.service';
import { verifyTeacherAccess } from './teacher.service';
import type {
  ApiResponse,
  StudentTeacherState,
  TeacherChangeRequestRow,
  TeacherOptionWithId,
} from '@/types';

const log = logger.child({ service: 'assignment' });

// ============================================================================
// STUDENT: current teacher + open request
// ============================================================================

/**
 * Get current teacher and any open change request for the logged-in student.
 * GET /student/me/teacher
 * When viewAsEmail is provided and caller is supervisor, returns data for that student.
 */
export async function getStudentCurrentTeacher(
  token: string,
  viewAsEmail?: string
): Promise<ApiResponse & { data?: StudentTeacherState }> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  try {
    let studentId = sessionUser.id;
    if (viewAsEmail && viewAsEmail.trim() && sessionUser.isSupervisor) {
      const normalizedViewAs = normalizeEmail(viewAsEmail.trim());
      if (!normalizedViewAs) return { success: false, error: 'Invalid email' };
      const target = await prisma.user.findUnique({
        where: { aliasEmail: normalizedViewAs },
      });
      if (!target) return { success: false, error: 'User not found' };
      studentId = target.id;
    } else if (viewAsEmail && viewAsEmail.trim() && !sessionUser.isSupervisor && !sessionUser.isAdmin) {
      return { success: false, error: 'Not authorized' };
    }

    // Current ACTIVE assignment only (single active per student enforced in app)

    // Current ACTIVE assignment only (single active per student enforced in app)
    const activeLink = await prisma.teacherStudentLink.findFirst({
      where: { studentId, status: 'ACTIVE' },
      include: { teacher: true },
    });

    const openRequest = await prisma.teacherChangeRequest.findFirst({
      where: { studentId, status: 'OPEN' },
      include: { toTeacher: true },
    });

    const teacher = activeLink
      ? {
          id: activeLink.teacher.id,
          email: activeLink.teacher.aliasEmail,
          name:
            [activeLink.teacher.firstName, activeLink.teacher.lastName].filter(Boolean).join(' ') ||
            activeLink.teacher.aliasEmail,
        }
      : null;

    const openRequestData = openRequest
      ? {
          id: openRequest.id,
          toTeacherId: openRequest.toTeacherId,
          toTeacherName:
            [openRequest.toTeacher.firstName, openRequest.toTeacher.lastName]
              .filter(Boolean)
              .join(' ') || openRequest.toTeacher.aliasEmail,
          requestedAt: openRequest.requestedAt.toISOString(),
        }
      : null;

    return {
      success: true,
      data: { teacher, openRequest: openRequestData },
    };
  } catch (error) {
    log.error('getStudentCurrentTeacher error', { error });
    return { success: false, error: 'Failed to load teacher info' };
  }
}

/**
 * List teachers eligible for assignment (for change-teacher dropdown).
 * Uses the Rewardful-based teacher list (affiliates with "teacher" in first_name)
 * and resolves each to a DB user id for createTeacherChangeRequest.
 */
export async function getEligibleTeachersForAssignment(
  token: string
): Promise<ApiResponse & { teachers?: TeacherOptionWithId[] }> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  try {
    // Use the same Rewardful-based teacher lookup as getAllValidTeachers
    const { getAllValidTeachers } = await import('./attendance.service');
    const validResult = await getAllValidTeachers();

    if (!validResult.success || !validResult.teachers) {
      return { success: false, error: 'Failed to load teachers' };
    }

    // Resolve each Rewardful teacher email to a DB user (need the id)
    const teachers: TeacherOptionWithId[] = [];
    for (const t of validResult.teachers) {
      const dbUser = await prisma.user.findUnique({
        where: { aliasEmail: t.email },
        select: { id: true },
      });
      if (dbUser) {
        teachers.push({
          id: dbUser.id,
          email: t.email,
          name: t.name,
          firstName: t.firstName || '',
          lastName: t.lastName || '',
        });
      }
    }

    return { success: true, teachers };
  } catch (error) {
    log.error('getEligibleTeachersForAssignment error', { error });
    return { success: false, error: 'Failed to load teachers' };
  }
}

/**
 * Create a teacher change request (student wants to join or switch to a teacher).
 * At most one OPEN request per student; cannot request current teacher.
 * POST /student/me/teacher-change-request body: { toTeacherId, message? }
 */
export async function createTeacherChangeRequest(
  token: string,
  toTeacherId: string,
  message?: string
): Promise<
  ApiResponse & {
    request?: { id: string; status: string; toTeacherName: string; requestedAt: string };
  }
> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const studentId = sessionUser.id;

  try {
    const toTeacher = await prisma.user.findUnique({
      where: { id: toTeacherId },
    });
    if (!toTeacher || !toTeacher.isTeacher) {
      return { success: false, error: 'Target teacher not found or not eligible' };
    }

    const currentActive = await prisma.teacherStudentLink.findFirst({
      where: { studentId, status: 'ACTIVE' },
    });
    if (currentActive && currentActive.teacherId === toTeacherId) {
      return { success: false, error: 'You are already assigned to this teacher' };
    }

    const existingOpen = await prisma.teacherChangeRequest.findFirst({
      where: { studentId, status: 'OPEN' },
    });
    if (existingOpen) {
      return {
        success: false,
        error: 'You already have a pending request. Cancel it or wait for a response before submitting another.',
      };
    }

    const isFirstAssignment = !currentActive;

    const request = await prisma.teacherChangeRequest.create({
      data: {
        studentId,
        fromTeacherId: currentActive?.teacherId ?? null,
        toTeacherId,
        status: isFirstAssignment ? 'ACCEPTED' : 'OPEN',
        message: message ?? null,
        ...(isFirstAssignment
          ? { resolvedAt: new Date(), resolvedByTeacherId: toTeacherId }
          : {}),
      },
      include: { toTeacher: true },
    });

    // First-time assignment: immediately create the link + update attendance profile
    if (isFirstAssignment) {
      const existingLink = await prisma.teacherStudentLink.findUnique({
        where: { teacherId_studentId: { teacherId: toTeacherId, studentId } },
      });

      if (existingLink) {
        await prisma.teacherStudentLink.update({
          where: { id: existingLink.id },
          data: {
            status: 'ACTIVE',
            removedAt: null,
            removedBy: null,
            createdBy: 'first_assignment',
          },
        });
      } else {
        await prisma.teacherStudentLink.create({
          data: {
            teacherId: toTeacherId,
            studentId,
            status: 'ACTIVE',
            createdBy: 'first_assignment',
          },
        });
      }

      await prisma.attendanceProfile.upsert({
        where: { userId: studentId },
        create: { userId: studentId, currentTeacherEmail: toTeacher.aliasEmail },
        update: { currentTeacherEmail: toTeacher.aliasEmail, updatedAt: new Date() },
      });

      log.info('First teacher assignment (auto-accepted)', {
        requestId: request.id,
        studentId,
        toTeacherId,
      });
    } else {
      log.info('Teacher change request created', {
        requestId: request.id,
        studentId,
        toTeacherId,
      });
    }

    const toTeacherName =
      [request.toTeacher.firstName, request.toTeacher.lastName].filter(Boolean).join(' ') ||
      request.toTeacher.aliasEmail;

    return {
      success: true,
      autoAccepted: isFirstAssignment,
      request: {
        id: request.id,
        status: request.status,
        toTeacherName,
        requestedAt: request.requestedAt.toISOString(),
      },
    };
  } catch (error) {
    log.error('createTeacherChangeRequest error', { error });
    return { success: false, error: 'Failed to create request' };
  }
}

/**
 * Cancel the current student's OPEN request (if any).
 */
export async function cancelTeacherChangeRequest(token: string): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  try {
    const updated = await prisma.teacherChangeRequest.updateMany({
      where: { studentId: sessionUser.id, status: 'OPEN' },
      data: { status: 'CANCELLED', updatedAt: new Date() },
    });
    if (updated.count === 0) {
      return { success: false, error: 'No pending request to cancel' };
    }
    return { success: true, message: 'Request cancelled' };
  } catch (error) {
    log.error('cancelTeacherChangeRequest error', { error });
    return { success: false, error: 'Failed to cancel request' };
  }
}

// ============================================================================
// TEACHER: open requests
// ============================================================================

/**
 * List OPEN requests targeting the logged-in teacher.
 * GET /teacher/me/requests
 */
export async function getTeacherOpenRequests(
  token: string
): Promise<ApiResponse & { requests?: TeacherChangeRequestRow[] }> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const access = await verifyTeacherAccess(sessionUser.aliasEmail);
  if (!access.hasAccess) {
    return { success: false, error: 'Not authorized as teacher' };
  }

  try {
    const rows = await prisma.teacherChangeRequest.findMany({
      where: { toTeacherId: sessionUser.id, status: 'OPEN' },
      include: {
        student: true,
        fromTeacher: true,
      },
      orderBy: { requestedAt: 'asc' },
    });

    const requests: TeacherChangeRequestRow[] = rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentEmail: r.student.aliasEmail,
      studentName:
        [r.student.firstName, r.student.lastName].filter(Boolean).join(' ') || r.student.aliasEmail,
      fromTeacherId: r.fromTeacherId,
      fromTeacherName: r.fromTeacher
        ? [r.fromTeacher.firstName, r.fromTeacher.lastName].filter(Boolean).join(' ') ||
          r.fromTeacher.aliasEmail
        : null,
      toTeacherId: r.toTeacherId,
      requestedAt: r.requestedAt.toISOString(),
      message: r.message,
      status: r.status,
    }));

    return { success: true, requests };
  } catch (error) {
    log.error('getTeacherOpenRequests error', { error });
    return { success: false, error: 'Failed to load requests' };
  }
}

/**
 * Accept a request (target teacher only). Idempotent: second accept returns success without duplicating.
 * POST /teacher/me/requests/:id/accept
 */
export async function acceptTeacherChangeRequest(
  token: string,
  requestId: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const access = await verifyTeacherAccess(sessionUser.aliasEmail);
  if (!access.hasAccess) {
    return { success: false, error: 'Not authorized as teacher' };
  }

  const teacherId = sessionUser.id;

  try {
    const request = await prisma.teacherChangeRequest.findUnique({
      where: { id: requestId },
      include: { student: true, toTeacher: true },
    });

    if (!request) {
      return { success: false, error: 'Request not found' };
    }
    if (request.toTeacherId !== teacherId) {
      return { success: false, error: 'Not authorized to accept this request' };
    }
    if (request.status !== 'OPEN') {
      if (request.status === 'ACCEPTED') {
        return { success: true, message: 'Request already accepted' };
      }
      return { success: false, error: 'Request is no longer open' };
    }

    await prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.teacherChangeRequest.update({
        where: { id: requestId },
        data: {
          status: 'ACCEPTED',
          resolvedAt: now,
          resolvedByTeacherId: teacherId,
          updatedAt: now,
        },
      });

      const studentId = request.studentId;

      // End any current ACTIVE assignment for this student (only one active per student)
      await tx.teacherStudentLink.updateMany({
        where: { studentId, status: 'ACTIVE' },
        data: {
          status: 'REMOVED',
          removedAt: now,
          removedBy: 'teacher_change_request',
          updatedAt: now,
        },
      });

      const existingLink = await tx.teacherStudentLink.findUnique({
        where: {
          teacherId_studentId: { teacherId, studentId },
        },
      });

      if (existingLink) {
        await tx.teacherStudentLink.update({
          where: { id: existingLink.id },
          data: {
            status: 'ACTIVE',
            removedAt: null,
            removedBy: null,
            createdBy: 'request_accept',
            updatedAt: now,
          },
        });
      } else {
        await tx.teacherStudentLink.create({
          data: {
            teacherId,
            studentId,
            status: 'ACTIVE',
            createdBy: 'request_accept',
          },
        });
      }

      const teacherEmail = request.toTeacher.aliasEmail;

      await tx.attendanceProfile.upsert({
        where: { userId: studentId },
        create: { userId: studentId, currentTeacherEmail: teacherEmail },
        update: { currentTeacherEmail: teacherEmail, updatedAt: now },
      });
    });

    log.info('Teacher change request accepted', { requestId, teacherId, studentId: request.studentId });
    return { success: true, message: 'Request accepted' };
  } catch (error) {
    log.error('acceptTeacherChangeRequest error', { error, requestId });
    return { success: false, error: 'Failed to accept request' };
  }
}

/**
 * Reject a request (target teacher only).
 * POST /teacher/me/requests/:id/reject
 */
export async function rejectTeacherChangeRequest(
  token: string,
  requestId: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const access = await verifyTeacherAccess(sessionUser.aliasEmail);
  if (!access.hasAccess) {
    return { success: false, error: 'Not authorized as teacher' };
  }

  try {
    const request = await prisma.teacherChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      return { success: false, error: 'Request not found' };
    }
    if (request.toTeacherId !== sessionUser.id) {
      return { success: false, error: 'Not authorized to reject this request' };
    }
    if (request.status !== 'OPEN') {
      return { success: false, error: 'Request is no longer open' };
    }

    await prisma.teacherChangeRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        resolvedAt: new Date(),
        resolvedByTeacherId: sessionUser.id,
        updatedAt: new Date(),
      },
    });

    log.info('Teacher change request rejected', { requestId });
    return { success: true, message: 'Request rejected' };
  } catch (error) {
    log.error('rejectTeacherChangeRequest error', { error });
    return { success: false, error: 'Failed to reject request' };
  }
}

/**
 * Remove a student from the logged-in teacher (only if currently ACTIVE under this teacher). Idempotent.
 * POST /teacher/me/students/:studentId/remove
 */
export async function removeStudentFromTeacherByTeacherSession(
  token: string,
  studentId: string
): Promise<ApiResponse> {
  const { user: sessionUser } = await getSessionUser(token);
  if (!sessionUser) {
    return { success: false, error: 'Invalid session' };
  }

  const access = await verifyTeacherAccess(sessionUser.aliasEmail);
  if (!access.hasAccess) {
    return { success: false, error: 'Not authorized as teacher' };
  }

  const teacherId = sessionUser.id;

  try {
    const link = await prisma.teacherStudentLink.findUnique({
      where: {
        teacherId_studentId: { teacherId, studentId },
      },
    });

    if (!link) {
      return { success: false, error: 'Student not found under your list' };
    }
    if (link.status !== 'ACTIVE') {
      return { success: true, message: 'Student already removed' };
    }

    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.teacherStudentLink.update({
        where: { id: link.id },
        data: {
          status: 'REMOVED',
          removedAt: now,
          removedBy: 'teacher',
          updatedAt: now,
        },
      });

      const student = await tx.user.findUnique({
        where: { id: studentId },
        include: { attendanceProfile: true },
      });
      if (student?.attendanceProfile) {
        const currentActive = await tx.teacherStudentLink.findFirst({
          where: { studentId, status: 'ACTIVE' },
          include: { teacher: true },
        });
        await tx.attendanceProfile.update({
          where: { userId: studentId },
          data: {
            currentTeacherEmail: currentActive?.teacher.aliasEmail ?? null,
            updatedAt: now,
          },
        });
      }
    });

    log.info('Student removed from teacher', { teacherId, studentId });
    return { success: true, message: 'Student removed' };
  } catch (error) {
    log.error('removeStudentFromTeacherByTeacherSession error', { error });
    return { success: false, error: 'Failed to remove student' };
  }
}
