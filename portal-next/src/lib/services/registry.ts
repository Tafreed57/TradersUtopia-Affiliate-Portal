/**
 * Function Registry
 *
 * Maps legacy function names to their implementations.
 * This registry is used by the /api/gs-call endpoint to route requests.
 */

import * as authService from './auth.service';
import * as sessionService from './session.service';
import * as commissionService from './commission.service';
import * as teacherService from './teacher.service';
import * as attendanceService from './attendance.service';
import * as referralService from './referral.service';
import * as adminService from './admin.service';
import * as navigationService from './navigation.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => Promise<any> | any;

/**
 * Registry of all legacy functions mapped to their implementations.
 *
 * These function names must match exactly what the frontend calls via
 * google.script.run.functionName()
 */
export const functionRegistry: Record<string, AnyFunction> = {
  // ========================================================================
  // NAVIGATION & UTILITY
  // ========================================================================
  getWebAppUrl: navigationService.getWebAppUrl,

  // ========================================================================
  // SESSION & AUTH
  // ========================================================================
  validateSessionToken: sessionService.validateSessionToken,
  loginAndCreateSession: sessionService.loginAndCreateSession,
  logoutSession: sessionService.logoutSession,
  createSession: sessionService.createSession,
  getCurrentUser: sessionService.getCurrentUser,
  checkPortalAccess: sessionService.checkPortalAccess,

  // ========================================================================
  // PASSWORD & ACCOUNT STATUS
  // ========================================================================
  verifyAffiliatePassword: authService.verifyAffiliatePassword,
  setAffiliatePassword: authService.setAffiliatePassword,
  setApprovedAccountPassword: authService.setApprovedAccountPassword,
  setPasswordWithToken: authService.setPasswordWithToken,
  validatePasswordSetupToken: authService.validatePasswordSetupToken,
  checkAccountStatus: authService.checkAccountStatus,
  getRequestStatus: authService.getRequestStatus,
  requestAccountAccess: authService.requestAccountAccess,
  checkAffiliateExists: authService.checkAffiliateExists,
  hasPasswordSet: authService.hasPasswordSet,
  checkLegacyEmailLogin: authService.checkLegacyEmailLogin,

  // ========================================================================
  // COMMISSION LOOKUP
  // ========================================================================
  lookupAffiliate: commissionService.lookupAffiliate,
  getExistingOverride: commissionService.getExistingOverride,
  getRawApiData: commissionService.getRawApiData,
  saveAdminOverride: commissionService.saveAdminOverride,
  removeAdminOverride: commissionService.removeAdminOverride,
  saveAffiliateOverride: commissionService.saveAdminOverride, // Alias

  // ========================================================================
  // TEACHER PORTAL
  // ========================================================================
  verifyTeacherAccess: teacherService.verifyTeacherAccess,
  getTeacherDataWithContext: teacherService.getTeacherDataWithContext,
  getStudentsCommissionData: teacherService.getStudentsCommissionData,
  addStudentToTeacherWithContext: teacherService.addStudentToTeacherWithContext,
  removeStudentFromTeacher: teacherService.removeStudentFromTeacher,
  setStudentPercentageOverride: teacherService.setStudentPercentageOverride,
  updateTeacherEarnings: teacherService.updateTeacherEarnings,
  getTeacherEarningsHistory: teacherService.getTeacherEarningsHistory,
  recordTeacherPayout: teacherService.recordTeacherPayout,
  recordTeacherPayment: teacherService.recordTeacherPayout, // GAS alias
  getAllTeachersPaymentData: teacherService.getAllTeachersPaymentData,

  // ========================================================================
  // ATTENDANCE PORTAL
  // ========================================================================
  loginAttendanceWithEmail: attendanceService.loginAttendanceWithEmail,
  completeAttendanceLoginWithTeacher: attendanceService.completeAttendanceLoginWithTeacher,
  getAttendanceData: attendanceService.getAttendanceData,
  confirmAttendance: attendanceService.confirmAttendance,
  getAllValidTeachers: attendanceService.getAllValidTeachers,
  setTeacherForAttendanceUser: attendanceService.setTeacherForAttendanceUser,
  getTeacherForAttendanceUser: attendanceService.getTeacherForAttendanceUser,
  deleteOwnAttendanceRecord: attendanceService.deleteOwnAttendanceRecord,
  deleteAttendanceUser: attendanceService.deleteAttendanceUser,

  // ========================================================================
  // REFERRALS / LEADS
  // ========================================================================
  getReferralsWithMode: referralService.getReferralsWithMode,
  getStudentReferralsForTeacher: referralService.getStudentReferralsForTeacher,
  getReferralData: referralService.getReferralData,

  // ========================================================================
  // ADMIN FUNCTIONS
  // ========================================================================
  adminGetPendingAccounts: adminService.adminGetPendingAccounts,
  adminPreCheckInternalEmail: adminService.adminPreCheckInternalEmail,
  adminApproveAccount: adminService.adminApproveAccount,
  adminRejectAccount: adminService.adminRejectAccount,
  getAllAttendanceUsers: adminService.getAllAttendanceUsers,
  searchAttendanceUsers: adminService.searchAttendanceUsers,
  getStudentAttendanceStats: adminService.getStudentAttendanceStats,
  deleteAttendanceRecord: adminService.deleteAttendanceRecord,
  clearAllCaches: adminService.clearAllCaches,
  adminStartManageUser: adminService.adminStartManageUser,
  adminStopManageUser: adminService.adminStopManageUser,
  adminGetStudentDashboard: adminService.adminGetStudentDashboard,
  adminUpdateAliasEmail: adminService.adminUpdateAliasEmail,
  adminUpdateInternalEmail: adminService.adminUpdateInternalEmail,
  adminUpdateStudentTeacher: adminService.adminUpdateStudentTeacher,
  resetAllAttendance: adminService.resetAllAttendance,
  fetchAffiliateCampaigns: adminService.fetchAffiliateCampaigns,
  adminDeleteOrphanedLegacy: adminService.adminDeleteOrphanedLegacy,
  adminCleanupAllOrphanedLegacy: adminService.adminCleanupAllOrphanedLegacy,
};

// Export function names as a type for type safety
export type FunctionName = keyof typeof functionRegistry;

// Export list of all function names
export const availableFunctions = Object.keys(functionRegistry) as FunctionName[];
