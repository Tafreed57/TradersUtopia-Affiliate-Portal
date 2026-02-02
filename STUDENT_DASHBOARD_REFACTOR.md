# Student Dashboard Refactor

## Overview

The **Attendance Portal** has been renamed and expanded to become the **Student Dashboard** - a comprehensive hub for students that now includes:

1. **Attendance Tracking** - Confirm daily attendance, view history, track missed days
2. **Teacher Assignment** - Select and manage teacher assignments
3. **Referrals/Leads Tracking** - View Rewardful referral counts and changes

## Why the Rename?

The original "Attendance Portal" name no longer accurately described the portal's functionality. With the addition of referral tracking and the existing teacher management features, the new name **"Student Dashboard"** better reflects its role as a central hub for student activity.

---

## New Feature: Leads Tracking (FIXED)

### What It Does

For each logged-in user, the dashboard now displays:
- **Total Leads** - The current count of LEADS (not visitors!) from Rewardful
- **Since Last Check** - The change (delta) since the previous data fetch
- **Last Updated** - Timestamp of when the data was last refreshed
- **Cache Status** - Whether data is from cache or freshly fetched
- **Leads Table** - Recent leads with dates (First Click, Became Lead, Converted)

### Critical Fix: Leads vs Visitors

The original implementation was broken because it was counting the wrong data. 

**Rewardful Terminology:**
- `visitor` = anonymous visit via affiliate link (we DON'T want this)
- `lead` = visitor provided contact info (THIS IS WHAT WE WANT)  
- `conversion` = paying customer

### How It Works

#### API Integration (FIXED)

The system now correctly uses:

```
GET https://api.getrewardful.com/v1/referrals
  ?affiliate_id={id}
  &conversion_state=lead   ← CRITICAL: Filter to leads only
  &page={page}
  &limit=100
```

This ensures we count LEADS, not visitors.

#### Pagination

Rewardful defaults to 25 results with max 100 per page. The system now correctly paginates through ALL leads (up to 5000) to get accurate counts.

#### Caching

- **Cache Duration**: 5 minutes (300,000ms)
- **Manual Refresh**: "Refresh" button bypasses cache for immediate API fetch
- **Cache Indicators**: UI shows "(cached)" or "(fresh)" status
- **CRITICAL**: Cache NEVER returns 0 if we have valid stored data - API failures return last known good values

#### Storage

Lead data is stored persistently in `PropertiesService.getScriptProperties()`:

```
Key: REFERRAL_DATA_{email}
Value: {
  userEmail: string,
  affiliateId: string,
  lastKnownLeadCount: number,      // ← Renamed for clarity
  previousLeadCount: number,
  lastSuccessfulFetchAt: timestamp, // ← When last API success happened
  lastFetchedAt: timestamp,
  recentLeads: [{id, state, createdAt, becameLeadAt, becameConversionAt}, ...],  // Last 50
  fetchHistory: [{timestamp, count, delta}, ...]  // Last 10 fetches
}
```

### User Isolation

Each user's lead data is keyed by their email address. There is no data leakage between users.

### Error Handling

If the API fails:
- Return last known good values (never reset to 0)
- Show warning in UI
- Log detailed debug info for troubleshooting

---

## Code Changes

### Frontend (`attendenceportal.html`)

1. **Renamed portal** - Title, header, and login text updated to "Student Dashboard"
2. **Added Referrals Section** - New UI card with:
   - Total referral count display
   - Delta (change) display
   - Last updated timestamp
   - Refresh button
   - Error state handling
3. **JavaScript Functions**:
   - `loadReferralData(forceRefresh)` - Fetches and displays referral data
   - `formatTimestamp(timestamp)` - Formats dates for display

### Backend (`Code.js`)

Functions (FIXED):

| Function | Purpose |
|----------|---------|
| `getReferralData(email, forceRefresh)` | Main function - FIXED to return leads |
| `fetchLeadsFromRewardful_(affiliateId, apiKey)` | **NEW** - Correctly fetches leads with `conversion_state=lead` |
| `prepareLeadsForDisplay_(leads)` | **NEW** - Sanitizes leads for table display (no PII) |
| `returnStoredDataWithWarning_(storedData, warning)` | **NEW** - Returns cached data on API failure |
| `getStoredReferralData_(email)` | Get cached lead data |
| `saveReferralData_(email, data)` | Save lead data |
| `debugReferralData(email)` | Admin debug function (enhanced) |
| `clearReferralData(email)` | Admin function to clear data |
| `testLeadsFetching()` | **NEW** - Test function with proper email |

---

## Teacher "None" Option

Teachers who log in to the Student Dashboard can now select **"None (I am a teacher)"** instead of choosing another teacher. This is useful because:

- Teachers don't need to be assigned to another teacher
- They can still use all dashboard features (attendance, referrals) independently
- Non-teachers cannot select this option (enforced on backend)

### How It Works

1. On login, the system checks if the user's first name contains "teacher"
2. If yes, the `isTeacher: true` flag is set in the user object
3. The teacher selection dropdown shows "🚫 None (I am a teacher)" at the top
4. Selecting "none" saves `teacherEmail: "none"` instead of a real email
5. Backend functions treat "none" as a valid teacher assignment for attendance confirmation

---

## Unchanged Functionality

The following features remain completely unchanged:

- ✅ Attendance confirmation
- ✅ Attendance history with missed days
- ✅ Teacher selection and assignment (enhanced with "None" option for teachers)
- ✅ Teacher removal detection
- ✅ Admin search and user management
- ✅ Session management and login

---

## Testing

### Manual Testing Steps

1. **Login Test**
   - Log in with a valid email
   - Verify the Referrals section appears after teacher is assigned

2. **Referral Load Test**
   - Observe initial referral count loads
   - Verify "Last updated" timestamp is current

3. **Cache Test**
   - Note the "(cached)" or "(fresh)" indicator
   - Wait < 5 minutes, reload → should show "(cached)"
   - Click "Refresh" → should show "(fresh)"

4. **Delta Test**
   - Note current count
   - If referrals change, the delta should update on next refresh

5. **Non-Affiliate Test**
   - Log in with a non-affiliate email
   - Should show 0 referrals with appropriate message

### Backend Test Functions

Run these from the Apps Script editor:

```javascript
// Test the full referral flow
testReferralFetching();

// Debug a specific user's referral data
debugReferralData('user@example.com');

// Clear referral data for a user (admin only)
clearReferralData('user@example.com');
```

---

## Configuration

### Cache Duration

To change the cache duration, modify in `Code.js`:

```javascript
var REFERRAL_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
```

### API Key

The system uses the existing `AFFILIATE_API_KEY` from Script Properties.

---

## Error Handling

The system gracefully handles:

- **No API key**: Returns error message
- **User not an affiliate**: Returns 0 referrals with message
- **API failure**: Uses cached data if available, shows warning
- **Invalid email**: Returns validation error

---

## Security

- Referral data is per-user and keyed by email
- Debug/clear functions require admin privileges (`isAdmin_()` check)
- Teacher emails are hidden from students in dropdowns

---

## Files Modified

| File | Changes |
|------|---------|
| `attendenceportal.html` | Renamed to Student Dashboard, added Referrals UI |
| `Code.js` | Added referral tracking functions |
| `STUDENT_DASHBOARD_REFACTOR.md` | This documentation |

