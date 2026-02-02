# Frontend `google.script.run` Calls Inventory

This document lists all `google.script.run` calls found in the frontend HTML files.

---

## Summary by File

| File | Unique Calls | Lines |
|------|--------------|-------|
| `attendenceportal.html` | 18 | 3,445 |
| `CommissionLookup.Html` | 12 | 1,865 |
| `teacherPortal.html` | 14 | 1,655 |
| `SetPassword.html` | 9 | 1,168 |
| `home.html` | 4 | 653 |
| `Login.html` | 4 | 603 |
| `testpage.html` | 1 | 142 |
| `style.html` | ~12 | 5,101 |

**Total Unique Calls: ~99** (some duplicated across files)

---

## attendenceportal.html (Student Dashboard)

### Session & Navigation

| Call | Parameters | Purpose |
|------|------------|---------|
| `validateSessionToken(token)` | token: string | Validate session on page load |
| `getWebAppUrl()` | - | Get web app URL for navigation |
| `checkPortalAccess(token, 'attendance')` | token, portal | Check access permissions |

### Authentication

| Call | Parameters | Purpose |
|------|------------|---------|
| `verifyAffiliatePassword(email, password)` | email, password | Verify login credentials |
| `loginAttendanceWithEmail(email)` | email | Login after password verification |
| `completeAttendanceLoginWithTeacher(email, teacher)` | email, teacher | Complete login with teacher selection |
| `logoutSession(token)` | token | Logout and invalidate session |

### Attendance Data

| Call | Parameters | Purpose |
|------|------------|---------|
| `getAttendanceData(email, token)` | email, token | Get attendance history + missed days |
| `confirmAttendance(email, dateStr, token)` | email, dateStr, token | Confirm daily attendance |
| `getAllValidTeachers()` | - | Get teacher dropdown options |
| `setTeacherForAttendanceUser(email, teacher)` | email, teacher | Assign teacher to student |

### Referrals/Leads

| Call | Parameters | Purpose |
|------|------------|---------|
| `getReferralsWithMode(params)` | {email, mode, page, pageSize} | Get leads/conversions with pagination |

### Admin Functions

| Call | Parameters | Purpose |
|------|------------|---------|
| `getAllAttendanceUsers()` | - | Get all users (admin) |
| `searchAttendanceUsers(query)` | query | Search users (admin) |
| `getStudentAttendanceStats(teacher, student, token)` | teacher, student, token | Get student stats |
| `deleteAttendanceRecord(email, dateStr, token)` | email, dateStr, token | Delete attendance record |

---

## CommissionLookup.Html (Affiliate Portal)

### Session & Navigation

| Call | Parameters | Purpose |
|------|------------|---------|
| `validateSessionToken(token)` | token | Validate session |
| `getWebAppUrl()` | - | Get navigation URL |
| `logoutSession(token)` | token | Logout |

### Commission Data

| Call | Parameters | Purpose |
|------|------------|---------|
| `lookupAffiliate(email, token)` | email, token | Main commission lookup |
| `getExistingOverride(email)` | email | Get admin override |
| `getRawApiData(email)` | email | Get raw API data (admin debug) |

### Admin Functions

| Call | Parameters | Purpose |
|------|------------|---------|
| `adminGetPendingAccounts(token)` | token | Get pending account requests |
| `adminPreCheckInternalEmail(email, token)` | email, token | Pre-check internal email |
| `adminApproveAccount(alias, data, token)` | alias, approvalData, token | Approve account request |
| `adminRejectAccount(email, reason, token)` | email, reason, token | Reject account request |
| `saveAdminOverride(email, data, token)` | email, overrideData, token | Save admin override |
| `removeAdminOverride(email, token)` | email, token | Remove admin override |

---

## teacherPortal.html (Teacher Portal)

### Session & Navigation

| Call | Parameters | Purpose |
|------|------------|---------|
| `validateSessionToken(token)` | token | Validate session |
| `getWebAppUrl()` | - | Get navigation URL |
| `logoutSession(token)` | token | Logout |
| `verifyTeacherAccess(email)` | email | Verify teacher access |

### Teacher Data

| Call | Parameters | Purpose |
|------|------------|---------|
| `getTeacherDataWithContext(email, token)` | email, token | Get teacher data with students |
| `getStudentsCommissionData(teacher, token)` | teacher, token | Get all students' commission data |

### Student Management

| Call | Parameters | Purpose |
|------|------------|---------|
| `addStudentToTeacherWithContext(teacher, student, token)` | teacher, student, token | Add student to teacher |
| `removeStudentFromTeacher(teacher, student)` | teacher, student | Remove student |
| `setStudentPercentageOverride(teacher, student, pct)` | teacher, student, pct | Set student percentage |

### Earnings Tracking

| Call | Parameters | Purpose |
|------|------------|---------|
| `updateTeacherEarnings(teacher, token)` | teacher, token | Update/lock earnings |
| `recordTeacherPayout(teacher, amount, token)` | teacher, amount, token | Record payout |

### Student Stats

| Call | Parameters | Purpose |
|------|------------|---------|
| `getStudentAttendanceStats(teacher, student, token)` | teacher, student, token | Get student attendance |
| `getStudentReferralsForTeacher(teacher, student, mode, page, size)` | ... | Get student referrals |

---

## SetPassword.html (Account Setup)

### Session & Navigation

| Call | Parameters | Purpose |
|------|------------|---------|
| `getWebAppUrl()` | - | Get navigation URL |

### Account Status

| Call | Parameters | Purpose |
|------|------------|---------|
| `checkAccountStatus(email)` | email | Check account status |
| `getRequestStatus(email)` | email | Get request status for popup |
| `validatePasswordSetupToken(token)` | token | Validate setup token |

### Account Actions

| Call | Parameters | Purpose |
|------|------------|---------|
| `requestAccountAccess(email, first, last, type)` | email, firstName, lastName, portalType | Request account access |
| `setPasswordWithToken(token, pass, confirm)` | token, password, confirmPassword | Set password via token |
| `setApprovedAccountPassword(email, pass, confirm)` | email, password, confirmPassword | Set password for approved |
| `setAffiliatePassword(email, pass, confirm)` | email, password, confirmPassword | Set affiliate password |
| `checkAffiliateExists(email)` | email | Check if affiliate exists |

---

## home.html (Main Dashboard)

### Session & Navigation

| Call | Parameters | Purpose |
|------|------------|---------|
| `validateSessionToken(token)` | token | Validate session |
| `getWebAppUrl()` | - | Get navigation URL |
| `checkPortalAccess(token, portal)` | token, portal | Check portal access |
| `logoutSession(token)` | token | Logout |

---

## Login.html (Login Page)

### Session & Navigation

| Call | Parameters | Purpose |
|------|------------|---------|
| `validateSessionToken(token)` | token | Check existing session |
| `getWebAppUrl()` | - | Get navigation URL |

### Authentication

| Call | Parameters | Purpose |
|------|------------|---------|
| `loginAndCreateSession(email, password)` | email, password | Full login flow |
| `checkAccountStatus(email)` | email | Check status for redirect |

---

## testpage.html (Debug Page)

| Call | Parameters | Purpose |
|------|------------|---------|
| `getCurrentUserStatus()` | - | Test backend connectivity |

---

## style.html (Duplicate of CommissionLookup)

Same calls as `CommissionLookup.Html` - appears to be a duplicate/legacy version.

---

## Unique Function List (Alphabetical)

For migration, these are the 47 unique backend functions called from frontend:

```
addStudentToTeacherWithContext
adminApproveAccount
adminGetPendingAccounts
adminPreCheckInternalEmail
adminRejectAccount
checkAccountStatus
checkAffiliateExists
checkPortalAccess
completeAttendanceLoginWithTeacher
confirmAttendance
deleteAttendanceRecord
getAllAttendanceUsers
getAllValidTeachers
getAttendanceData
getCurrentUserStatus
getExistingOverride
getRawApiData
getReferralsWithMode
getRequestStatus
getStudentAttendanceStats
getStudentReferralsForTeacher
getStudentsCommissionData
getTeacherDataWithContext
getWebAppUrl
loginAndCreateSession
loginAttendanceWithEmail
logoutSession
lookupAffiliate
recordTeacherPayout
removeAdminOverride
removeStudentFromTeacher
requestAccountAccess
saveAdminOverride
searchAttendanceUsers
setApprovedAccountPassword
setAffiliatePassword
setPasswordWithToken
setStudentPercentageOverride
setTeacherForAttendanceUser
updateTeacherEarnings
validatePasswordSetupToken
validateSessionToken
verifyAffiliatePassword
verifyTeacherAccess
```

---

## Call Patterns

### Standard Pattern
```javascript
google.script.run
  .withSuccessHandler(function(result) { ... })
  .withFailureHandler(function(error) { ... })
  .functionName(arg1, arg2);
```

### Session Token Pattern
Most calls include `sessionToken` from `localStorage.getItem('tradersutopia_session_token')`:
```javascript
var token = localStorage.getItem('tradersutopia_session_token');
google.script.run
  .withSuccessHandler(handler)
  .withFailureHandler(errorHandler)
  .functionName(email, token);
```

### localStorage Key
```javascript
const SESSION_TOKEN_KEY = 'tradersutopia_session_token';
```

---

## Migration Notes

### Priority 1: Session/Auth (Critical Path)
- `validateSessionToken`
- `loginAndCreateSession`
- `logoutSession`
- `verifyAffiliatePassword`

### Priority 2: Core Data
- `lookupAffiliate`
- `getAttendanceData`
- `getTeacherDataWithContext`

### Priority 3: CRUD Operations
- `confirmAttendance`
- `addStudentToTeacherWithContext`
- `setStudentPercentageOverride`
- `updateTeacherEarnings`

### Priority 4: Admin Functions
- `adminGetPendingAccounts`
- `adminApproveAccount`
- `saveAdminOverride`
