/**
 * google.script.run Compatibility Client (TypeScript)
 *
 * Type-safe wrapper for the compatibility API.
 * Use this in React components instead of the global shim.
 */

const API_ENDPOINT = '/api/gs-call';

/**
 * Result from a gs-call
 */
interface GsCallResult<T> {
  success: boolean;
  result?: T;
  error?: string;
}

/**
 * Call a legacy function via the compatibility API
 */
export async function gsCall<T = unknown>(
  functionName: string,
  ...args: unknown[]
): Promise<T> {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      function: functionName,
      args,
    }),
  });

  const data: GsCallResult<T> = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Unknown error');
  }

  return data.result as T;
}

/**
 * Typed function callers for common operations
 */
export const gs = {
  // Session
  async validateSessionToken(token: string) {
    return gsCall<{
      valid: boolean;
      user?: {
        email: string;
        displayEmail: string;
        name: string;
        isTeacher: boolean;
        isAdmin: boolean;
        isSupervisor?: boolean;
      };
      expiresAt?: number;
    }>('validateSessionToken', token);
  },

  async loginAndCreateSession(email: string, password: string) {
    return gsCall<{
      success: boolean;
      token?: string;
      expiresAt?: number;
      user?: object;
      error?: string;
    }>('loginAndCreateSession', email, password);
  },

  async logoutSession(token: string) {
    return gsCall<{ success: boolean }>('logoutSession', token);
  },

  // Navigation
  async getWebAppUrl() {
    return gsCall<string>('getWebAppUrl');
  },

  // Account Status
  async checkAccountStatus(email: string) {
    return gsCall<{
      status: string;
      canSetPassword: boolean;
      message?: string;
    }>('checkAccountStatus', email);
  },

  async requestAccountAccess(
    email: string,
    firstName?: string,
    lastName?: string,
    portalType?: string
  ) {
    return gsCall<{ success: boolean; error?: string }>(
      'requestAccountAccess',
      email,
      firstName,
      lastName,
      portalType
    );
  },

  // Password / Account
  async getRequestStatus(email: string) {
    return gsCall<{
      found: boolean;
      status?: string;
      message?: string;
      firstName?: string;
      lastName?: string;
      requestedAt?: string;
      canSetPassword?: boolean;
    }>('getRequestStatus', email);
  },

  async hasPasswordSet(email: string) {
    return gsCall<{ hasPassword: boolean }>('hasPasswordSet', email);
  },

  async validatePasswordSetupToken(token: string) {
    return gsCall<{ valid: boolean; email?: string; error?: string }>(
      'validatePasswordSetupToken',
      token
    );
  },

  async setPasswordWithToken(token: string, password: string, confirmPassword: string) {
    return gsCall<{ success: boolean; error?: string }>(
      'setPasswordWithToken',
      token,
      password,
      confirmPassword
    );
  },

  async setAffiliatePassword(email: string, password: string, confirmPassword: string) {
    return gsCall<{ success: boolean; error?: string }>(
      'setAffiliatePassword',
      email,
      password,
      confirmPassword
    );
  },

  async setApprovedAccountPassword(
    email: string,
    password: string,
    confirmPassword: string
  ) {
    return gsCall<{ success: boolean; error?: string }>(
      'setApprovedAccountPassword',
      email,
      password,
      confirmPassword
    );
  },

  // Commission
  async lookupAffiliate(email: string, token?: string) {
    return gsCall<Record<string, unknown>>(
      'lookupAffiliate',
      email,
      token
    );
  },

  async saveAdminOverride(email: string, overrideData: object) {
    return gsCall<{ success: boolean; error?: string }>(
      'saveAdminOverride',
      email,
      overrideData
    );
  },

  async removeAdminOverride(email: string) {
    return gsCall<{ success: boolean; error?: string }>(
      'removeAdminOverride',
      email
    );
  },

  async getExistingOverride(email: string) {
    return gsCall<{ success: boolean; override?: object }>(
      'getExistingOverride',
      email
    );
  },

  async getRawApiData(email: string) {
    return gsCall<Record<string, unknown>>(
      'getRawApiData',
      email
    );
  },

  async adminPreCheckInternalEmail(email: string, token?: string) {
    return gsCall<{ success: boolean; exists?: boolean; affiliate?: Record<string, unknown>; description?: string; error?: string }>(
      'adminPreCheckInternalEmail',
      email,
      token
    );
  },

  async adminRejectAccount(email: string, reason: string, token: string) {
    return gsCall<{ success: boolean; error?: string }>(
      'adminRejectAccount',
      email,
      reason,
      token
    );
  },

  async clearAllCaches() {
    return gsCall<{ success: boolean }>('clearAllCaches');
  },

  async adminSetSupervisor(userEmail: string, isSupervisor: boolean, token: string) {
    return gsCall<{ success: boolean; error?: string }>('adminSetSupervisor', userEmail, isSupervisor, token);
  },

  // Teacher
  async getTeacherDataWithContext(email: string, token: string) {
    return gsCall<{ success: boolean; data?: object; error?: string }>(
      'getTeacherDataWithContext',
      email,
      token
    );
  },

  // Teacher–Student assignment (request + approval)
  async getStudentCurrentTeacher(token: string, viewAsEmail?: string) {
    return gsCall<{
      success: boolean;
      data?: { teacher: { id: string; email: string; name: string } | null; openRequest: { id: string; toTeacherName: string; requestedAt: string } | null };
      error?: string;
    }>('getStudentCurrentTeacher', token, viewAsEmail);
  },

  async getEligibleTeachersForAssignment(token: string) {
    return gsCall<{ success: boolean; teachers?: { id: string; email: string; name: string; firstName: string; lastName: string }[]; error?: string }>(
      'getEligibleTeachersForAssignment',
      token
    );
  },

  async createTeacherChangeRequest(token: string, toTeacherId: string, message?: string) {
    return gsCall<{
      success: boolean;
      request?: { id: string; status: string; toTeacherName: string; requestedAt: string };
      error?: string;
    }>('createTeacherChangeRequest', token, toTeacherId, message);
  },

  async cancelTeacherChangeRequest(token: string) {
    return gsCall<{ success: boolean; error?: string }>('cancelTeacherChangeRequest', token);
  },

  async getTeacherOpenRequests(token: string) {
    return gsCall<{
      success: boolean;
      requests?: { id: string; studentId: string; studentEmail: string; studentName: string; fromTeacherName: string | null; requestedAt: string; message: string | null; status: string }[];
      error?: string;
    }>('getTeacherOpenRequests', token);
  },

  async acceptTeacherChangeRequest(token: string, requestId: string) {
    return gsCall<{ success: boolean; error?: string }>('acceptTeacherChangeRequest', token, requestId);
  },

  async rejectTeacherChangeRequest(token: string, requestId: string) {
    return gsCall<{ success: boolean; error?: string }>('rejectTeacherChangeRequest', token, requestId);
  },

  async removeStudentFromTeacherByTeacherSession(token: string, studentId: string) {
    return gsCall<{ success: boolean; error?: string }>('removeStudentFromTeacherByTeacherSession', token, studentId);
  },

  // Attendance
  async getAttendanceData(email: string, token: string, mode?: string) {
    return gsCall<{ success: boolean; data?: object; error?: string }>(
      'getAttendanceData',
      email,
      token,
      mode || 'live'
    );
  },

  async confirmAttendance(email: string, dateStr: string, token: string, mode?: string) {
    return gsCall<{ success: boolean; error?: string }>(
      'confirmAttendance',
      email,
      dateStr,
      token,
      mode || 'live'
    );
  },

  async getAllValidTeachers() {
    return gsCall<{ success: boolean; teachers?: object[] }>(
      'getAllValidTeachers'
    );
  },

  // Referrals
  async getReferralsWithMode(params: {
    email: string;
    mode: 'leads' | 'conversions';
    page: number;
    pageSize: number;
  }) {
    return gsCall<{
      success: boolean;
      rows?: object[];
      totalCount?: number;
      leadsCount?: number;
      conversionsCount?: number;
    }>('getReferralsWithMode', params);
  },

  // Portal access
  async checkPortalAccess(token: string, portal: string) {
    return gsCall<{ hasAccess: boolean; reason?: string }>(
      'checkPortalAccess',
      token,
      portal
    );
  },

  // Admin
  async adminGetPendingAccounts(token: string) {
    return gsCall<{ success: boolean; pending?: object[]; count?: number }>(
      'adminGetPendingAccounts',
      token
    );
  },

  async adminApproveAccount(
    originalEmail: string,
    approvalData: object,
    token: string
  ) {
    return gsCall<{ success: boolean; error?: string }>(
      'adminApproveAccount',
      originalEmail,
      approvalData,
      token
    );
  },
};

/**
 * Session token helpers
 */
export const SESSION_TOKEN_KEY = 'tradersutopia_session_token';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

/**
 * Hook-friendly session check
 */
export async function checkSession(): Promise<{
  isLoggedIn: boolean;
  user?: {
    email: string;
    displayEmail: string;
    name: string;
    isTeacher: boolean;
    isAdmin: boolean;
  };
}> {
  const token = getStoredToken();
  if (!token) {
    return { isLoggedIn: false };
  }

  try {
    const result = await gs.validateSessionToken(token);
    if (result.valid && result.user) {
      return { isLoggedIn: true, user: result.user };
    }
    // Token invalid, clear it
    clearStoredToken();
    return { isLoggedIn: false };
  } catch {
    clearStoredToken();
    return { isLoggedIn: false };
  }
}
