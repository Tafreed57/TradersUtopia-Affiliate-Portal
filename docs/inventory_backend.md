# Backend Function Inventory

## Code.js (~15,815 lines, ~280 functions)

This document catalogs every function in the legacy `Code.js` backend, organized by domain.

---

## Global Configuration (Lines 1-50)

| Function/Constant | Type | Description |
|-------------------|------|-------------|
| `BASE_URL` | const | Rewardful API base URL |
| `WEB_APP_URL` | const | Deployed web app URL |
| `ADMIN_EMAILS` | array | List of admin email addresses |
| `TEACHER_OVERRIDE_EMAILS` | array | Emails granted teacher access |
| `CAD_RATE` | const | USD to CAD conversion rate (1.4) |

---

## Utility Functions (Lines 50-500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `getWebAppUrl()` | PUBLIC | - | string | Returns web app URL for navigation |
| `log_(message)` | private | message: string | void | Internal logging utility |
| `safeParseJson_(text)` | private | text: string | object/null | Safe JSON parse with error handling |
| `round2_(num)` | private | num: number | number | Round to 2 decimal places |
| `toNum_(val)` | private | val: any | number | Convert to number safely |
| `firstNotEmpty_(...args)` | private | ...values | any | Return first truthy value |

---

## Cache Functions (Lines 100-300)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `getCachedApiResponse_(key)` | private | key: string | object/null | Get cached API response |
| `setCachedApiResponse_(key, data, ttl)` | private | key, data, ttl | void | Cache API response |
| `clearCache_()` | private | - | void | Clear all cache entries |
| `clearTeacherCache_(email)` | private | email: string | void | Clear teacher-specific cache |
| `clearStudentCache_(email)` | private | email: string | void | Clear student-specific cache |
| `clearAllCaches()` | PUBLIC | - | object | Clear all caches (admin) |

---

## Admin Functions (Lines 300-800)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `isAdmin_()` | private | - | boolean | Check if current user is admin (GAS Session) |
| `isAdminEmail_(email)` | private | email: string | boolean | Check if email is in admin list |
| `isAdminSession_(token)` | private | token: string | boolean | Check if session belongs to admin |
| `isAdminAny_(sessionToken)` | private | sessionToken?: string | boolean | Check admin by any method |
| `isLegacyEmail_(email)` | private | email: string | boolean | Check if email is internal/legacy format |
| `findAliasForInternalEmail_(email)` | private | email: string | string/null | Find alias email for internal email |
| `getAdminOverrideKey_(email)` | private | email: string | string | Generate admin override storage key |
| `setAdminOverride_(email, data)` | private | email, data | void | Save admin override |
| `getAdminOverride_(email)` | private | email: string | object/null | Get admin override |
| `adminStartManageUser(token, email)` | PUBLIC | token, email | object | Start managing another user (admin) |
| `adminStopManageUser(token)` | PUBLIC | token | object | Stop managing user |
| `logAdminAction_(action, details)` | private | action, details | void | Log admin action for audit |
| `getAdminAuditLogs(limit)` | PUBLIC | limit: number | object | Get admin audit log entries |

---

## Commission/Affiliate Functions (Lines 800-2500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `lookupAffiliate(email, sessionToken)` | PUBLIC | email, sessionToken | object | Main commission lookup with incremental tracking |
| `sumDueNowForAffiliate_(affiliateId, apiKey)` | private | affiliateId, apiKey | object | Calculate total due/unpaid/paid |
| `extractCommissions_(payload)` | private | payload: object | array | Extract commissions from API response |
| `extractAffiliate_(payload)` | private | payload: object | object | Extract affiliate from API response |
| `fetchWithRetry_(url, apiKey)` | private | url, apiKey | HTTPResponse | Fetch with 429 backoff (3 retries) |
| `authHeaders_(apiKey)` | private | apiKey: string | object | Generate auth headers |
| `getApiKey_()` | private | - | string | Get Rewardful API key from properties |
| `checkLegacyEmailLogin(email)` | PUBLIC | email: string | object | Check if email is legacy/internal |
| `getExistingOverride(email)` | PUBLIC | email: string | object | Get existing admin override |
| `saveAffiliateOverride(email, data, token)` | PUBLIC | email, data, token | object | Save admin override (alias for admin) |
| `saveAdminOverride(email, data, token)` | PUBLIC | email, data, token | object | Save admin override |
| `removeAdminOverride(email, token)` | PUBLIC | email, token | object | Remove admin override |
| `removeAffiliateOverride(email, token)` | PUBLIC | email, token | object | Remove admin override (alias) |

---

## Incremental Tracking Functions (Lines 2500-2800)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `resetIncrementalTracking(email)` | PUBLIC | email: string | object | Reset tracking for single email |
| `resetAllIncrementalTracking()` | PUBLIC | - | object | Reset all incremental tracking |
| `getTrackingDebugInfo(email)` | PUBLIC | email: string | object | Get debug info for tracking |
| `getRawApiData(email)` | PUBLIC | email: string | object | Get raw API data (admin debug) |

---

## Spreadsheet Integration (Lines 2800-3500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `insertLookupIntoRow_(row, email, data)` | private | row, email, data | void | Insert lookup data into spreadsheet row |
| `insertFromSidebarPrompt_(email)` | private | email: string | void | Insert from sidebar |
| `refreshSelectedRows()` | PUBLIC | - | void | Refresh selected rows in spreadsheet |
| `refreshAllRows()` | PUBLIC | - | void | Refresh all rows |
| `findRowByEmail_(sheet, email)` | private | sheet, email | number/null | Find row by email |
| `addNewEmailRow_(sheet, email)` | private | sheet, email | number | Add new row for email |
| `writeRow_(sheet, row, data)` | private | sheet, row, data | void | Write data to row |

---

## Teacher Portal Functions (Lines 5500-7500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `verifyTeacherAccess(email)` | PUBLIC | email: string | object | Verify user has teacher access |
| `getTeacherData(email, skipLegacy)` | PUBLIC | email, skipLegacy | object | Get teacher data with students |
| `getTeacherDataWithContext(email, token)` | PUBLIC | email, token | object | Get teacher data (session-aware) |
| `addStudentToTeacherByFullName(teacher, name)` | PUBLIC | teacher, name | object | Add student by name search |
| `addStudentToTeacherByEmail(teacher, student)` | PUBLIC | teacher, student | object | Add student by email |
| `addStudentToTeacherWithContext(teacher, student, token)` | PUBLIC | teacher, student, token | object | Add student (session-aware) |
| `removeStudentFromTeacher(teacher, student)` | PUBLIC | teacher, student | object | Remove student (soft delete) |
| `setStudentPercentageOverride(teacher, student, pct)` | PUBLIC | teacher, student, pct | object | Set student percentage |
| `getStudentPercentageOverride(teacher, student)` | PUBLIC | teacher, student | object | Get student percentage |
| `getAllStudentPercentageOverrides(teacher)` | PUBLIC | teacher: string | object | Get all overrides for teacher |
| `getTeacherStudentsKey_(email)` | private | email: string | string | Generate storage key |
| `resolveStudentByEmail_(email)` | private | email: string | object | Resolve student email to affiliate |

---

## Teacher Earnings Functions (Lines 6500-7500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `getTeacherEarningsHistory(teacher)` | PUBLIC | teacher: string | object | Get earnings history |
| `saveTeacherEarningsHistory(teacher, data)` | private | teacher, data | void | Save earnings history |
| `updateTeacherEarnings(teacher, token)` | PUBLIC | teacher, token | object | Update/lock current earnings |
| `recordTeacherPayout(teacher, amount, token)` | PUBLIC | teacher, amount, token | object | Record payment to teacher |
| `resetTeacherEarnings(teacher)` | PUBLIC | teacher: string | object | Reset earnings (admin) |
| `calculate30DaysRawByAffiliateId_(affId, apiKey)` | private | affId, apiKey | number | Calculate 30-day raw commissions |
| `getRawStudentCommissionData_(student, apiKey)` | private | student, apiKey | object | Get raw commission data |
| `getStudentsCommissionData(teacher, token)` | PUBLIC | teacher, token | object | Get all students' commission data |
| `calculateLast30DaysCommissionsAdjusted_(email)` | private | email: string | number | Calculate adjusted 30-day commissions |
| `calculateLast30DaysCommissionsRaw_(email)` | private | email: string | number | Calculate raw 30-day commissions |

---

## Teacher Payment Tracking (Lines 7500-8500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `getTeacherPaymentKey_(email)` | private | email: string | string | Generate payment storage key |
| `getTeacherPercentageKey_(email)` | private | email: string | string | Generate percentage storage key |
| `saveTeacherAdjustmentPercentage(teacher, pct)` | PUBLIC | teacher, pct | object | Save teacher's percentage |
| `getTeacherAdjustmentPercentage(teacher)` | PUBLIC | teacher: string | object | Get teacher's percentage |
| `getRawDueNowForStudent_(student, apiKey)` | private | student, apiKey | number | Get raw due now amount |
| `getAllTeachersPaymentData()` | PUBLIC | - | object | Get all teachers' payment data (admin) |
| `recordTeacherPayment(teacher, amount, token)` | PUBLIC | teacher, amount, token | object | Record teacher payment |

---

## Attendance Portal Functions (Lines 8500-10500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `hashPassword_(password, salt)` | private | password, salt | string | SHA-256 hash with iterations |
| `getAttendanceUserKey_(email)` | private | email: string | string | Generate user storage key |
| `getAttendanceUserWithMigration_(email)` | private | email: string | object | Get user with auto-migration |
| `hasAttendanceData_(email)` | private | email: string | boolean | Check if user has attendance data |
| `getAttendanceRecordKey_(email, date)` | private | email, date | string | Generate record storage key |
| `getTodayDateString_()` | private | - | string | Get today's date string |
| `registerAttendanceUser(email, password)` | PUBLIC | email, password | object | Register new attendance user |
| `loginAttendanceUser(email, password)` | PUBLIC | email, password | object | Legacy login (deprecated) |
| `findAffiliateByEmail_(email, apiKey)` | private | email, apiKey | object/null | Find affiliate by email |
| `loginAttendanceWithEmail(email)` | PUBLIC | email: string | object | Login after password verification |
| `completeAttendanceLoginWithTeacher(email, teacher)` | PUBLIC | email, teacher | object | Complete login with teacher selection |
| `validateSession(token)` | PUBLIC | token: string | object | Validate attendance session |
| `confirmAttendance(email, dateStr, token)` | PUBLIC | email, dateStr, token | object | Confirm daily attendance |
| `deleteAttendanceRecord(email, dateStr, token)` | PUBLIC | email, dateStr, token | object | Delete attendance record (admin) |
| `resetAllAttendance(email)` | PUBLIC | email: string | object | Reset all attendance (admin) |
| `diagnoseAttendanceStorage(email)` | PUBLIC | email: string | object | Diagnose storage issues |
| `getAttendanceData(email, token)` | PUBLIC | email, token | object | Get attendance data with missed days |
| `parseDateString_(dateStr)` | private | dateStr: string | Date | Parse date string |
| `formatDateToString_(date)` | private | date: Date | string | Format date to string |
| `getAllAttendanceUsers()` | PUBLIC | - | object | Get all users (admin) |
| `searchAttendanceUsers(query)` | PUBLIC | query: string | object | Search users (admin) |
| `getAttendanceStats(email)` | PUBLIC | email: string | object | Get attendance statistics |

---

## Teacher Access Helpers (Lines 9500-10000)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `isTeacherByFirstName_(firstName)` | private | firstName: string | boolean | Check if first name contains "teacher" |
| `isTeacherOverrideEmail_(email)` | private | email: string | boolean | Check if email in override list |
| `hasTeacherAccess_(firstName, email)` | private | firstName, email | boolean | Combined teacher access check |
| `getAllValidTeachers()` | PUBLIC | - | object | Get all valid teachers (paginated) |

---

## Student-Teacher Linking (Lines 10000-10500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `setTeacherForAttendanceUser(student, teacher)` | PUBLIC | student, teacher | object | Set student's teacher (canonical) |
| `getTeacherForAttendanceUser(student)` | PUBLIC | student: string | object | Get student's teacher |
| `getStudentAttendanceStats(teacher, student, token)` | PUBLIC | teacher, student, token | object | Get student stats for teacher view |

---

## Affiliate Percentage Diagnostics (Lines 10500-11000)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `diagnoseAffiliatePercentage(email)` | PUBLIC | email: string | object | Diagnose percentage issues |
| `fixAffiliatePercentage(email, mode)` | PUBLIC | email, mode | object | Auto-fix percentage issues |
| `autoCorrectAllAffiliatePercentages()` | PUBLIC | - | object | Auto-correct all percentages |
| `auditAllAffiliatePercentages()` | PUBLIC | - | object | Audit all percentages |

---

## Referrals/Leads Functions (Lines 11000-12500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `REFERRAL_CACHE_DURATION_MS` | const | - | number | Cache duration (15 min) |
| `getReferralDataKey_(email)` | private | email: string | string | Generate storage key |
| `getStoredReferralData_(email)` | private | email: string | object/null | Get stored metadata |
| `saveReferralData_(email, data)` | private | email, data | void | Save metadata |
| `getLeadsCacheKey_(email)` | private | email: string | string | Generate cache key |
| `cacheLeadsForUser_(email, leads)` | private | email, leads | void | Cache leads with chunking |
| `getCachedLeads_(email)` | private | email: string | array | Get cached leads (reconstruct chunks) |
| `isVisitor_(ref)` | private | ref: object | boolean | Check if referral is visitor |
| `isLead_(ref)` | private | ref: object | boolean | Check if referral is lead |
| `isConversion_(ref)` | private | ref: object | boolean | Check if referral is conversion |
| `fetchAllReferralsFromRewardful_(affId, apiKey)` | private | affId, apiKey | object | Fetch all referrals with pagination |
| `getReferralData(email, forceRefresh)` | PUBLIC | email, forceRefresh | object | Get referral data (cached or fresh) |
| `returnStoredDataWithWarning_(stored, warning, email)` | private | stored, warning, email | object | Return cached data on error |
| `getReferralsWithMode(params)` | PUBLIC | params: object | object | Get referrals with mode filter |
| `getStudentReferralsForTeacher(teacher, student, mode, page, size)` | PUBLIC | ... | object | Get student referrals (authorized) |
| `prepareLeadsForDisplay_(leads)` | private | leads: array | array | Prepare leads for frontend |
| `debugReferralData(email)` | PUBLIC | email: string | object | Debug referral data (admin) |
| `clearReferralData(email)` | PUBLIC | email: string | object | Clear referral data (admin) |
| `testLeadsFetching()` | PUBLIC | - | object | Test leads fetching |

---

## Authentication System (Lines 12500-14500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `AUTH_PREFIX` | const | - | string | Auth record key prefix |
| `AUTH_LOCKOUT_MINUTES` | const | - | number | Lockout duration (15 min) |
| `AUTH_MAX_FAILED_ATTEMPTS` | const | - | number | Max failed attempts (5) |
| `AUTH_MIN_PASSWORD_LENGTH` | const | - | number | Min password length (8) |
| `normalizeAuthEmail_(email)` | private | email: string | string | Normalize email for auth |
| `getAuthKey_(email)` | private | email: string | string | Generate auth storage key |
| `generateSalt_()` | private | - | string | Generate random salt |
| `hashPassword_(password, salt)` | private | password, salt | string | Hash with 10,000 iterations |
| `getAuthRecord_(email)` | private | email: string | object/null | Get auth record |
| `saveAuthRecord_(email, record)` | private | email, record | void | Save auth record |
| `deleteAuthRecord_(email)` | private | email: string | void | Delete auth record |
| `getAccountStatus_(email)` | private | email: string | string/null | Get account status |
| `canUserLogin_(email)` | private | email: string | object | Check if user can login |
| `checkAccountStatus(email)` | PUBLIC | email: string | object | Check account status (frontend) |
| `getRequestStatus(email)` | PUBLIC | email: string | object | Get request status for user |
| `findRecordByOriginalEmail_(email)` | private | email: string | object/null | Find by original email |
| `requestAccountAccess(email, first, last, type)` | PUBLIC | ... | object | Request account access |
| `setApprovedAccountPassword(email, pass, confirm)` | PUBLIC | ... | object | Set password for approved account |
| `validatePasswordStrength_(password)` | private | password: string | object | Validate password requirements |
| `checkLoginAllowed_(email)` | private | email: string | object | Check rate limiting |
| `recordFailedLogin_(email)` | private | email: string | void | Record failed attempt |
| `recordSuccessfulLogin_(email)` | private | email: string | void | Record successful login |
| `setAffiliatePassword(email, pass, confirm)` | PUBLIC | ... | object | Set affiliate password |
| `verifyAffiliatePassword(email, password)` | PUBLIC | email, password | object | Verify password |
| `hasPasswordSet(email)` | PUBLIC | email: string | object | Check if password set |
| `checkAffiliateExists(email)` | PUBLIC | email: string | object | Check if affiliate exists |
| `adminResetPassword(email)` | PUBLIC | email: string | object | Reset password (admin) |
| `adminUnlockAccount(email)` | PUBLIC | email: string | object | Unlock account (admin) |
| `adminGetAuthStatus(email)` | PUBLIC | email: string | object | Get auth status (admin) |

---

## Password Setup Token System (Lines 13500-13800)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `TOKEN_PREFIX` | const | - | string | Token key prefix |
| `TOKEN_EXPIRY_HOURS` | const | - | number | Token expiry (48 hours) |
| `generatePasswordToken_(email)` | private | email: string | string | Generate setup token |
| `validatePasswordToken_(token)` | private | token: string | string/null | Validate token, return email |
| `consumePasswordToken_(token)` | private | token: string | void | Delete token after use |
| `validatePasswordSetupToken(token)` | PUBLIC | token: string | object | Validate token (frontend) |
| `setPasswordWithToken(token, pass, confirm)` | PUBLIC | ... | object | Set password via token |
| `sendPasswordSetupEmail_(email, firstName)` | private | email, firstName | object | Send setup email |

---

## Admin Account Management (Lines 13800-14200)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `adminGetPendingAccounts(token)` | PUBLIC | token: string | object | Get pending account requests |
| `adminGetAccountRequest(email)` | PUBLIC | email: string | object | Get account request details |
| `adminApproveAccount(alias, data, token)` | PUBLIC | alias, data, token | object | Approve account request |
| `adminPreCheckInternalEmail(email, token)` | PUBLIC | email, token | object | Pre-check internal email |
| `adminRejectAccount(email, reason, token)` | PUBLIC | email, reason, token | object | Reject account request |
| `adminDeleteAccountRequest(email)` | PUBLIC | email: string | object | Delete account request |
| `affiliateExists_(email)` | private | email: string | boolean | Check if affiliate exists in Rewardful |

---

## Rewardful API Integration (Lines 13300-13500)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `fetchRewardfulCampaigns(token)` | PUBLIC | token: string | object | Fetch all campaigns |
| `fetchAffiliateCampaigns()` | PUBLIC | - | object | Alias for fetchRewardfulCampaigns |
| `upsertRewardfulAffiliate_(email, first, last, campaign, paypal, opts)` | private | ... | object | Create or update affiliate |
| `createAffiliateInSystem_(email, first, last, campaign, paypal, opts)` | private | ... | object | Create new affiliate |
| `getAffiliateByEmail_(email)` | private | email: string | object/null | Get affiliate by email |

---

## Session Management (Lines 14600-15000)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `SESSION_PREFIX` | const | - | string | Session key prefix |
| `SESSION_DURATION_HOURS` | const | - | number | Session duration (12 hours) |
| `SESSION_TOKEN_LENGTH` | const | - | number | Token length (64 chars) |
| `generateSessionToken_()` | private | - | string | Generate secure token |
| `getSessionKey_(token)` | private | token: string | string | Generate session storage key |
| `storeSession_(token, data)` | private | token, data | void | Store session (cache + props) |
| `getSession_(token)` | private | token: string | object/null | Get session data |
| `deleteSession_(token)` | private | token: string | void | Delete session |
| `validateSession_(token)` | private | token: string | object/null | Validate and update session |
| `createSession(email)` | PUBLIC | email: string | object | Create new session |
| `getUserInfoForSession_(email)` | private | email: string | object | Get user info for session |
| `validateSessionToken(token)` | PUBLIC | token: string | object | Validate session (frontend) |
| `getCurrentUser(token)` | PUBLIC | token: string | object/null | Get current user |
| `logoutSession(token)` | PUBLIC | token: string | object | Logout/invalidate session |
| `loginAndCreateSession(email, password)` | PUBLIC | email, password | object | Full login flow |
| `checkPortalAccess(token, portal)` | PUBLIC | token, portal | object | Check portal access |
| `adminListActiveSessions()` | PUBLIC | - | object | List active sessions (admin) |
| `adminClearAllSessions()` | PUBLIC | - | object | Clear all sessions (admin) |

---

## Canonical Teacher-Student Linking (Lines 15100-15700)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `LINK_STATUS.ACTIVE` | const | - | string | Active link status |
| `LINK_STATUS.REMOVED` | const | - | string | Removed (soft delete) status |
| `getCanonicalTeacherId_(email)` | private | email: string | string | Generate canonical teacher key |
| `getCanonicalStudentId_(email)` | private | email: string | string | Generate canonical student ID |
| `linkStudentToTeacher(teacher, student, actor)` | PUBLIC | ... | object | Create/reactivate link |
| `unlinkStudentFromTeacher(teacher, student, actor)` | PUBLIC | ... | object | Soft delete link |
| `listStudentsForTeacher(teacher)` | PUBLIC | teacher: string | object | List active students |
| `listTeachersForStudent(student)` | PUBLIC | student: string | object | List active teachers |
| `getEquippedTeacher(student)` | PUBLIC | student: string | object | Get student's current teacher |
| `syncToLegacyTeacherData_(teacher, data)` | private | teacher, data | void | Sync to legacy format |
| `migrateTeacherDataToCanonical_(teacher, legacy)` | private | teacher, legacy | void | Migrate to canonical format |
| `reconcileTeacherStudentLinks()` | PUBLIC | - | object | Reconcile all links (admin) |
| `adminFixStudentTeacherLink(student, teacher, action)` | PUBLIC | ... | object | Force fix link (admin) |

---

## Debug Functions (Lines 15700-15815)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `debugFindDuplicateAuthRecords(email)` | PUBLIC | email: string | object | Find duplicate auth records |
| `debugListAllPendingWithKeys()` | PUBLIC | - | array | List all pending with keys |
| `debugTeacherEmailResolution(email)` | PUBLIC | email: string | object | Debug email resolution |
| `testAdminEmails()` | PUBLIC | - | string | Test admin email detection |

---

## Entry Point (Lines 200-300)

| Function | Visibility | Parameters | Returns | Description |
|----------|------------|------------|---------|-------------|
| `doGet(e)` | PUBLIC | e: event | HtmlOutput | Main URL routing handler |

---

## Summary Statistics

- **Total Functions:** ~280
- **PUBLIC (frontend-callable):** ~99
- **Private (internal):** ~181
- **Lines of Code:** 15,815
