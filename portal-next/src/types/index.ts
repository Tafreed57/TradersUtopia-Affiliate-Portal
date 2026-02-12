/**
 * Core Type Definitions
 *
 * These types mirror the legacy API contracts documented in Phase 1.
 * They ensure type safety when migrating from google.script.run calls.
 */

// ============================================================================
// ACCOUNT STATUS
// ============================================================================

export type AccountStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'COMPLETED'
  | 'ACTIVE'
  | 'REJECTED';

export type LinkStatus = 'ACTIVE' | 'REMOVED';

// ============================================================================
// USER INFO
// ============================================================================

export interface UserInfo {
  email: string;
  displayEmail: string;
  canonicalEmail?: string;
  name: string;
  isTeacher: boolean;
  isAdmin: boolean;
}

export interface SessionUser extends UserInfo {
  rewardfulEmail?: string;
}

// ============================================================================
// API RESPONSE PATTERNS
// ============================================================================

/** Base success response (allows extra properties) */
export interface SuccessResponse {
  success: true;
  [key: string]: unknown;
}

/** Base error response (allows extra properties) */
export interface ErrorResponse {
  success: false;
  error: string;
  [key: string]: unknown;
}

/** Combined response type */
export type ApiResponse<T extends object = object> =
  | (SuccessResponse & T)
  | ErrorResponse;

// ============================================================================
// SESSION & AUTH TYPES
// ============================================================================

export interface ValidateSessionResponse {
  valid: true;
  user: UserInfo;
  expiresAt: number;
}

export interface InvalidSessionResponse {
  valid: false;
}

export type SessionValidationResult =
  | ValidateSessionResponse
  | InvalidSessionResponse;

export interface LoginSuccessResponse extends SuccessResponse {
  token: string;
  expiresAt: number;
  user: SessionUser;
  message: string;
}

export interface LoginErrorResponse extends ErrorResponse {
  noPasswordSet?: boolean;
  isPending?: boolean;
  isRejected?: boolean;
  needsAccessRequest?: boolean;
  isLegacyEmail?: boolean;
  aliasEmail?: string;
}

export type LoginResponse = LoginSuccessResponse | LoginErrorResponse;

// ============================================================================
// ACCOUNT STATUS TYPES
// ============================================================================

export interface AccountStatusResponse {
  status:
    | 'new'
    | 'pending'
    | 'approved_needs_password'
    | 'active'
    | 'rejected'
    | 'admin';
  canSetPassword: boolean;
  message?: string;
  currentAliasEmail?: string;
}

export interface RequestStatusResponse {
  found: boolean;
  status:
    | 'NOT_FOUND'
    | 'PENDING'
    | 'APPROVED'
    | 'COMPLETED'
    | 'REJECTED'
    | 'ADMIN'
    | 'UNKNOWN';
  canSetPassword?: boolean;
  firstName?: string;
  lastName?: string;
  requestedAt?: string;
  approvedAt?: string;
  currentAliasEmail?: string;
  message: string;
}

// ============================================================================
// COMMISSION TYPES
// ============================================================================

export interface CommissionData {
  email: string;
  displayEmail: string;
  name: string;
  affiliateId: string;

  // Commission amounts (CAD)
  unpaidAmount: number;
  dueNowAmount: number;
  totalPaidAmount: number;

  // Raw API values (before adjustments)
  rawUnpaid: number;
  rawDueNow: number;
  rawPaid: number;

  // Percentage info
  percentage: number;
  percentageApplied: boolean;

  // Incremental tracking
  deltaAmount: number;
  lastApiAmount: number;
  lastDisplayedAmount: number;

  // Override info
  hasOverride: boolean;
  overrideNote?: string;

  // Currency
  currency: string;
  conversionRate: number;

  // Metadata
  lastFetchedAt: number;
  fromCache: boolean;
}

export interface LookupAffiliateResponse extends SuccessResponse {
  data: CommissionData;
}

export interface CommissionOverrideData {
  unpaidAmount?: number;
  dueNowAmount?: number;
  totalPaidAmount?: number;
  note?: string;
  reason?: string;
}

// ============================================================================
// TEACHER TYPES
// ============================================================================

export interface StudentData {
  email: string;
  internalEmail?: string;
  name: string;
  affiliateId?: string;
  percentageOverride?: number;
  addedDate?: string;
}

export interface TeacherEarningsData {
  lockedEarnings: number;
  totalEarnedAllTime: number;
  totalPaidAllTime: number;
  lockedAt?: string;
}

export interface TeacherData {
  teacher: {
    email: string;
    name: string;
    isAdmin: boolean;
  };
  students: StudentData[];
  earnings: TeacherEarningsData;
  viewingAs?: string;
}

export interface StudentCommissionData {
  email: string;
  name: string;
  // All-time totals (RAW 100% from commission_stats)
  totalUnpaid: number;
  totalDueNow: number;
  totalPaid: number;
  // 30-day filtered amounts (RAW 100%)
  unpaid30Days: number;
  dueNow30Days: number;
  // Teacher's percentage override for this student
  teacherPercentage: number | null;
  // Email-encoded percentage (e.g. 50 from "user50%@gmail.com")
  emailPercentage: number | null;
  // Legacy compat fields
  rawDueNow: number;
  adjustedDueNow: number;
  percentage: number;
  last30DaysRaw: number;
  last30DaysAdjusted: number;
}

// ============================================================================
// ATTENDANCE TYPES
// ============================================================================

export interface AttendanceRecord {
  id?: string;
  date: string;
  confirmedAt: string;
  type: 'confirmed' | 'missed';
  teacherEmail?: string;
}

export interface AttendanceStats {
  totalConfirmed: number;
  totalMissed: number;
  streak: number;
  firstConfirmationDate?: string;
}

export interface AttendanceData {
  user: {
    email: string;
    teacherEmail?: string;
    createdAt: string;
  };
  records: AttendanceRecord[];
  stats: AttendanceStats;
  needsTeacherAssignment: boolean;
}

export interface TeacherOption {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
}

// ============================================================================
// REFERRAL/LEADS TYPES
// ============================================================================

export interface ReferralRow {
  id: string;
  state: 'lead' | 'conversion';
  createdAt: string;
  firstClickAt: string;
  becameLeadAt: string;
  becameConversionAt: string | null;
  convertedAt: string | null;
  isConversion: boolean;
  isLead: boolean;
}

export interface ReferralsResponse extends SuccessResponse {
  rows: ReferralRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  mode: 'leads' | 'conversions';
  leadsCount: number;
  conversionsCount: number;
}

export interface ReferralsParams {
  email: string;
  mode: 'leads' | 'conversions';
  page: number;
  pageSize: number;
}

// ============================================================================
// ADMIN TYPES
// ============================================================================

export interface PendingAccount {
  aliasEmail: string;
  email: string;
  firstName: string;
  lastName: string;
  requestedAt: string;
  requestedPortalType: string;
  rewardfulEmail: string | null;
}

export interface ApprovalData {
  firstName: string;
  lastName: string;
  newAliasEmail?: string;
  rewardfulEmail: string;
  campaignId?: string;
  paypalEmail?: string;
  state?: string;
}

export interface PreCheckResult {
  exists: boolean;
  actionWillBe: 'MIGRATION' | 'NEW_USER';
  message: string;
  description: string;
  affiliate: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    state: string;
    unpaidCommission: number;
    totalPaid: number;
  } | null;
}

export interface ApprovalResult extends SuccessResponse {
  message: string;
  actionDescription: string;
  aliasEmail: string;
  originalAliasEmail: string;
  internalEmail: string;
  actionTaken: 'linked' | 'created';
  actionLabel: string;
  affiliateId: string;
  affiliateName: string;
  aliasEmailChanged: boolean;
  statusNote: string;
}

// ============================================================================
// PORTAL ACCESS
// ============================================================================

export type PortalType =
  | 'commission'
  | 'attendance'
  | 'student'
  | 'teacher'
  | 'clipper'
  | 'home';

export interface PortalAccessResult {
  hasAccess: boolean;
  reason?: 'not_logged_in' | 'not_teacher' | 'unknown_portal';
  user?: SessionUser;
}
