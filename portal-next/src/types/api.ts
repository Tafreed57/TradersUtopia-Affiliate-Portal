/**
 * API Request/Response Types
 *
 * Types for the Next.js API routes that will mirror the legacy functions.
 */

import { z } from 'zod';

// ============================================================================
// ZOD SCHEMAS FOR VALIDATION
// ============================================================================

// Email validation
export const emailSchema = z.string().email().transform((e) => e.toLowerCase().trim());

// Password validation
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// Session token validation
export const sessionTokenSchema = z.string().min(64);

// ============================================================================
// AUTH SCHEMAS
// ============================================================================

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const validateSessionRequestSchema = z.object({
  token: sessionTokenSchema,
});

export const logoutRequestSchema = z.object({
  token: sessionTokenSchema,
});

export const setPasswordRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const requestAccessSchema = z.object({
  aliasEmail: emailSchema,
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  portalType: z.enum(['affiliate', 'teacher', 'student']).default('affiliate'),
});

// ============================================================================
// COMMISSION SCHEMAS
// ============================================================================

export const lookupAffiliateRequestSchema = z.object({
  email: emailSchema,
  sessionToken: sessionTokenSchema.optional(),
});

export const saveOverrideRequestSchema = z.object({
  email: emailSchema,
  token: sessionTokenSchema,
  override: z.object({
    unpaidAmount: z.number().optional(),
    dueNowAmount: z.number().optional(),
    totalPaidAmount: z.number().optional(),
    note: z.string().optional(),
    reason: z.string().optional(),
  }),
});

// ============================================================================
// TEACHER SCHEMAS
// ============================================================================

export const getTeacherDataRequestSchema = z.object({
  email: emailSchema,
  token: sessionTokenSchema,
});

export const addStudentRequestSchema = z.object({
  teacherEmail: emailSchema,
  studentEmail: emailSchema,
  token: sessionTokenSchema,
});

export const removeStudentRequestSchema = z.object({
  teacherEmail: emailSchema,
  studentEmail: emailSchema,
});

export const setStudentPercentageRequestSchema = z.object({
  teacherEmail: emailSchema,
  studentEmail: emailSchema,
  percentage: z.number().min(0).max(100),
});

export const updateEarningsRequestSchema = z.object({
  teacherEmail: emailSchema,
  token: sessionTokenSchema,
});

export const recordPayoutRequestSchema = z.object({
  teacherEmail: emailSchema,
  amount: z.number().positive(),
  token: sessionTokenSchema,
});

// ============================================================================
// ATTENDANCE SCHEMAS
// ============================================================================

export const getAttendanceDataRequestSchema = z.object({
  email: emailSchema,
  token: sessionTokenSchema,
});

export const confirmAttendanceRequestSchema = z.object({
  email: emailSchema,
  dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  token: sessionTokenSchema,
});

export const setTeacherRequestSchema = z.object({
  studentEmail: emailSchema,
  teacherEmail: emailSchema,
});

export const loginWithEmailRequestSchema = z.object({
  email: emailSchema,
});

export const completeLoginWithTeacherRequestSchema = z.object({
  email: emailSchema,
  teacherEmail: emailSchema,
});

// ============================================================================
// REFERRALS SCHEMAS
// ============================================================================

export const getReferralsRequestSchema = z.object({
  email: emailSchema,
  mode: z.enum(['leads', 'conversions']).default('leads'),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25),
});

export const getStudentReferralsRequestSchema = z.object({
  teacherEmail: emailSchema,
  studentEmail: emailSchema,
  mode: z.enum(['leads', 'conversions']).default('leads'),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25),
});

// ============================================================================
// ADMIN SCHEMAS
// ============================================================================

export const adminApproveAccountRequestSchema = z.object({
  originalAliasEmail: emailSchema,
  token: sessionTokenSchema,
  approvalData: z.object({
    firstName: z.string(),
    lastName: z.string(),
    newAliasEmail: emailSchema.optional(),
    rewardfulEmail: z.string().min(1, 'Internal email is required'),
    campaignId: z.string().optional(),
    paypalEmail: emailSchema.optional(),
    state: z.string().optional(),
  }),
});

export const adminRejectAccountRequestSchema = z.object({
  email: emailSchema,
  reason: z.string().optional(),
  token: sessionTokenSchema,
});

export const adminPreCheckEmailRequestSchema = z.object({
  internalEmail: z.string().min(1),
  token: sessionTokenSchema,
});

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SetPasswordRequest = z.infer<typeof setPasswordRequestSchema>;
export type RequestAccessRequest = z.infer<typeof requestAccessSchema>;
export type LookupAffiliateRequest = z.infer<typeof lookupAffiliateRequestSchema>;
export type GetTeacherDataRequest = z.infer<typeof getTeacherDataRequestSchema>;
export type AddStudentRequest = z.infer<typeof addStudentRequestSchema>;
export type GetAttendanceDataRequest = z.infer<typeof getAttendanceDataRequestSchema>;
export type ConfirmAttendanceRequest = z.infer<typeof confirmAttendanceRequestSchema>;
export type GetReferralsRequest = z.infer<typeof getReferralsRequestSchema>;
export type AdminApproveAccountRequest = z.infer<typeof adminApproveAccountRequestSchema>;
