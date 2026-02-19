/**
 * Supervisor role tests
 *
 * Verifies authorization logic for the supervisor role across all services.
 * For "allowed" scenarios, we verify the auth gate is passed (no auth error).
 * For "blocked" scenarios, we verify the auth error IS returned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock user factories
// ---------------------------------------------------------------------------

const makeSupervisor = (overrides = {}) => ({
  id: 'supervisor-1',
  aliasEmail: 'supervisor@test.com',
  internalEmail: null,
  isAdmin: false,
  isTeacher: false,
  isSupervisor: true,
  ...overrides,
});

const makeRegular = (overrides = {}) => ({
  id: 'user-1',
  aliasEmail: 'regular@test.com',
  internalEmail: null,
  isAdmin: false,
  isTeacher: false,
  isSupervisor: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    session: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), update: vi.fn() },
    commissionTracking: { findUnique: vi.fn(), upsert: vi.fn() },
    commissionOverride: { findFirst: vi.fn() },
    teacherStudentLink: {
      findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    },
    teacherChangeRequest: {
      findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    },
    teacherEarnings: { findUnique: vi.fn() },
    attendanceProfile: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    attendanceRecord: {
      findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(),
      delete: vi.fn(), deleteMany: vi.fn(),
    },
    $transaction: vi.fn((fn: unknown) =>
      typeof fn === 'function' ? fn({}) : Promise.resolve()
    ),
  },
}));

vi.mock('./session.service', () => ({
  getSessionUser: vi.fn(),
  validateAdminSession: vi.fn(),
}));

vi.mock('./rewardful.service', () => ({
  rewardfulApi: {
    getAffiliateByEmail: vi.fn().mockResolvedValue({
      success: true,
      affiliate: { id: 'aff-1', first_name: 'Test', last_name: 'Affiliate' },
    }),
    getCommissionTotals: vi.fn().mockResolvedValue({ unpaid: 100, paid: 200, dueNow: 50 }),
  },
}));

vi.mock('@/lib/config', () => ({
  config: { rewardful: { apiKey: 'test' }, jwtSecret: 'test' },
  normalizeEmail: vi.fn((e: string) => e?.toLowerCase().trim() || ''),
  isAdminEmail: vi.fn(() => false),
  isTeacherOverrideEmail: vi.fn(() => false),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const { getSessionUser, validateAdminSession } = await import('./session.service');
const { prisma } = await import('@/lib/db');

const AUTH_ERRORS = /not authorized|unauthorized|you can only delete your own/i;

// ============================================================================
// 1. Commission Service
// ============================================================================

describe('commission.service - supervisor access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supervisor passes auth gate for another affiliate', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });

    const { lookupAffiliate } = await import('./commission.service');
    const result = await lookupAffiliate('affiliate@test.com', 'supervisor-token');

    // Auth passed; any failure is NOT an authorization error
    if (!result.success) {
      expect(result.error).not.toMatch(AUTH_ERRORS);
    }
  });

  it('regular user CANNOT look up another affiliate', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const { lookupAffiliate } = await import('./commission.service');
    const result = await lookupAffiliate('other@test.com', 'regular-token');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(AUTH_ERRORS);
  });

  it('regular user passes auth gate for their own commissions', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const { lookupAffiliate } = await import('./commission.service');
    const result = await lookupAffiliate('regular@test.com', 'regular-token');

    // Own email matches session - auth passed; any failure is NOT authorization
    if (!result.success) {
      expect(result.error).not.toMatch(AUTH_ERRORS);
    }
  });
});

// ============================================================================
// 2. Attendance Service
// ============================================================================

describe('attendance.service - supervisor access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supervisor passes auth for another user attendance data (live)', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'target-1', aliasEmail: 'student@test.com',
      firstName: 'Student', lastName: 'Test', createdAt: new Date(),
      attendanceProfile: { id: 'ap-1', records: [], currentTeacherEmail: null },
    } as never);

    const { getAttendanceData } = await import('./attendance.service');
    const result = await getAttendanceData('student@test.com', 'supervisor-token', 'live');

    expect(result.error).not.toMatch(AUTH_ERRORS);
  });

  it('supervisor passes auth for another user attendance data (clipper mode)', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'target-1', aliasEmail: 'student@test.com',
      firstName: 'Student', lastName: 'Test', createdAt: new Date(),
      attendanceProfile: { id: 'ap-1', records: [], currentTeacherEmail: null },
    } as never);

    const { getAttendanceData } = await import('./attendance.service');
    const result = await getAttendanceData('student@test.com', 'supervisor-token', 'clipper');

    expect(result.error).not.toMatch(AUTH_ERRORS);
  });

  it('regular user CANNOT get another user attendance data', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const { getAttendanceData } = await import('./attendance.service');
    const result = await getAttendanceData('other@test.com', 'regular-token', 'live');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(AUTH_ERRORS);
  });

  it('supervisor passes auth to confirm attendance for another user', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });

    const { confirmAttendance } = await import('./attendance.service');
    const result = await confirmAttendance('student@test.com', '2026-02-19', 'supervisor-token', 'live');

    // Auth passed; any failure here is NOT an auth error
    if (!result.success) {
      expect(result.error).not.toMatch(AUTH_ERRORS);
    }
  });

  it('regular user CANNOT confirm attendance for another user', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const { confirmAttendance } = await import('./attendance.service');
    const result = await confirmAttendance('other@test.com', '2026-02-19', 'regular-token', 'live');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(AUTH_ERRORS);
  });

  it('supervisor passes auth to delete another user attendance record', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'target-1', aliasEmail: 'student@test.com',
      attendanceProfile: { id: 'ap-1' },
    } as never);
    vi.mocked(prisma.attendanceRecord.deleteMany).mockResolvedValue({ count: 1 } as never);

    const { deleteOwnAttendanceRecord } = await import('./attendance.service');
    const result = await deleteOwnAttendanceRecord('student@test.com', '2026-02-19', 'supervisor-token');

    expect(result.success).toBe(true);
  });

  it('regular user CANNOT delete another user attendance record', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const { deleteOwnAttendanceRecord } = await import('./attendance.service');
    const result = await deleteOwnAttendanceRecord('other@test.com', '2026-02-19', 'regular-token');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(AUTH_ERRORS);
  });
});

// ============================================================================
// 3. Teacher Service
// ============================================================================

describe('teacher.service - supervisor access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset teacher service mock to call the real implementations
    vi.doUnmock('./teacher.service');
  });

  it('supervisor passes auth for another teacher portal data', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });

    const teacherService = await vi.importActual<typeof import('./teacher.service')>('./teacher.service');

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'teacher-1', aliasEmail: 'teacher@test.com',
      firstName: 'Test', lastName: 'Teacher', isAdmin: false,
      isTeacher: true, internalEmail: null, rewardfulAffiliateId: null,
    } as never);
    vi.mocked(prisma.teacherStudentLink.findMany).mockResolvedValue([]);
    vi.mocked(prisma.teacherEarnings.findUnique).mockResolvedValue(null);

    const result = await teacherService.getTeacherDataWithContext('teacher@test.com', 'supervisor-token');

    // Auth gate passed; any error is NOT an auth error
    if (!result.success) {
      expect(result.error).not.toMatch(AUTH_ERRORS);
    }
  });

  it('regular user CANNOT view another teacher portal data', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const teacherService = await vi.importActual<typeof import('./teacher.service')>('./teacher.service');
    const result = await teacherService.getTeacherDataWithContext('teacher@test.com', 'regular-token');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(AUTH_ERRORS);
  });

  it('supervisor passes auth for another teacher student commissions', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'teacher-1', aliasEmail: 'teacher@test.com',
      firstName: 'Test', lastName: 'Teacher',
    } as never);
    vi.mocked(prisma.teacherStudentLink.findMany).mockResolvedValue([]);

    const teacherService = await vi.importActual<typeof import('./teacher.service')>('./teacher.service');
    const result = await teacherService.getStudentsCommissionData('teacher@test.com', 'supervisor-token');

    if (!result.success) {
      expect(result.error).not.toMatch(AUTH_ERRORS);
    }
  });

  it('regular user CANNOT view another teacher student commissions', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const teacherService = await vi.importActual<typeof import('./teacher.service')>('./teacher.service');
    const result = await teacherService.getStudentsCommissionData('teacher@test.com', 'regular-token');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(AUTH_ERRORS);
  });
});

// ============================================================================
// 4. Assignment Service - supervisor can view-as any student
// ============================================================================

describe('assignment.service - supervisor view-as', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supervisor can view-as a student by email', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeSupervisor(),
      isAdmin: false,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'student-1', aliasEmail: 'student@test.com',
    } as never);
    vi.mocked(prisma.teacherStudentLink.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.teacherChangeRequest.findFirst).mockResolvedValue(null);

    const { getStudentCurrentTeacher } = await import('./assignment.service');
    const result = await getStudentCurrentTeacher('supervisor-token', 'student@test.com');

    expect(result.success).toBe(true);
  });

  it('regular user CANNOT use view-as for another student', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      user: makeRegular(),
      isAdmin: false,
    });

    const { getStudentCurrentTeacher } = await import('./assignment.service');
    const result = await getStudentCurrentTeacher('regular-token', 'other@test.com');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(AUTH_ERRORS);
  });
});

// ============================================================================
// 5. Admin Service - only admin can set/unset supervisor role
// ============================================================================

describe('admin.service - adminSetSupervisor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('admin can grant supervisor role', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1', aliasEmail: 'user@test.com', isSupervisor: false,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const { adminSetSupervisor } = await import('./admin.service');
    const result = await adminSetSupervisor('user@test.com', true, 'admin-token');

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/supervisor/i);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isSupervisor: true } })
    );
  });

  it('admin can revoke supervisor role', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1', aliasEmail: 'user@test.com', isSupervisor: true,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const { adminSetSupervisor } = await import('./admin.service');
    const result = await adminSetSupervisor('user@test.com', false, 'admin-token');

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/removed/i);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isSupervisor: false } })
    );
  });

  it('non-admin CANNOT set supervisor role', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(false);

    const { adminSetSupervisor } = await import('./admin.service');
    const result = await adminSetSupervisor('user@test.com', true, 'non-admin-token');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unauthorized/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('admin cannot set supervisor on non-existent user', async () => {
    vi.mocked(validateAdminSession).mockResolvedValue(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const { adminSetSupervisor } = await import('./admin.service');
    const result = await adminSetSupervisor('nobody@test.com', true, 'admin-token');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ============================================================================
// 6. Session Service - isSupervisor propagated correctly
// ============================================================================

describe('session.service - isSupervisor in session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSessionUser returns isSupervisor=true for supervisor', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 'sess-1', token: 'test-token',
      expiresAt: new Date(Date.now() + 86_400_000),
      user: {
        id: 'sup-1', aliasEmail: 'supervisor@test.com', internalEmail: null,
        isAdmin: false, isTeacher: false, isSupervisor: true,
      },
    } as never);

    const { getSessionUser: realGetSessionUser } = await vi.importActual<
      typeof import('./session.service')
    >('./session.service');
    const result = await realGetSessionUser('test-token');

    expect(result.user).toBeDefined();
    expect(result.user!.isSupervisor).toBe(true);
    expect(result.isAdmin).toBe(false);
  });

  it('getSessionUser returns isSupervisor=false for regular user', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 'sess-2', token: 'test-token-2',
      expiresAt: new Date(Date.now() + 86_400_000),
      user: {
        id: 'reg-1', aliasEmail: 'regular@test.com', internalEmail: null,
        isAdmin: false, isTeacher: false, isSupervisor: false,
      },
    } as never);

    const { getSessionUser: realGetSessionUser } = await vi.importActual<
      typeof import('./session.service')
    >('./session.service');
    const result = await realGetSessionUser('test-token-2');

    expect(result.user).toBeDefined();
    expect(result.user!.isSupervisor).toBe(false);
  });
});

// ============================================================================
// 7. Role isolation - supervisor is NOT treated as admin
// ============================================================================

describe('role isolation - supervisor != admin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supervisor user has isAdmin=false', () => {
    const sup = makeSupervisor();
    expect(sup.isSupervisor).toBe(true);
    expect(sup.isAdmin).toBe(false);
  });

  it('validateAdminSession returns false for supervisor-only user', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 'sess-sup', token: 'sup-token',
      expiresAt: new Date(Date.now() + 86_400_000),
      user: makeSupervisor(),
    } as never);

    const { validateAdminSession: realValidateAdmin } = await vi.importActual<
      typeof import('./session.service')
    >('./session.service');
    const isAdmin = await realValidateAdmin('sup-token');

    expect(isAdmin).toBe(false);
  });
});
