/**
 * Migration Types
 *
 * Type definitions for legacy data structures from PropertiesService.
 */

// ============================================================================
// LEGACY KEY PATTERNS (from docs/key_prefixes_found.md)
// ============================================================================

/**
 * AUTH_* - User authentication data
 * Key: AUTH_{normalized_email}
 */
export interface LegacyAuthData {
  hash: string;
  salt: string;
  createdAt?: string;
  lastLogin?: string;
  failedAttempts?: number;
  lockUntil?: string;
}

/**
 * AFFILIATE_AUTH_* - Affiliate authentication
 * Key: AFFILIATE_AUTH_{normalized_email}
 */
export interface LegacyAffiliateAuth {
  aliasEmail: string;
  internalEmail?: string;
  hash?: string;
  salt?: string;
  createdAt?: string;
  passwordSetAt?: string;
}

/**
 * PENDING_* - Pending account requests
 * Key: PENDING_{normalized_email}
 */
export interface LegacyPendingAccount {
  email: string;
  firstName?: string;
  lastName?: string;
  requestedAt: string;
  portalType?: string;
}

/**
 * APPROVED_* - Approved accounts
 * Key: APPROVED_{normalized_email}
 */
export interface LegacyApprovedAccount {
  aliasEmail: string;
  internalEmail: string;
  firstName?: string;
  lastName?: string;
  approvedAt: string;
  approvedBy?: string;
  affiliateId?: string;
}

/**
 * REJECTED_* - Rejected accounts
 * Key: REJECTED_{normalized_email}
 */
export interface LegacyRejectedAccount {
  email: string;
  rejectedAt: string;
  rejectedBy?: string;
  reason?: string;
}

/**
 * ATTENDANCE_USER_* - Attendance user profiles
 * Key: ATTENDANCE_USER_{normalized_email}
 */
export interface LegacyAttendanceUser {
  email: string;
  teacherEmail?: string;
  createdAt?: string;
  passwordHash?: string;
  passwordSalt?: string;
}

/**
 * ATTENDANCE_RECORDS_* - Attendance records
 * Key: ATTENDANCE_RECORDS_{normalized_email}
 */
export interface LegacyAttendanceRecords {
  [date: string]: {
    confirmedAt: string;
    teacherEmail?: string;
    confirmationCount?: number;
  };
}

/**
 * TEACHER_LINKS_* - Canonical teacher-student links
 * Key: TEACHER_LINKS_{normalized_teacher_email}
 */
export interface LegacyTeacherLinks {
  students: Array<{
    email: string;
    addedAt: string;
    addedBy?: string;
    percentageOverride?: number;
  }>;
}

/**
 * TEACHER_STUDENTS_* - Legacy teacher-student links
 * Key: TEACHER_STUDENTS_{normalized_teacher_email}
 */
export type LegacyTeacherStudents = string[]; // Array of student emails

/**
 * TEACHER_EARNINGS_* - Teacher earnings data
 * Key: TEACHER_EARNINGS_{normalized_email}
 */
export interface LegacyTeacherEarnings {
  lockedEarnings: number;
  lockedAt?: string;
  totalEarnedAllTime?: number;
  totalPaidAllTime?: number;
  payments?: Array<{
    amount: number;
    paidAt: string;
    paidBy?: string;
  }>;
}

/**
 * OVERRIDE_* - Commission overrides
 * Key: OVERRIDE_{normalized_email}
 */
export interface LegacyCommissionOverride {
  unpaid?: number;
  dueNow?: number;
  totalPaid?: number;
  note?: string;
  reason?: string;
  setBy?: string;
  setAt?: string;
}

/**
 * TRACKING_* - Commission tracking data
 * Key: TRACKING_{normalized_email}
 */
export interface LegacyCommissionTracking {
  lastApiAmount: number;
  lastDisplayedAmount: number;
  lastFetchedAt: string;
}

/**
 * REFERRAL_DATA_* - Cached referral data
 * Key: REFERRAL_DATA_{normalized_email}
 */
export interface LegacyReferralData {
  affiliateId: string;
  lastKnownLeadCount: number;
  previousLeadCount?: number;
  lastFetchedAt: string;
}

/**
 * SESSION_* - Session tokens (from CacheService)
 * Key: SESSION_{token}
 */
export interface LegacySession {
  email: string;
  aliasEmail?: string;
  rewardfulEmail?: string;
  isTeacher?: boolean;
  isAdmin?: boolean;
  createdAt: string;
  expiresAt: string;
}

/**
 * PASSWORD_SETUP_TOKEN_* - Password setup tokens
 * Key: PASSWORD_SETUP_TOKEN_{token}
 */
export interface LegacyPasswordToken {
  email: string;
  createdAt: string;
  expiresAt: string;
  used?: boolean;
}

// ============================================================================
// EXPORT DATA STRUCTURES
// ============================================================================

/**
 * Complete export from PropertiesService
 */
export interface LegacyDataExport {
  exportedAt: string;
  exportedBy?: string;
  version: string;

  // Auth data
  authData: Record<string, LegacyAuthData>;
  affiliateAuth: Record<string, LegacyAffiliateAuth>;

  // Account status
  pendingAccounts: Record<string, LegacyPendingAccount>;
  approvedAccounts: Record<string, LegacyApprovedAccount>;
  rejectedAccounts: Record<string, LegacyRejectedAccount>;

  // Attendance
  attendanceUsers: Record<string, LegacyAttendanceUser>;
  attendanceRecords: Record<string, LegacyAttendanceRecords>;

  // Teacher data
  teacherLinks: Record<string, LegacyTeacherLinks>;
  teacherStudents: Record<string, LegacyTeacherStudents>;
  teacherEarnings: Record<string, LegacyTeacherEarnings>;

  // Commission
  commissionOverrides: Record<string, LegacyCommissionOverride>;
  commissionTracking: Record<string, LegacyCommissionTracking>;

  // Referrals
  referralData: Record<string, LegacyReferralData>;

  // Tokens (optional, may skip for security)
  passwordTokens?: Record<string, LegacyPasswordToken>;
}

// ============================================================================
// MIGRATION RESULT TYPES
// ============================================================================

export interface MigrationResult {
  success: boolean;
  entity: string;
  imported: number;
  skipped: number;
  errors: Array<{
    key: string;
    error: string;
  }>;
  duration: number;
}

export interface MigrationSummary {
  startedAt: string;
  completedAt: string;
  totalDuration: number;
  results: MigrationResult[];
  overallSuccess: boolean;
}
