/**
 * Tests for teacher–student assignment workflow.
 * - create request
 * - block second OPEN request
 * - accept request moves assignment correctly (integration: needs DB)
 * - accept twice doesn't duplicate (idempotent)
 * - remove student safe + idempotent (integration: needs DB)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getStudentCurrentTeacher,
  createTeacherChangeRequest,
  acceptTeacherChangeRequest,
  removeStudentFromTeacherByTeacherSession,
} from './assignment.service';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    teacherStudentLink: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    teacherChangeRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    attendanceProfile: { upsert: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((fn) => (typeof fn === 'function' ? fn({}) : Promise.resolve())),
  },
}));

vi.mock('./session.service', () => ({
  getSessionUser: vi.fn(),
}));

vi.mock('./teacher.service', () => ({
  verifyTeacherAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
}));

const { getSessionUser } = await import('./session.service');
const { prisma } = await import('@/lib/db');

describe('assignment.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStudentCurrentTeacher', () => {
    it('returns invalid session when token has no user', async () => {
      vi.mocked(getSessionUser).mockResolvedValue({ user: null, isAdmin: false });
      const result = await getStudentCurrentTeacher('bad-token');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid session');
    });

    it('returns teacher and openRequest when session valid', async () => {
      vi.mocked(getSessionUser).mockResolvedValue({
        user: {
          id: 'student-1',
          aliasEmail: 'student@test.com',
          internalEmail: null,
          isAdmin: false,
          isTeacher: false,
        },
        isAdmin: false,
      });
      vi.mocked(prisma.teacherStudentLink.findFirst).mockResolvedValue({
        id: 'link-1',
        teacherId: 'teacher-1',
        studentId: 'student-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        removedAt: null,
        removedBy: null,
        percentageOverride: null,
        teacher: {
          id: 'teacher-1',
          aliasEmail: 'teacher@test.com',
          firstName: 'Test',
          lastName: 'Teacher',
        } as never,
      });
      vi.mocked(prisma.teacherChangeRequest.findFirst).mockResolvedValue(null);
      const result = await getStudentCurrentTeacher('token');
      expect(result.success).toBe(true);
      expect(result.data?.teacher?.email).toBe('teacher@test.com');
      expect(result.data?.openRequest).toBeNull();
    });
  });

  describe('createTeacherChangeRequest', () => {
    it('blocks second OPEN request when one already exists', async () => {
      vi.mocked(getSessionUser).mockResolvedValue({
        user: { id: 'student-1', aliasEmail: 's@t.com', internalEmail: null, isAdmin: false, isTeacher: false },
        isAdmin: false,
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'teacher-2',
        isTeacher: true,
        aliasEmail: 't2@test.com',
        firstName: 'T2',
        lastName: 'Teacher',
      } as never);
      vi.mocked(prisma.teacherStudentLink.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.teacherChangeRequest.findFirst).mockResolvedValue({
        id: 'req-1',
        status: 'OPEN',
        studentId: 'student-1',
        toTeacherId: 'teacher-2',
      } as never);

      const result = await createTeacherChangeRequest('token', 'teacher-2');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/pending request|already have/);
      expect(prisma.teacherChangeRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('acceptTeacherChangeRequest', () => {
    it('returns success without duplicating when request already ACCEPTED (idempotent)', async () => {
      vi.mocked(getSessionUser).mockResolvedValue({
        user: { id: 'teacher-1', aliasEmail: 't@test.com', internalEmail: null, isAdmin: false, isTeacher: true },
        isAdmin: false,
      });
      vi.mocked(prisma.teacherChangeRequest.findUnique).mockResolvedValue({
        id: 'req-1',
        studentId: 'student-1',
        toTeacherId: 'teacher-1',
        status: 'ACCEPTED',
        toTeacher: { aliasEmail: 't@test.com', firstName: 'T', lastName: 'T' },
      } as never);

      const result = await acceptTeacherChangeRequest('token', 'req-1');
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/already accepted/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('removeStudentFromTeacherByTeacherSession', () => {
    it('returns success when student already REMOVED (idempotent)', async () => {
      vi.mocked(getSessionUser).mockResolvedValue({
        user: { id: 'teacher-1', aliasEmail: 't@test.com', internalEmail: null, isAdmin: false, isTeacher: true },
        isAdmin: false,
      });
      vi.mocked(prisma.teacherStudentLink.findUnique).mockResolvedValue({
        id: 'link-1',
        teacherId: 'teacher-1',
        studentId: 'student-1',
        status: 'REMOVED',
        removedAt: new Date(),
        removedBy: 'teacher',
      } as never);

      const result = await removeStudentFromTeacherByTeacherSession('token', 'student-1');
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/already removed/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
