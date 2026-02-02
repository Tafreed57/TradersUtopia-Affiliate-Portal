# PropertiesService & CacheService Key Prefixes

This document catalogs all storage key patterns used in the legacy system.

---

## PropertiesService Keys

### Authentication System

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `AUTH_` | `AUTH_user@email.com` | Auth records (password, status) | `{email, passwordHash, passwordSalt, accountStatus, ...}` |
| `AFFILIATE_AUTH_` | `AFFILIATE_AUTH_user_AT_email.com` | Legacy auth key format | Same as AUTH_ |
| `PWD_TOKEN_` | `PWD_TOKEN_{uuid}` | Password reset tokens | `{email, createdAt, expiresAt}` |

**Auth Record Structure:**
```javascript
{
  email: string,
  aliasEmail: string,           // User-facing login email
  rewardfulEmail: string,       // Internal Rewardful email
  originalAliasEmail: string,   // If alias changed by admin
  passwordHash: string,
  passwordSalt: string,
  passwordSetAt: string,        // ISO timestamp
  accountStatus: 'PENDING' | 'APPROVED' | 'COMPLETED' | 'ACTIVE' | 'REJECTED',
  requestedAt: string,
  approvedAt: string,
  approvedBy: string,
  firstName: string,
  lastName: string,
  failedLoginCount: number,
  lockUntilTimestamp: number,
  lastLoginAt: string,
  rewardfulAffiliateId: string,
  isAdmin: boolean,
  redirectTo: string            // If record moved (alias changed)
}
```

---

### Session Management

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `SESSION_` | `SESSION_{token}` | Session tokens | `{token, email, aliasEmail, rewardfulEmail, expiresAt, ...}` |

**Session Structure:**
```javascript
{
  token: string,
  email: string,
  aliasEmail: string,
  rewardfulEmail: string,
  canonicalEmail: string,
  displayEmail: string,
  createdAt: string,
  expiresAt: number,            // Unix timestamp
  lastSeenAt: string,
  isTeacher: boolean,
  isAdmin: boolean,
  userName: string
}
```

---

### Teacher-Student Linking

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `TEACHER_LINKS_` | `TEACHER_LINKS_teacher_AT_email.com` | **Canonical** teacher-student links | `{students: [...]}` |
| `TEACHER_STUDENTS_` | `TEACHER_STUDENTS_teacher@email.com` | **Legacy** teacher-student links | `{students: [...]}` |

**Canonical Link Structure (TEACHER_LINKS_):**
```javascript
{
  students: [
    {
      studentId: string,        // Canonical student ID (email-based)
      email: string,            // Alias email (display)
      internalEmail: string,    // Rewardful email
      affiliateId: string,
      name: string,
      status: 'ACTIVE' | 'REMOVED',
      createdAt: string,
      updatedAt: string,
      createdBy: 'student' | 'teacher' | 'admin' | 'migrated',
      removedAt: string | null,
      removedBy: string | null
    }
  ]
}
```

**Legacy Link Structure (TEACHER_STUDENTS_):**
```javascript
{
  students: [
    {
      email: string,
      internalEmail: string,
      affiliateId: string,
      addedDate: string
    }
  ]
}
```

---

### Attendance System

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `ATTENDANCE_USER_` | `ATTENDANCE_USER_user@email.com` | User profile | `{email, teacherEmail, createdAt, ...}` |
| `ATTENDANCE_RECORD_` | `ATTENDANCE_RECORD_user@email.com_2026-02-01` | Daily records | `{date, confirmedAt, teacherEmail}` |

**User Profile Structure:**
```javascript
{
  email: string,                // Alias email
  internalEmail: string,        // Rewardful email
  aliasEmail: string,
  passwordHash: string,         // Legacy (deprecated, now uses AUTH_)
  teacherEmail: string,         // Currently equipped teacher
  createdAt: string,
  updatedAt: string
}
```

**Attendance Record Structure:**
```javascript
{
  date: string,                 // YYYY-MM-DD format
  confirmedAt: string,          // ISO timestamp
  teacherEmail: string,         // Teacher at time of confirmation
  confirmations: [              // Multiple per day allowed
    { time: string }
  ]
}
```

---

### Referrals/Leads

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `REFERRAL_DATA_` | `REFERRAL_DATA_user@email.com` | Lead metadata | `{lastKnownLeadCount, lastFetchedAt, ...}` |

**Referral Metadata Structure:**
```javascript
{
  userEmail: string,
  affiliateId: string,
  lastKnownLeadCount: number,
  previousLeadCount: number,
  lastSuccessfulFetchAt: number,  // Unix timestamp
  lastFetchedAt: number,
  fetchHistory: [
    { timestamp: number, count: number, delta: number }
  ]
}
```

---

### Commission Overrides

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `ADMIN_OVERRIDE_` | `ADMIN_OVERRIDE_user@email.com` | Admin commission overrides | `{unpaidAmount, dueNowAmount, ...}` |

**Override Structure:**
```javascript
{
  email: string,
  unpaidAmount: number,         // Override value in CAD
  dueNowAmount: number,
  totalPaidAmount: number,
  overrideNote: string,
  overrideReason: string,
  overrideDate: string,
  overrideBy: string            // Admin email
}
```

---

### Incremental Tracking

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `TRACKING_` | `TRACKING_user@email.com` | Delta tracking data | `{lastApiAmount, lastDisplayedAmount, ...}` |

**Tracking Structure:**
```javascript
{
  email: string,
  lastApiAmount: number,
  lastDisplayedAmount: number,
  lastFetchedAt: number,
  history: [
    { date: string, apiAmount: number, displayedAmount: number }
  ]
}
```

---

### Teacher Earnings

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `TEACHER_EARNINGS_` | `TEACHER_EARNINGS_teacher@email.com` | Earnings history | `{lockedEarnings, history, ...}` |
| `TEACHER_PERCENTAGE_` | `TEACHER_PERCENTAGE_teacher@email.com` | Teacher's cut percentage | `{percentage}` |
| `TEACHER_PAYMENT_` | `TEACHER_PAYMENT_teacher@email.com` | Payment records | `{payments: [...]}` |

**Earnings Structure:**
```javascript
{
  teacherEmail: string,
  lockedEarnings: number,       // CAD amount locked at snapshot
  lockedAt: string,
  totalEarnedAllTime: number,
  totalPaidAllTime: number,
  history: [
    { date: string, amount: number, action: 'lock' | 'payment' }
  ]
}
```

---

### Student Percentage Overrides

| Prefix | Example | Purpose | Data Structure |
|--------|---------|---------|----------------|
| `STUDENT_PERCENTAGE_` | `STUDENT_PERCENTAGE_teacher@email.com_student@email.com` | Per-student percentage | `{percentage}` |

---

## CacheService Keys

### Session Cache (Fast Access)

| Prefix | Example | TTL | Purpose |
|--------|---------|-----|---------|
| `SESSION_` | `SESSION_{token}` | 12.5 hours | Session data (mirrors PropertiesService) |

---

### API Response Cache

| Prefix | Example | TTL | Purpose |
|--------|---------|-----|---------|
| `API_CACHE_` | `API_CACHE_{hash}` | Variable | Cached API responses |

---

### Leads Cache (Chunked)

| Prefix | Example | TTL | Purpose |
|--------|---------|-----|---------|
| `LEADS_` | `LEADS_user@email.com` | 6 hours | Primary leads cache |
| `LEADS_CHUNK_` | `LEADS_CHUNK_user@email.com_0` | 6 hours | Leads chunk 0 |
| `LEADS_CHUNK_` | `LEADS_CHUNK_user@email.com_1` | 6 hours | Leads chunk 1, etc. |

**Chunking Logic:**
```javascript
var CHUNK_SIZE = 50000; // Characters per chunk
var numChunks = Math.ceil(dataStr.length / CHUNK_SIZE);
```

---

### Teacher Data Cache

| Prefix | Example | TTL | Purpose |
|--------|---------|-----|---------|
| `TEACHER_DATA_` | `TEACHER_DATA_teacher@email.com` | 5 min | Cached teacher data |
| `STUDENT_DATA_` | `STUDENT_DATA_student@email.com` | 5 min | Cached student data |

---

## Key Normalization Patterns

### Email Normalization
```javascript
function normalizeAuthEmail_(email) {
  return (email || '').toLowerCase().trim();
}
```

### Key Generation
```javascript
// Pattern 1: Direct email
'AUTH_' + normalizeAuthEmail_(email)

// Pattern 2: Escaped email
'TEACHER_LINKS_' + email.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_')

// Pattern 3: Date suffix
'ATTENDANCE_RECORD_' + email + '_' + dateString
```

---

## Storage Limits

### PropertiesService
- **Max value size:** 9KB per property
- **Total storage:** 500KB per script

### CacheService
- **Max value size:** 100KB per key
- **TTL:** Max 6 hours

### Implications for Migration
1. Large data uses chunking (leads cache)
2. Session uses dual storage (cache for speed, props for persistence)
3. Key normalization inconsistencies must be preserved during migration

---

## Key Collision Risks

### Alias vs. Internal Email
```javascript
// These could be different records:
AUTH_user@gmail.com              // Alias email
AUTH_user100%@gmail.com          // Internal email (encoded %)
```

### Legacy vs. Canonical
```javascript
// Same teacher, different keys:
TEACHER_STUDENTS_teacher@email.com   // Legacy
TEACHER_LINKS_teacher_AT_email.com   // Canonical
```

### Migration Must:
1. Preserve all key formats
2. Handle redirect records
3. Merge canonical + legacy data
