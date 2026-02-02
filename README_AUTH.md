# Affiliate Authentication System

This document describes the password-based authentication system implemented across all Traders Utopia portals.

## Overview

All three portals now require password authentication:
- **Commission Lookup** - Affiliate commission reports
- **Teacher Portal** - Teacher dashboard and student management
- **Student Dashboard** - Attendance, referrals, and progress tracking

## Password Storage

### Location
Passwords are stored in **Google Apps Script Properties Service** (`ScriptProperties`).

### Storage Key Format
```
AUTH_{normalized_email}
```

### Data Structure
Each auth record contains:
```javascript
{
  email: "user@example.com",         // Normalized (lowercase, trimmed)
  passwordSalt: "32-char-random",    // Random salt per user
  passwordHash: "base64-hash",       // SHA-256 iterative hash
  passwordSetAt: "ISO-timestamp",    // When password was set
  failedLoginCount: 0,               // Failed attempts counter
  lockUntilTimestamp: 0,             // Lockout expiration (Unix ms)
  lastLoginAt: "ISO-timestamp"       // Last successful login
}
```

## Password Hashing

### Algorithm
- **Base**: SHA-256 (via `Utilities.computeDigest`)
- **Iterations**: 10,000 rounds (PBKDF2-like approach)
- **Salt**: 32-character random alphanumeric per user

### Process
1. Generate random salt for new passwords
2. Combine password + salt
3. Run 10,000 iterations of SHA-256
4. Store final hash (Base64 encoded) + salt

### Security Notes
- Passwords are **never** stored in plaintext
- Passwords are **never** logged
- Passwords are **never** returned in API responses
- Each user has a unique salt

## Password Requirements

Passwords must meet these criteria:
- **Minimum 8 characters**
- **At least one letter** (a-z, A-Z)
- **At least one number** (0-9)

## Rate Limiting / Brute Force Protection

### Configuration
```javascript
AUTH_MAX_FAILED_ATTEMPTS = 5      // Max failures before lockout
AUTH_LOCKOUT_MINUTES = 15         // Lockout duration
```

### Behavior
1. After 5 failed login attempts, account is locked for 15 minutes
2. Lockout timer resets after successful login
3. Failed attempt counter clears after lockout expires or successful login

## User Flows

### New User (First-Time Password Setup)
1. User visits any portal login page
2. Enters email and any password → Error: "No password set"
3. Clicks "New here? Haven't set a password yet?"
4. Redirected to Set Password page (`?page=set-password&return={portal}`)
5. Enters email, new password, confirm password
6. System validates:
   - Email exists as affiliate
   - Password meets requirements
   - Passwords match
7. Password stored (hashed + salted)
8. Redirected back to original portal with email prefilled
9. User logs in with new password

### Returning User
1. User visits portal login page
2. Enters email and password
3. System verifies credentials
4. If successful → proceed to portal content
5. If failed → increment failed attempts, show error

### Locked Account
1. After 5 failed attempts, account locks for 15 minutes
2. Login attempts show: "Too many failed attempts. Try again in X minute(s)."
3. After lockout expires, user can try again

## Redirect Flow

### URL Parameters
The password setup page uses query parameters:
- `page=set-password` - Route to password setup
- `return={portal}` - Where to redirect after (commission/teacher/student)
- `email={email}` - Prefill email (optional)

### Portal Mapping
```
return=commission → page=commission
return=teacher    → page=teacher
return=student    → page=attendance
```

## Admin Functions

### Reset Password (Force user to set new password)
```javascript
adminResetPassword(email)
```
- Clears password hash/salt
- User must set new password on next login
- Requires admin privileges

### Unlock Account
```javascript
adminUnlockAccount(email)
```
- Resets failed attempt counter
- Clears lockout timestamp
- Requires admin privileges

### View Auth Status
```javascript
adminGetAuthStatus(email)
```
Returns:
- Whether email exists as affiliate
- Whether password is set
- When password was set
- Last login timestamp
- Failed attempt count
- Lockout status

## API Functions

### Public (Frontend-callable)

| Function | Description |
|----------|-------------|
| `setAffiliatePassword(email, password, confirmPassword)` | Set new password |
| `verifyAffiliatePassword(email, password)` | Verify login credentials |
| `hasPasswordSet(email)` | Check if password exists |
| `checkAffiliateExists(email)` | Verify affiliate email |

### Admin Only

| Function | Description |
|----------|-------------|
| `adminResetPassword(email)` | Force password reset |
| `adminUnlockAccount(email)` | Clear lockout |
| `adminGetAuthStatus(email)` | View auth details |

## Troubleshooting

### "Email not recognized"
- Affiliate doesn't exist in the system
- Check if email is correctly registered with the provider

### "No password set for this account"
- User hasn't completed password setup
- Direct them to the "New here?" link

### "Too many failed attempts"
- Account is locked due to failed logins
- Wait for lockout to expire or admin can unlock

### Password hash issues
If passwords stop working after code changes:
1. Check that `hashPassword_()` function hasn't changed
2. Verify salt/hash storage is intact
3. Admin can reset affected users' passwords

## Files Modified

- `Code.js` - Backend auth module (search for "AFFILIATE AUTHENTICATION SYSTEM")
- `SetPassword.html` - Password setup page (new file)
- `CommissionLookup.Html` - Added password field
- `teacherPortal.html` - Added password field
- `attendenceportal.html` - Added password field
- `home.html` - Renamed "Attendance Portal" to "Student Dashboard"

## URL Configuration

### WEB_APP_URL (Important!)

The `WEB_APP_URL` constant in `Code.js` must be updated after each new deployment:

```javascript
var WEB_APP_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

This URL is used by the `getWebAppUrl()` function, which all portals call to generate correct links for password setup. This avoids the "userCodeAppPanel" blank page issue that occurs when using `window.location.href` directly.

### Why this is needed

When an Apps Script web app runs in certain contexts (editor preview, embedded iframes), `window.location.href` resolves to an internal URL like `userCodeAppPanel` instead of the deployed `/exec` URL. By storing and serving the correct URL from the server, we ensure links always work correctly.

## Testing Checklist

### For each portal (Commission, Teacher, Student):

- [ ] New user can set password via "New here?" link
- [ ] Email prefills correctly on password setup page
- [ ] Password requirements are enforced
- [ ] Mismatched passwords show error
- [ ] After setting password, redirect works
- [ ] Login with correct password succeeds
- [ ] Login with wrong password fails
- [ ] After 5 failures, account locks
- [ ] Locked account shows appropriate message
- [ ] Admin can reset password
- [ ] Admin can unlock account

### Security verification:

- [ ] No passwords in browser console logs
- [ ] No passwords in Apps Script execution logs
- [ ] No passwords returned in API responses
- [ ] PropertiesService stores only hashed values

---

## Admin Management

### Single Source of Truth

All admin privileges are determined by the `ADMIN_EMAILS` array in `Code.js`:

```javascript
var ADMIN_EMAILS = [
  'admin@gmail.com',           // System admin account
  'tafreed57@gmail.com',       // Tafreed
  'shehrozeps9721@gmail.com'   // Shehroz
];
```

**IMPORTANT**: This is the ONLY place where admin emails should be listed. Do NOT:
- Hardcode admin emails in frontend JavaScript
- Create separate admin checks in different functions
- Bypass the admin list for special emails

### How Admin Status is Determined

1. **Session Creation**: When a user logs in via `createSession()`, the `getUserInfoForSession_()` function checks if their email is in `ADMIN_EMAILS` and sets `isAdmin: true/false` in the session.

2. **Frontend Access**: All portals receive `user.isAdmin` from the session and use this to show/hide admin features.

3. **Backend Protection**: Admin-only functions use `isAdmin_()` which checks the current Google user's email against `ADMIN_EMAILS`.

### Key Functions

| Function | Purpose | Location |
|----------|---------|----------|
| `isAdmin_()` | Check if current Google session user is admin | Backend (internal) |
| `isAdminEmail_(email)` | Check if any email is in admin list | Backend (internal) |
| `checkIsAdmin(email)` | Public API for frontend to check admin status | Backend (public) |
| `getUserInfoForSession_()` | Sets isAdmin flag during session creation | Backend (internal) |

### Adding/Removing Admins

1. Edit `ADMIN_EMAILS` array in `Code.js`
2. Save and redeploy the web app
3. New admin will have access after their next login (new session)

### Security Considerations

- **Backend protection is mandatory**: Even if admin UI is hidden, admin API endpoints must verify `isAdmin_()` before executing
- **Frontend admin checks are cosmetic**: They improve UX but don't provide security
- **Never trust client-side admin claims**: Always verify on the server
- **Session tokens are cryptographically secure**: 64-character random strings stored in CacheService/PropertiesService

### Future Improvements

For production systems, consider:
- Moving admin list to PropertiesService for runtime updates without redeployment
- Using a database table for admin management
- Adding admin role levels (super admin, moderator, etc.)
- Implementing audit logging for admin actions
