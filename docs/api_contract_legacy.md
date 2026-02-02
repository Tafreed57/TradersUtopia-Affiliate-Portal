# Legacy API Contracts

This document defines the formal contracts for all frontend-callable backend functions.
These contracts must be preserved during migration.

---

## Contract Format

```
Function: name
Parameters: (param1: type, param2: type, ...)
Returns: { success: boolean, ...data } | { error: string }
Auth: none | session | admin
Side Effects: none | writes | external-api
```

---

## Session & Authentication

### validateSessionToken

```
Function: validateSessionToken
Parameters: (token: string)
Returns:
  Success: { valid: true, user: UserInfo, expiresAt: number }
  Invalid: { valid: false }
Auth: none (token self-validates)
Side Effects: updates session.lastSeenAt

UserInfo: {
  email: string,
  displayEmail: string,
  canonicalEmail: string,
  name: string,
  isTeacher: boolean,
  isAdmin: boolean
}
```

### loginAndCreateSession

```
Function: loginAndCreateSession
Parameters: (email: string, password: string)
Returns:
  Success: { 
    success: true, 
    token: string, 
    expiresAt: number, 
    user: UserInfo,
    message: string 
  }
  Failure: { 
    success: false, 
    error: string,
    noPasswordSet?: boolean,
    isPending?: boolean,
    needsAccessRequest?: boolean,
    isLegacyEmail?: boolean,
    aliasEmail?: string
  }
Auth: none
Side Effects: creates session, updates login timestamps
Rate Limited: 5 attempts / 15 min lockout
```

### logoutSession

```
Function: logoutSession
Parameters: (token: string)
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: none (token self-validates)
Side Effects: deletes session from cache + properties
```

### verifyAffiliatePassword

```
Function: verifyAffiliatePassword
Parameters: (aliasEmail: string, password: string)
Returns:
  Success: { success: true, email: string, message: string }
  Failure: { 
    success: false, 
    error: string,
    noPasswordSet?: boolean,
    isPending?: boolean,
    isRejected?: boolean,
    needsAccessRequest?: boolean,
    isLegacyEmail?: boolean,
    aliasEmail?: string
  }
Auth: none
Side Effects: updates failed/successful login counters
```

---

## Navigation & Access

### getWebAppUrl

```
Function: getWebAppUrl
Parameters: ()
Returns: string (URL)
Auth: none
Side Effects: none
```

### checkPortalAccess

```
Function: checkPortalAccess
Parameters: (token: string, portal: string)
  portal: 'commission' | 'attendance' | 'student' | 'teacher' | 'home'
Returns:
  Has Access: { hasAccess: true, user: SessionData }
  No Access: { hasAccess: false, reason: string, user?: SessionData }
  reason: 'not_logged_in' | 'not_teacher' | 'unknown_portal'
Auth: session
Side Effects: none
```

---

## Account Setup

### checkAccountStatus

```
Function: checkAccountStatus
Parameters: (aliasEmail: string)
Returns: {
  status: 'new' | 'pending' | 'approved_needs_password' | 'active' | 'rejected' | 'admin',
  canSetPassword: boolean,
  message?: string,
  currentAliasEmail?: string
}
Auth: none
Side Effects: none
```

### getRequestStatus

```
Function: getRequestStatus
Parameters: (email: string)
Returns: {
  found: boolean,
  status: 'NOT_FOUND' | 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED' | 'ADMIN',
  canSetPassword?: boolean,
  firstName?: string,
  lastName?: string,
  requestedAt?: string,
  approvedAt?: string,
  currentAliasEmail?: string,
  message: string
}
Auth: none
Side Effects: none
```

### requestAccountAccess

```
Function: requestAccountAccess
Parameters: (aliasEmail: string, firstName: string, lastName: string, portalType: string)
Returns:
  Success: { success: true, pending: true, message: string }
  Failure: { 
    success: false, 
    error: string,
    isPending?: boolean,
    isApproved?: boolean,
    needsPassword?: boolean,
    isAdmin?: boolean,
    isLegacyEmail?: boolean,
    aliasEmail?: string
  }
Auth: none
Side Effects: creates PENDING auth record
```

### validatePasswordSetupToken

```
Function: validatePasswordSetupToken
Parameters: (token: string)
Returns:
  Valid: { valid: true, email: string }
  Invalid: { valid: false, error: string }
Auth: none
Side Effects: none
```

### setPasswordWithToken

```
Function: setPasswordWithToken
Parameters: (token: string, password: string, confirmPassword: string)
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: none (token self-validates)
Side Effects: sets password, consumes token, updates account status
```

### setApprovedAccountPassword

```
Function: setApprovedAccountPassword
Parameters: (aliasEmail: string, password: string, confirmPassword: string)
Returns:
  Success: { success: true, message: string, loginEmail: string }
  Failure: { success: false, error: string }
Auth: none (status check)
Side Effects: sets password, transitions to COMPLETED status
```

### setAffiliatePassword

```
Function: setAffiliatePassword
Parameters: (email: string, password: string, confirmPassword: string)
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: none
Side Effects: creates/updates auth record
```

### checkAffiliateExists

```
Function: checkAffiliateExists
Parameters: (email: string)
Returns: { exists: boolean, email: string, isAdmin: boolean }
Auth: none
Side Effects: external API call to Rewardful
```

---

## Commission Lookup

### lookupAffiliate

```
Function: lookupAffiliate
Parameters: (email: string, sessionToken?: string)
Returns:
  Success: {
    success: true,
    email: string,
    displayEmail: string,
    name: string,
    affiliateId: string,
    
    // Commission amounts (CAD)
    unpaidAmount: number,
    dueNowAmount: number,
    totalPaidAmount: number,
    
    // Raw API values (before adjustments)
    rawUnpaid: number,
    rawDueNow: number,
    rawPaid: number,
    
    // Percentage info
    percentage: number,
    percentageApplied: boolean,
    
    // Incremental tracking
    deltaAmount: number,
    lastApiAmount: number,
    lastDisplayedAmount: number,
    
    // Override info
    hasOverride: boolean,
    overrideNote?: string,
    
    // Currency
    currency: string,
    conversionRate: number,
    
    // Metadata
    lastFetchedAt: number,
    fromCache: boolean
  }
  Failure: { success: false, error: string }
Auth: session (optional, for admin override access)
Side Effects: external API call, updates tracking data, caches response
```

### getExistingOverride

```
Function: getExistingOverride
Parameters: (email: string)
Returns:
  Found: { hasOverride: true, override: OverrideData }
  Not Found: { hasOverride: false }
Auth: admin (via isAdmin_())
Side Effects: none
```

### getRawApiData

```
Function: getRawApiData
Parameters: (email: string)
Returns: { success: true, rawData: object } | { success: false, error: string }
Auth: admin
Side Effects: external API call
```

---

## Teacher Portal

### verifyTeacherAccess

```
Function: verifyTeacherAccess
Parameters: (email: string)
Returns: {
  hasAccess: boolean,
  isAdmin: boolean,
  isTeacher: boolean,
  reason?: string
}
Auth: none
Side Effects: external API call (to get affiliate info)
```

### getTeacherDataWithContext

```
Function: getTeacherDataWithContext
Parameters: (email: string, token: string)
Returns:
  Success: {
    success: true,
    teacher: { email, name, isAdmin },
    students: [StudentData],
    earnings: EarningsData,
    viewingAs?: string  // If admin viewing another user
  }
  Failure: { success: false, error: string }
Auth: session
Side Effects: none (reads only)

StudentData: {
  email: string,
  internalEmail: string,
  name: string,
  affiliateId: string,
  percentageOverride: number,
  addedDate: string
}

EarningsData: {
  lockedEarnings: number,
  totalEarnedAllTime: number,
  totalPaidAllTime: number,
  lockedAt: string
}
```

### getStudentsCommissionData

```
Function: getStudentsCommissionData
Parameters: (teacher: string, token: string)
Returns:
  Success: {
    success: true,
    students: [{
      email: string,
      name: string,
      rawDueNow: number,      // 100% value
      adjustedDueNow: number, // After percentage
      percentage: number,
      last30DaysRaw: number,
      last30DaysAdjusted: number
    }]
  }
  Failure: { success: false, error: string }
Auth: session (teacher access)
Side Effects: external API calls
```

### addStudentToTeacherWithContext

```
Function: addStudentToTeacherWithContext
Parameters: (teacher: string, studentEmail: string, token: string)
Returns:
  Success: { success: true, message: string, student: StudentData }
  Failure: { success: false, error: string }
Auth: session (teacher access)
Side Effects: updates teacher-student links
```

### removeStudentFromTeacher

```
Function: removeStudentFromTeacher
Parameters: (teacher: string, student: string)
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: teacher access
Side Effects: soft-deletes link (REMOVED status)
```

### setStudentPercentageOverride

```
Function: setStudentPercentageOverride
Parameters: (teacher: string, student: string, percentage: number)
Returns:
  Success: { success: true, percentage: number }
  Failure: { success: false, error: string }
Auth: teacher access
Side Effects: saves percentage override
```

### updateTeacherEarnings

```
Function: updateTeacherEarnings
Parameters: (teacher: string, token: string)
Returns:
  Success: {
    success: true,
    lockedEarnings: number,
    lockedAt: string,
    students: [{ email, contribution }]
  }
  Failure: { success: false, error: string }
Auth: session (teacher access)
Side Effects: updates locked earnings, external API calls
```

### recordTeacherPayout

```
Function: recordTeacherPayout
Parameters: (teacher: string, amount: number, token: string)
Returns:
  Success: { 
    success: true, 
    remainingLocked: number,
    totalPaid: number,
    message: string 
  }
  Failure: { success: false, error: string }
Auth: session (admin only)
Side Effects: updates earnings history
```

---

## Attendance Portal

### getAttendanceData

```
Function: getAttendanceData
Parameters: (email: string, token: string)
Returns:
  Success: {
    success: true,
    user: { email, teacherEmail, createdAt },
    records: [{
      date: string,
      confirmedAt: string,
      type: 'confirmed' | 'missed',
      teacherEmail?: string
    }],
    stats: {
      totalConfirmed: number,
      totalMissed: number,
      streak: number,
      firstConfirmationDate: string
    },
    needsTeacherAssignment: boolean
  }
  Failure: { success: false, error: string }
Auth: session
Side Effects: calculates missed days on-the-fly
```

### confirmAttendance

```
Function: confirmAttendance
Parameters: (email: string, dateStr: string, token: string)
  dateStr: YYYY-MM-DD format (user's local date)
Returns:
  Success: { success: true, message: string, date: string }
  Already Confirmed: { success: true, alreadyConfirmed: true, message: string }
  Failure: { success: false, error: string }
Auth: session
Side Effects: creates attendance record
```

### getAllValidTeachers

```
Function: getAllValidTeachers
Parameters: ()
Returns:
  Success: {
    success: true,
    teachers: [{
      email: string,
      name: string,
      firstName: string,
      lastName: string
    }]
  }
  Failure: { success: false, error: string }
Auth: none
Side Effects: external API call (paginated)
```

### setTeacherForAttendanceUser

```
Function: setTeacherForAttendanceUser
Parameters: (studentEmail: string, teacherEmail: string)
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: none (self-assignment allowed)
Side Effects: updates user profile, creates/updates teacher link
```

### loginAttendanceWithEmail

```
Function: loginAttendanceWithEmail
Parameters: (email: string)
Returns:
  Success: {
    success: true,
    needsTeacherSelection: boolean,
    isAdmin: boolean,
    user: { email, name, teacherEmail }
  }
  Blocked: {
    success: false,
    isLegacyEmail: true,
    error: string,
    aliasEmail?: string
  }
  Failure: { success: false, error: string }
Auth: none (called after password verification)
Side Effects: none
```

### completeAttendanceLoginWithTeacher

```
Function: completeAttendanceLoginWithTeacher
Parameters: (email: string, teacherEmail: string)
Returns:
  Success: { success: true, user: UserData }
  Failure: { success: false, error: string }
Auth: none
Side Effects: updates user's teacher assignment
```

---

## Referrals/Leads

### getReferralsWithMode

```
Function: getReferralsWithMode
Parameters: (params: { email: string, mode: string, page: number, pageSize: number })
  mode: 'leads' | 'conversions'
Returns:
  Success: {
    success: true,
    rows: [ReferralRow],
    totalCount: number,
    page: number,
    pageSize: number,
    totalPages: number,
    mode: string,
    leadsCount: number,
    conversionsCount: number
  }
  Failure: { success: false, error: string, rows: [], ... }
Auth: session (implicit via email match)
Side Effects: external API call, caches results

ReferralRow: {
  id: string,
  state: 'lead' | 'conversion',
  createdAt: string,
  becameLeadAt: string,
  becameConversionAt: string | null,
  isConversion: boolean,
  isLead: boolean
}
```

### getStudentReferralsForTeacher

```
Function: getStudentReferralsForTeacher
Parameters: (teacherEmail: string, studentEmail: string, mode: string, page: number, pageSize: number)
Returns: Same as getReferralsWithMode
Auth: teacher access (verifies teacher-student link)
Side Effects: external API call
```

---

## Admin Functions

### adminGetPendingAccounts

```
Function: adminGetPendingAccounts
Parameters: (sessionToken: string)
Returns:
  Success: {
    success: true,
    pending: [{
      aliasEmail: string,
      email: string,
      firstName: string,
      lastName: string,
      requestedAt: string,
      requestedPortalType: string,
      rewardfulEmail: string | null
    }],
    count: number
  }
  Unauthorized: { success: false, error: 'Unauthorized - admin only' }
Auth: admin
Side Effects: none
```

### adminPreCheckInternalEmail

```
Function: adminPreCheckInternalEmail
Parameters: (internalEmail: string, sessionToken: string)
Returns:
  Exists: {
    success: true,
    exists: true,
    actionWillBe: 'MIGRATION',
    message: string,
    description: string,
    affiliate: { id, name, firstName, lastName, email, state, unpaidCommission, totalPaid }
  }
  Not Found: {
    success: true,
    exists: false,
    actionWillBe: 'NEW_USER',
    message: string,
    description: string,
    affiliate: null
  }
Auth: admin
Side Effects: external API call
```

### adminApproveAccount

```
Function: adminApproveAccount
Parameters: (originalAliasEmail: string, approvalData: object, sessionToken: string)
  approvalData: {
    firstName: string,
    lastName: string,
    newAliasEmail?: string,      // If changing alias email
    rewardfulEmail: string,       // REQUIRED - internal email
    campaignId?: string,
    paypalEmail?: string,
    state?: string
  }
Returns:
  Success: {
    success: true,
    message: string,
    actionDescription: string,
    aliasEmail: string,
    originalAliasEmail: string,
    internalEmail: string,
    actionTaken: 'linked' | 'created',
    actionLabel: string,
    affiliateId: string,
    affiliateName: string,
    aliasEmailChanged: boolean,
    statusNote: string
  }
  Failure: { success: false, error: string, step?: string }
Auth: admin
Side Effects: creates/updates Rewardful affiliate, creates auth record
```

### adminRejectAccount

```
Function: adminRejectAccount
Parameters: (email: string, reason: string, sessionToken: string)
Returns:
  Success: { success: true, message: string, email: string }
  Failure: { success: false, error: string }
Auth: admin
Side Effects: updates account status to REJECTED
```

### saveAdminOverride

```
Function: saveAdminOverride
Parameters: (email: string, overrideData: object, token: string)
  overrideData: { unpaidAmount?, dueNowAmount?, totalPaidAmount?, note?, reason? }
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: admin
Side Effects: saves override to PropertiesService
```

### removeAdminOverride

```
Function: removeAdminOverride
Parameters: (email: string, token: string)
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: admin
Side Effects: deletes override from PropertiesService
```

### getAllAttendanceUsers

```
Function: getAllAttendanceUsers
Parameters: ()
Returns:
  Success: {
    success: true,
    users: [{
      email: string,
      aliasEmail: string,
      internalEmail: string,
      teacherEmail: string,
      createdAt: string,
      isLegacy: boolean,
      isOrphaned: boolean
    }]
  }
Auth: admin
Side Effects: none
```

### searchAttendanceUsers

```
Function: searchAttendanceUsers
Parameters: (query: string)
Returns: Same structure as getAllAttendanceUsers, filtered
Auth: admin
Side Effects: none
```

### getStudentAttendanceStats

```
Function: getStudentAttendanceStats
Parameters: (teacherEmail: string, studentEmail: string, token: string)
Returns:
  Success: {
    success: true,
    student: { email, name, teacherEmail },
    stats: { totalConfirmed, totalMissed, streak },
    leads: { count, recentLeads: [] }
  }
  Failure: { success: false, error: string }
Auth: teacher access (verifies link)
Side Effects: external API calls
```

### deleteAttendanceRecord

```
Function: deleteAttendanceRecord
Parameters: (email: string, dateStr: string, token: string)
Returns:
  Success: { success: true, message: string }
  Failure: { success: false, error: string }
Auth: admin
Side Effects: deletes attendance record
```

---

## Error Patterns

### Standard Error Response
```javascript
{ success: false, error: 'Human-readable error message' }
```

### Auth Error
```javascript
{ success: false, error: 'Unauthorized - admin only' }
```

### Validation Error
```javascript
{ success: false, error: 'Email is required' }
```

### Rate Limit Error
```javascript
{ success: false, error: 'Too many failed attempts. Try again in X minute(s).' }
```

### Legacy Email Block
```javascript
{ 
  success: false, 
  error: 'This is an internal system email...', 
  isLegacyEmail: true, 
  aliasEmail: 'correct@email.com' 
}
```

---

## Migration Compatibility Requirements

1. **All response shapes must be preserved** - frontend relies on exact field names
2. **Error patterns must match** - frontend checks specific error flags
3. **Session token format** - 64+ chars, underscore + timestamp suffix
4. **Dual email system** - aliasEmail vs. rewardfulEmail must work identically
5. **Rate limiting** - 5 attempts / 15 minute lockout must be replicated
6. **Admin checks** - Multiple methods (GAS Session, token, email list)
