# Session-Based Navigation System

This document describes the unified single sign-on (SSO) system implemented across all Traders Utopia portals.

## Overview

The navigation system has been completely revamped to provide a seamless user experience:

1. **Single Login**: Users log in once at the unified login page
2. **Session-Based Auth**: A secure session token allows navigation between all portals without re-authentication
3. **Role-Based Access**: Teacher portal is restricted to verified teachers only
4. **Secure Logout**: Sessions can be invalidated from any portal

## User Flow

### New User Journey

```
Root URL (/) 
    → Login Page (page=login)
        → Enter email + password
            → [Success] Dashboard (page=home)
                → Navigate to any portal
            → [No Password] "New here?" link
                → Set Password Page (page=set-password)
                    → [Success] Redirect to Login
```

### Returning User Journey

```
Root URL (/)
    → Login Page checks localStorage for token
        → [Token exists & valid] Auto-redirect to Dashboard
        → [No token or invalid] Show login form
```

### Portal Navigation (Authenticated)

```
Dashboard (page=home)
    ├── Commission Lookup (page=commission) - All users
    ├── Teacher Portal (page=teacher) - Teachers/Admins only
    └── Student Dashboard (page=attendance) - All users
```

## Session Storage Architecture

### Client-Side Storage

Sessions are stored in `localStorage` under the key:

```javascript
var SESSION_TOKEN_KEY = 'tradersutopia_session_token';
```

**Why localStorage instead of cookies?**
- Google Apps Script has limited cookie support
- localStorage provides reliable cross-iframe persistence
- Token is sent to server via `google.script.run` calls

### Server-Side Storage

Sessions are stored using a dual-layer approach:

1. **Primary**: `CacheService.getScriptCache()`
   - Fast access
   - Auto-expires after session duration + 5 minutes buffer
   - May be evicted under memory pressure

2. **Fallback**: `PropertiesService.getScriptProperties()`
   - Persistent storage
   - Restored to cache on access
   - Manually cleaned on logout

**Storage Key Format:**
```
SESSION_{token}
```

### Session Data Structure

```javascript
{
  token: "64-char-random-string_timestamp",
  email: "user@example.com",
  canonicalEmail: "user@example.com",    // For future aliasing
  displayEmail: "user@example.com",      // For future aliasing
  createdAt: "2024-01-01T12:00:00.000Z",
  expiresAt: 1704110400000,              // Unix timestamp
  lastSeenAt: "2024-01-01T14:00:00.000Z",
  isTeacher: true/false,
  isAdmin: true/false,
  userName: "John Doe"
}
```

## Session Token Generation

Tokens are cryptographically strong:

- 64 random characters from `[A-Za-z0-9-_]`
- Plus timestamp suffix for uniqueness
- ~384 bits of entropy

```javascript
function generateSessionToken_() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var token = '';
  for (var i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  token += '_' + Date.now().toString(36);
  return token;
}
```

## Session Expiration

### Duration

```javascript
var SESSION_DURATION_HOURS = 12; // 12-hour sessions
```

### Expiry Handling

1. **On each page load**: Session is validated
2. **If expired**: Token is deleted, user redirected to login
3. **On each valid access**: `lastSeenAt` is updated

### Manual Logout

Logout clears both client and server-side data:

```javascript
// Client
localStorage.removeItem(SESSION_TOKEN_KEY);

// Server
google.script.run.logoutSession(token);
```

## Role-Based Access Control

### Role Detection

On session creation, the system checks:

1. **Admin status**: Email in `ADMIN_EMAILS` array
2. **Teacher status**: First name contains "teacher" (case-insensitive)

```javascript
function getUserInfoForSession_(email) {
  // Check admin list
  var isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());
  
  // Check teacher status from affiliate API
  var isTeacher = isTeacherByFirstName_(firstName);
  
  // Admins are automatically granted teacher access
  if (isAdmin) isTeacher = true;
  
  return { isAdmin, isTeacher, name };
}
```

### Portal Access Rules

| Portal | Access Rule |
|--------|------------|
| Commission Lookup | All authenticated users |
| Student Dashboard | All authenticated users |
| Teacher Portal | Teachers and Admins only |
| Dashboard (Home) | All authenticated users |

### Access Denied Handling

If a non-teacher tries to access Teacher Portal:

1. Access denied overlay is shown
2. User can click "Back to Dashboard"
3. No error is thrown

## API Functions

### Public (Frontend-Callable)

| Function | Description |
|----------|-------------|
| `loginAndCreateSession(email, password)` | Full login flow: verify password + create session |
| `validateSessionToken(token)` | Check if session is valid, return user info |
| `getCurrentUser(token)` | Get user object from session |
| `logoutSession(token)` | Invalidate session |
| `checkPortalAccess(token, portal)` | Check if user can access specific portal |
| `createSession(email)` | Create session (internal use after password verify) |

### Admin Only

| Function | Description |
|----------|-------------|
| `adminListActiveSessions()` | List all active sessions |
| `adminClearAllSessions()` | Force all users to re-login |

## File Changes Summary

### New Files

- `Login.html` - Unified login page

### Modified Files

- `Code.js` - Added session management module (~300 lines)
- `home.html` - Converted to authenticated dashboard
- `CommissionLookup.Html` - Added session verification
- `teacherPortal.html` - Added session verification + teacher check
- `attendenceportal.html` - Added session verification

## Future Aliasing Support

The session architecture is designed to support email aliasing (displaying a different email than the canonical one):

### Current Structure

```javascript
{
  email: "momo50%@gmail.com",      // Actual email with % pattern
  canonicalEmail: "momo50%@gmail.com",
  displayEmail: "momo50%@gmail.com"
}
```

### Future Aliasing Structure

```javascript
{
  email: "momo50%@gmail.com",      // Used for commission calculations
  canonicalEmail: "momo50%@gmail.com",
  displayEmail: "friendly@alias.com"  // Shown publicly
}
```

### Where to Add Aliasing

1. **Session creation**: Look up alias mapping in new `ALIAS_MAP` sheet/property
2. **Session data**: Populate `displayEmail` from alias if exists
3. **UI display**: Use `displayEmail` everywhere visible to users
4. **Backend calculations**: Continue using `email`/`canonicalEmail` for % logic

## Testing Checklist

### Authentication Flow

- [ ] Fresh browser → Root URL shows login page
- [ ] Correct email + password → Redirects to dashboard
- [ ] Wrong password → Shows error, stays on login
- [ ] No password set → Shows error with "New here?" highlight

### Session Persistence

- [ ] After login, refresh page → Still authenticated
- [ ] Navigate to portal → No re-login required
- [ ] Close browser, reopen → Session persists (within 12 hours)
- [ ] After 12 hours → Session expires, redirects to login

### Portal Navigation

- [ ] Dashboard → Commission → Works without login
- [ ] Dashboard → Student → Works without login
- [ ] Dashboard → Teacher (as teacher) → Works without login
- [ ] Dashboard → Teacher (as non-teacher) → Shows access denied

### Logout

- [ ] Click logout → Redirects to login
- [ ] After logout, try to access portal → Redirected to login
- [ ] After logout, check localStorage → Token removed

### Role Checking

- [ ] Admin email → Can access Teacher Portal
- [ ] Teacher email → Can access Teacher Portal
- [ ] Regular user → Cannot access Teacher Portal
- [ ] Commission % email pattern → Still works for calculations

### Edge Cases

- [ ] Direct link to `?page=commission` while logged out → Redirects to login
- [ ] Direct link to `?page=teacher` while logged in but not teacher → Access denied
- [ ] Expired session token → Cleaned up, redirected to login

## Security Considerations

1. **Tokens are not passwords**: They don't grant access to password reset
2. **Server-side validation**: Every page validates the token server-side
3. **No sensitive data in token**: Token is opaque, data stored server-side
4. **Rate limiting preserved**: Login still uses existing rate limiting
5. **Session invalidation**: Logout actually deletes the session, not just the client token

## Troubleshooting

### "Session expired" errors

- Token may have been evicted from cache
- Check if PropertiesService fallback is working
- Verify `SESSION_DURATION_HOURS` setting

### User stuck in login loop

- Check browser console for errors
- Verify `google.script.run` is working
- Check if token is being stored: `localStorage.getItem('tradersutopia_session_token')`

### Portal shows loading forever

- Session validation may be failing silently
- Check Apps Script execution logs
- Verify network connectivity

### Admin session list shows many expired sessions

- Run `adminClearAllSessions()` to clean up
- Consider implementing automatic cleanup trigger
