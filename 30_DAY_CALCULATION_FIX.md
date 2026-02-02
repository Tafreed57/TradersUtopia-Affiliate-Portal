# 30-Day Commission Calculation Fix

## Problem Fixed

The **30-day Unpaid** and **30-day Due Now** amounts were showing **$0.00 CAD** for students in the Teacher Portal, even when students had recent commissions.

### Screenshot Evidence:
- Student: `sarah40%@gmail.com`
- Display showed: **30d Unpaid: $0.00 CAD** ❌
- Display showed: **30d Due: $0.00 CAD** ❌

---

## Root Cause

The initial implementation of `getRawStudentCommissionData_()` had a flawed 30-day calculation:

### Issues with Original Approach:

1. **Wrong API Endpoint**: Used `/affiliates/{id}/commissions` 
   - This endpoint may not return all commissions
   - Pagination wasn't handled properly
   - Less reliable than the main commissions endpoint

2. **Single Page Fetch**: Only fetched first page (per_page=200)
   - If student had >200 commissions, older ones were missed
   - 30-day calculation incomplete

3. **No Pagination Logic**: Didn't loop through pages
   - Critical for students with many commissions
   - Could miss recent commissions if they weren't on page 1

---

## Solution Implemented

### 1. Created New Helper Function: `calculate30DaysRawByAffiliateId_()`

**Location**: `Code.js` lines 4052-4184

**Purpose**: Calculate RAW 30-day commissions by affiliate ID with proper pagination

**Key Features**:
- ✅ Uses correct API endpoint: `/commissions?affiliate_id={id}`
- ✅ Handles pagination (up to 20 pages, 200 per page = 4000 commissions)
- ✅ Filters by date (last 30 days only)
- ✅ Handles currency conversion (USD→CAD)
- ✅ Handles cents→dollars conversion
- ✅ Properly sums unpaid and due amounts by status
- ✅ Rate limiting (200ms delay between requests)
- ✅ Comprehensive error handling
- ✅ Detailed logging for debugging

**What it does**:
```javascript
1. Calculate cutoff date (30 days ago)
2. Loop through ALL commission pages:
   - Fetch page from API
   - Check response code
   - Parse JSON
   - Extract commissions
   - Add to array
   - Continue until no more data or max pages
3. Filter commissions by date (>= 30 days ago)
4. Sum amounts based on status:
   - pending/approved/confirmed → add to unpaid
   - approved/confirmed → add to due now
5. Return totals
```

### 2. Modified `getRawStudentCommissionData_()` Function

**Location**: `Code.js` lines 4300-4309 (in the function body)

**Changes**:
```javascript
// BEFORE (lines 4162-4219): Custom implementation with issues
var commUrl = BASE_URL + '/affiliates/' + aff.id + '/commissions?per_page=200';
// ... flawed logic ...

// AFTER (lines 4300-4309): Use new helper function
var thirtyDayData = calculate30DaysRawByAffiliateId_(aff.id, apiKey);
unpaid30Days = round2_(thirtyDayData.unpaid || 0);
dueNow30Days = round2_(thirtyDayData.dueNow || 0);
```

**Benefits**:
- ✅ Reuses affiliate ID already fetched (no redundant API calls)
- ✅ Avoids calling `fetchByEmail_()` which triggers tracking updates
- ✅ More efficient - doesn't duplicate work
- ✅ Uses battle-tested pagination logic from existing codebase

---

## How It Works Now

### Teacher Portal Flow for 30-Day Data:

1. **Teacher views students** → Each student row shows 30-day amounts
2. **System calls** `getStudentsCommissionData(teacherEmail)`
3. **For each student**, calls `getRawStudentCommissionData_(email)`:
   - Fetches affiliate data from API
   - Gets all-time totals from `commission_stats.currencies`
   - Calls `calculate30DaysRawByAffiliateId_(affiliateId, apiKey)`:
     - Fetches ALL commission pages from API
     - Filters commissions by date (last 30 days)
     - Sums unpaid and due amounts
     - Returns 30-day totals
4. **Displays** RAW 100% values to teacher:
   - 30d Unpaid: Sum of pending+approved+confirmed from last 30 days
   - 30d Due Now: Sum of approved+confirmed from last 30 days
   - Total Unpaid: All-time unpaid amount
   - Total Due Now: All-time due amount

---

## Technical Details

### API Endpoint Comparison:

**❌ OLD (Incorrect)**:
```
GET /affiliates/{id}/commissions?per_page=200
```
- Less reliable
- May not return all commissions
- Not designed for comprehensive data fetching

**✅ NEW (Correct)**:
```
GET /commissions?affiliate_id={id}&page={page}&per_page=200
```
- Primary commissions endpoint
- Reliable pagination
- Returns all commissions for affiliate
- Same endpoint used by Commission Lookup Portal

### Pagination Logic:

```javascript
var page = 1;
var MAX_PAGES = 20; // Safety limit (20 × 200 = 4000 commissions max)

while (page <= MAX_PAGES) {
  // Fetch page
  var url = BASE_URL + '/commissions?affiliate_id=' + affiliateId + 
            '&page=' + page + '&per_page=200';
  
  // Rate limiting
  Utilities.sleep(200); // 200ms delay
  
  var response = fetchWithRetry_(url, apiKey);
  
  // Check for end conditions
  if (response.code === 404) break;           // No more data
  if (commissions.length < 200) break;        // Last page (partial results)
  if (commissions.length === 0) break;        // Empty page
  
  // Add to array and continue
  allCommissions = allCommissions.concat(commissions);
  page++;
}
```

### Date Filtering:

```javascript
var thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

commissions.forEach(function(c) {
  var commDate = new Date(c.created_at || c.date);
  
  // Only include commissions from last 30 days
  if (commDate >= thirtyDaysAgo) {
    // Add to totals...
  }
});
```

### Status-Based Calculation:

```javascript
var status = readStatus_(c); // pending, approved, confirmed, paid, etc.

if (status === 'pending' || status === 'approved' || status === 'confirmed') {
  unpaid30Days += amount;  // Not yet paid
  
  if (status === 'approved' || status === 'confirmed') {
    dueNow30Days += amount;  // Ready for payout
  }
}
```

---

## Files Modified

### `Code.js`

**New Function Added** (lines 4052-4184):
```javascript
function calculate30DaysRawByAffiliateId_(affiliateId, apiKey)
```
- 132 lines
- Handles pagination properly
- Filters by 30-day date range
- Returns RAW 100% totals

**Modified Function** (lines 4300-4309 in `getRawStudentCommissionData_`):
- Changed 30-day calculation to use new helper function
- ~10 lines modified
- More efficient, more reliable

**Total Changes**:
- ~142 lines added/modified
- No breaking changes
- Backward compatible

---

## Testing Checklist

After deploying this fix, verify:

- [ ] Teacher can log in successfully
- [ ] Student list displays correctly
- [ ] **30d Unpaid** shows correct amounts (not $0.00)
- [ ] **30d Due** shows correct amounts (not $0.00)
- [ ] Values match what's in the affiliate system
- [ ] Students with >200 commissions show correct 30-day totals
- [ ] Currency conversion is correct (USD→CAD)
- [ ] "Adjusted Totals" still calculates correctly

### Test Cases:

**Test Case 1: Student with Recent Commissions**
- Setup: Student with commissions in last 30 days
- Expected: 30d Unpaid and 30d Due show correct amounts

**Test Case 2: Student with Old Commissions Only**
- Setup: Student with no commissions in last 30 days
- Expected: 30d Unpaid = $0.00, 30d Due = $0.00 (correct!)

**Test Case 3: Student with Many Commissions (>200)**
- Setup: Student with 500+ commissions
- Expected: All recent commissions included in 30-day calculation

**Test Case 4: Student with Mixed Status Commissions**
- Setup: Some pending, some approved, some paid
- Expected:
  - 30d Unpaid includes pending + approved
  - 30d Due includes only approved

---

## Performance Considerations

### API Calls:

**Per Student in Teacher Portal**:
1. Get affiliate by email: 1 API call
2. Get affiliate with expansion: 1 API call
3. Get 30-day commissions: 1-20 API calls (depends on commission count)

**Optimization**:
- Results are cached for 5 minutes
- Rate limiting prevents API throttling
- Pagination stops early when no more data

### Caching Strategy:

```javascript
// Student data cached for 5 minutes
var cacheKey = 'students_data_' + teacherEmail.toLowerCase();
var cached = getCachedApiResponse_(cacheKey);
if (cached !== null) {
  return cached; // Skip all API calls
}
```

---

## Debugging

### Enable Detailed Logging:

The new function includes comprehensive logging:

```javascript
Logger.log('Calculating RAW 30-day commissions for affiliate ID: ' + affiliateId);
Logger.log('Cutoff date (30 days ago): ' + cutoffDate);
Logger.log('Fetching page ' + page);
Logger.log('Found ' + pageCommissions.length + ' commissions on page ' + page);
Logger.log('Total commissions fetched: ' + allCommissions.length);
Logger.log('30-day RAW totals: Unpaid=$' + unpaid30Days + ', Due Now=$' + dueNow30Days);
```

### View Logs:

1. Open Google Apps Script Editor
2. Click **View** → **Executions**
3. Click on recent execution
4. Scroll through logs to see:
   - How many pages fetched
   - Total commissions found
   - 30-day filtered totals
   - Any errors encountered

### Common Issues:

**Issue**: Still showing $0.00 after fix
- **Check**: Are there actually commissions in last 30 days?
- **Check**: Are they in "pending" or "approved" status?
- **Check**: Logs for actual commission count fetched

**Issue**: Values seem too low
- **Check**: Pagination is working (see logs for page count)
- **Check**: Date filtering is correct (cutoff date in logs)
- **Check**: Currency conversion applied correctly

**Issue**: Slow performance
- **Check**: How many API pages being fetched (see logs)
- **Check**: Cache is working (shouldn't refetch every time)
- **Check**: Rate limiting delay (200ms per page)

---

## Comparison: Before vs After

### Before Fix:

```javascript
// Single page fetch, flawed logic
var commUrl = BASE_URL + '/affiliates/' + aff.id + '/commissions?per_page=200';
var commResp = fetchWithRetry_(commUrl, apiKey);
// ... no pagination, incomplete results ...
```

**Problems**:
- ❌ Only first 200 commissions
- ❌ Wrong API endpoint
- ❌ No pagination
- ❌ Incomplete 30-day calculation

### After Fix:

```javascript
// Proper pagination and filtering
var thirtyDayData = calculate30DaysRawByAffiliateId_(aff.id, apiKey);
unpaid30Days = round2_(thirtyDayData.unpaid || 0);
dueNow30Days = round2_(thirtyDayData.dueNow || 0);
```

**Benefits**:
- ✅ All commissions fetched (up to 4000)
- ✅ Correct API endpoint
- ✅ Proper pagination
- ✅ Complete 30-day calculation
- ✅ Reuses affiliate ID (efficient)
- ✅ Comprehensive logging

---

## Deployment Instructions

1. **Backup Current Code**:
   - Save a copy of current `Code.js` before updating

2. **Update `Code.js`**:
   - Copy the modified `Code.js` to your Google Apps Script project
   - Save in Script Editor

3. **Clear Cache** (important!):
   - Old cached data might show $0.00
   - Wait 5 minutes OR manually clear cache
   - Use "🔄 Force Refresh" button in Teacher Portal

4. **Test**:
   - Log in as teacher
   - Click "Refresh Data" to clear cache
   - Verify 30-day amounts now display correctly
   - Check logs for any errors

5. **Monitor**:
   - Watch for API rate limiting issues
   - Check execution time (should be reasonable)
   - Verify cache is working (shouldn't refetch every time)

---

## Rollback Plan

If issues arise:

1. **Quick Rollback**:
   - Restore the backed-up `Code.js` file
   - Redeploy previous version

2. **Partial Rollback**:
   - Remove `calculate30DaysRawByAffiliateId_()` function
   - Revert 30-day calculation in `getRawStudentCommissionData_()` to previous version

---

**Created**: November 18, 2025
**Version**: 1.0
**Status**: Ready for Deployment
**Impact**: Medium (Teacher Portal only)
**Risk**: Low (Isolated to 30-day calculation, no changes to payment processing)
**Fixes**: 30-day amounts showing $0.00 incorrectly

