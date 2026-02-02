# Teacher Portal Fix - Raw Commission Display

## Problem Fixed

Teachers were seeing **adjusted** (percentage-reduced) values instead of the **full 100%** commission amounts that their students are earning.

### Example of the Issue:
- Student email: `student50%@gmail.com`
- Student's actual commissions: $100 CAD
- **Before Fix**: Teacher saw $50 CAD (50% adjusted value)
- **After Fix**: Teacher sees $100 CAD (full 100% value)

The teacher's percentage (e.g., 10%) should ONLY apply in the "Adjusted Totals" section, not in the main "Total Unpaid" and "Total Due Now" cards.

---

## Root Cause

The `getStudentsCommissionData()` function was using `fetchByEmail_()` which applies:
- ✅ Email percentage extraction (e.g., 50% from `student50%@gmail.com`)
- ✅ Incremental tracking adjustments
- ✅ Admin overrides

This is correct for the **Commission Lookup Portal** where affiliates check their own earnings, but **incorrect for the Teacher Portal** where teachers need to see the full amounts their students are earning.

---

## Solution Implemented

### 1. Created New Function: `getRawStudentCommissionData_(email)`

**Location**: `Code.js` lines 4053-4241

**Purpose**: Bypasses all percentage logic and tracking to get pure 100% API values

**What it does**:
- Fetches affiliate data directly from API
- Uses `commission_stats.currencies` for accurate balance data
- Calculates 30-day filtered amounts (without percentage adjustments)
- Returns RAW 100% values for:
  - `totalUnpaid` - All-time unpaid commissions
  - `totalDueNow` - All-time due now commissions
  - `totalPaid` - All-time paid commissions
  - `unpaid30Days` - Last 30 days unpaid (for display)
  - `dueNow30Days` - Last 30 days due now (for display)

**Key features**:
- No email percentage extraction
- No incremental tracking
- No admin override application
- Pure API data conversion (USD→CAD if needed)
- Handles cents→dollars conversion

### 2. Modified Function: `getStudentsCommissionData(teacherEmail)`

**Location**: `Code.js` lines 4249-4335

**Changes**:
```javascript
// BEFORE (line 4076):
var affiliateData = fetchByEmail_(student.email);
// This applied email percentages and tracking

// AFTER (line 4075):
var rawData = getRawStudentCommissionData_(student.email);
// This gets pure 100% API values
```

**Result**:
- Teachers now see **100% of student earnings** in the main display
- The "Adjusted Totals" section correctly applies the teacher's percentage
- Example: If student earns $100 and teacher gets 10%, teacher sees:
  - Total Unpaid: **$100** (100% of student's earnings)
  - Adjusted Unpaid: **$10** (teacher's 10% cut)

---

## How It Works Now

### Teacher Portal Flow:

1. **Teacher logs in** → System verifies teacher access
2. **Teacher views students** → Shows list of all students they added
3. **System fetches RAW data** for each student:
   - Gets 100% of student's unpaid amount
   - Gets 100% of student's due now amount
   - Gets 100% of student's total paid
4. **Display in "Total Unpaid" & "Total Due Now" cards**:
   - Sum of ALL students' 100% values
   - Teacher sees the FULL amount students are earning
5. **Teacher enters percentage** (e.g., 10%) in "Adjusted Totals" section
6. **System applies teacher's percentage**:
   - Adjusted Unpaid = Total Unpaid × (Teacher % / 100)
   - Adjusted Due Now = Total Due Now × (Teacher % / 100)
7. **Teacher sees their cut** in the "Adjusted Totals" section

---

## Testing Checklist

After deploying this fix, verify:

- [ ] Teacher can log in successfully
- [ ] Student list displays correctly
- [ ] **Total Unpaid** shows 100% of student earnings (not adjusted)
- [ ] **Total Due Now** shows 100% of student earnings (not adjusted)
- [ ] Entering percentage in "Adjusted Totals" section works
- [ ] **Adjusted Unpaid** = Total Unpaid × (Teacher % / 100)
- [ ] **Adjusted Due Now** = Total Due Now × (Teacher % / 100)
- [ ] Payment tracking still works correctly

### Example Test Case:

**Setup**:
- Student: `student50%@gmail.com`
- Student's actual API unpaid amount: $200 CAD
- Teacher percentage: 10%

**Expected Results**:
- ✅ Total Unpaid card: **$200 CAD** (not $100)
- ✅ Total Due Now card: Shows correct 100% value
- ✅ When teacher enters 10%:
  - Adjusted Unpaid: **$20 CAD** ($200 × 0.10)
  - Adjusted Due Now: Correct 10% of due now

---

## Technical Details

### Data Sources Priority:

The `getRawStudentCommissionData_()` function uses this priority:

1. **Primary**: `commission_stats.currencies[CAD]` or `[USD]`
   - Most accurate, pre-calculated by affiliate system
   - Includes: unpaid, due, paid amounts

2. **Fallback**: `sumDueNowForAffiliate_()` calculation
   - Calculates from individual commission records
   - Used when commission_stats not available

3. **30-day filtering**: Separate calculation
   - Iterates through commission records
   - Filters by date (last 30 days only)
   - Sums unpaid and due amounts

### Currency Handling:

```javascript
// Cents → Dollars conversion
if (Number.isInteger(amount) && Math.abs(amount) >= 100) {
  amount = amount / 100;
}

// USD → CAD conversion
if (currencyIso === 'USD' && CURRENCY === 'CAD') {
  amount = amount * USD_TO_CAD_RATE;  // 1.35
}

// Final rounding
amount = round2_(amount);  // 2 decimal places
```

---

## Files Modified

### `Code.js`

**New Function Added** (lines 4053-4241):
```javascript
function getRawStudentCommissionData_(email)
```
- 188 lines
- Gets RAW 100% API data
- Bypasses all percentage/tracking logic

**Modified Function** (lines 4249-4335):
```javascript
function getStudentsCommissionData(teacherEmail)
```
- Changed to use `getRawStudentCommissionData_()` instead of `fetchByEmail_()`
- Updated comments to clarify RAW data usage
- ~20 lines modified

**Total Changes**:
- ~208 lines added/modified
- No breaking changes to existing functionality
- Backward compatible

---

## Impact Assessment

### ✅ What's Fixed:
- Teachers now see correct 100% student earnings
- Teacher percentage applies only to "Adjusted Totals"
- Payment calculations remain accurate
- All existing functionality preserved

### ✅ What's NOT Changed:
- Commission Lookup Portal (still uses percentage/tracking correctly)
- Admin panel functionality
- Student percentage emails still work as designed
- Payment processing logic unchanged

### ✅ Side Benefits:
- Clearer separation between raw data and adjusted data
- More transparent for teachers (see full student earnings)
- Easier to verify teacher payment calculations
- Better debugging capabilities

---

## Deployment Instructions

1. **Backup Current Code**:
   - Save a copy of current `Code.js` before updating

2. **Update `Code.js`**:
   - Copy the modified `Code.js` to your Google Apps Script project
   - OR manually copy the new function (lines 4053-4241)
   - AND modify `getStudentsCommissionData()` (lines 4249-4335)

3. **Save & Deploy**:
   - Save the file in Script Editor
   - Deploy as new version

4. **Test**:
   - Log in as a teacher
   - Verify student data displays correctly
   - Check "Total Unpaid" and "Total Due Now" show 100% values
   - Test "Adjusted Totals" calculation
   - Verify payment processing still works

5. **Monitor**:
   - Check logs for any errors
   - Verify teacher reports are accurate
   - Confirm payments are calculated correctly

---

## Rollback Plan

If issues arise:

1. **Quick Rollback**:
   - Restore the backed-up `Code.js` file
   - Redeploy previous version

2. **Partial Rollback**:
   - Revert `getStudentsCommissionData()` to use `fetchByEmail_()`
   - Remove the new `getRawStudentCommissionData_()` function

---

## Support & Troubleshooting

### Common Issues:

**Issue**: Teacher sees $0 for all students
- **Cause**: API connection issue or cache problem
- **Fix**: Clear cache, reload data, check API key

**Issue**: 30-day amounts don't match all-time
- **Cause**: Expected behavior if commissions older than 30 days
- **Fix**: This is correct - verify by checking commission dates

**Issue**: Currency conversion seems wrong
- **Cause**: USD_TO_CAD_RATE might need updating
- **Fix**: Check current exchange rate, update constant if needed

### Debug Logging:

The new function includes comprehensive logging:
```javascript
Logger.log('=== GETTING RAW STUDENT DATA (100%) for: ' + email + ' ===');
Logger.log('Found affiliate ID: ' + aff.id);
Logger.log('Unpaid: $' + totalUnpaid);
Logger.log('Due Now: $' + totalDueNow);
Logger.log('Total Paid: $' + totalPaid);
Logger.log('30-day totals: Unpaid=$' + unpaid30Days + ', Due Now=$' + dueNow30Days);
```

View logs in Google Apps Script:
- **View** → **Executions**
- Click on execution to see detailed logs

---

**Created**: November 18, 2025
**Version**: 1.0
**Status**: Ready for Deployment
**Impact**: Medium (Teacher Portal only)
**Risk**: Low (Isolated to teacher data fetching, no changes to payment processing)

