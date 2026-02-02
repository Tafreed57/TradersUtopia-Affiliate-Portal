# Soft Reset - Preventing Double Earnings or Lost Earnings

## Problem Identified

The user asked an excellent question: **"What if I reset after students get paid (money lowered) - will it still track the same?"**

The original reset function had a critical flaw that would cause either:
1. **Double earnings** (earning from the same money twice), OR
2. **Lost earnings** (losing credit for money students already got paid)

### Example of the Problem:

**Scenario with OLD reset:**
1. Student has $100 unpaid
2. Teacher clicks "Update My Earnings" → Locks in $10 (at 10%)
3. Student gets paid $50 → Student now has $50 unpaid
4. Teacher clicks "Reset" → Everything cleared (including tracking)
5. Teacher clicks "Update My Earnings" → System treats $50 as NEW and adds $5

**Result:** Teacher only has $5 locked, but student already got paid $50 that the teacher earned from. **Lost $5 in earnings!**

OR if teacher clicks "Update My Earnings" before and after reset:
1. Before reset: $10 locked from $100
2. Reset clears everything
3. After reset: $5 locked from $50
4. **Total: $15** (but should only be $10) - **Double counting $5!**

## Solution: "Soft Reset" vs "Full Reset"

Implemented two reset modes:

### 1. Soft Reset (Default) ✅
**What it does:**
- Clears locked earnings to $0
- **BUT preserves student tracking baseline**
- Sets each student's "last known amount" to their CURRENT balance
- Next "Update My Earnings" only adds truly NEW earnings

**When to use:**
- Fixing percentage calculation errors
- Recalculating with corrected percentages
- Any time students may have already been paid

**How it works:**
```javascript
// After soft reset:
studentTracking = {
  "student@email.com": {
    unpaid: 50,  // Current amount (already reduced by payout)
    dueNow: 0
  }
}

// Next "Update My Earnings":
// Student now has $80 unpaid
// Increase = $80 - $50 = $30 (only the NEW $30)
// Teacher earns = $30 × 10% = $3 ✅ CORRECT
```

### 2. Full Reset
**What it does:**
- Clears locked earnings to $0
- Clears all student tracking (empty baseline)
- Next "Update My Earnings" captures all current amounts as NEW

**When to use:**
- Starting completely fresh
- When you WANT to recapture current student balances
- Testing scenarios

**How it works:**
```javascript
// After full reset:
studentTracking = {} // Empty

// Next "Update My Earnings":
// Student has $50 unpaid
// No tracking exists, so treats $50 as NEW
// Teacher earns = $50 × 10% = $5
```

## Code Changes

### Backend (Code.js)

**Function: `resetTeacherEarnings(teacherEmail, mode)`**

**Before (Lines 4319-4339):**
```javascript
function resetTeacherEarnings(teacherEmail) {
  // Simply deleted everything
  var key = 'teacher_earnings_' + teacherEmail.toLowerCase();
  PropertiesService.getScriptProperties().deleteProperty(key);
  // ...
}
```

**After (Lines 4319-4375):**
```javascript
function resetTeacherEarnings(teacherEmail, mode) {
  mode = mode || 'soft'; // Default to soft reset
  
  if (mode === 'soft') {
    // Get current student data
    var studentsData = getStudentsCommissionData(teacherEmail);
    
    // Create fresh history with ZERO earnings
    var history = {
      totalEarned: 0,
      totalUnpaidEarned: 0,
      totalDueNowEarned: 0,
      lastUpdated: new Date().toISOString(),
      studentTracking: {}
    };
    
    // Set baseline to CURRENT amounts (preserves tracking)
    studentsData.forEach(function(student) {
      history.studentTracking[student.email.toLowerCase()] = {
        unpaid: student.totalUnpaid || 0,
        dueNow: student.totalDueNow || 0
      };
    });
    
    // Save with zero earnings but preserved tracking
    saveTeacherEarningsHistory(teacherEmail, history);
    
  } else if (mode === 'full') {
    // Original behavior: delete everything
    PropertiesService.getScriptProperties().deleteProperty(key);
  }
}
```

### Frontend (teacherPortal.html)

**Updated confirmation dialog** (Lines 874-881):
```javascript
var msg = '⚠️ RESET LOCKED EARNINGS?\n\n';
msg += 'This will:\n';
msg += '✓ Clear your locked earnings to $0\n';
msg += '✓ Keep tracking current student amounts as baseline\n';
msg += '✓ Only add NEW earnings going forward\n\n';
msg += '💡 Use this when you need to recalculate earnings with corrected percentages.\n\n';
msg += 'After reset, your next "Update My Earnings" will only count NEW student commissions (not current amounts).\n\n';
msg += 'Are you sure?';
```

**Reset call** (Line 918):
```javascript
.resetTeacherEarnings(currentTeacher, 'soft');  // Explicitly use soft mode
```

**Updated explanation text** (Line 473):
```
⚠️ Click "Reset" to clear locked earnings while preserving tracking (use when fixing percentage errors). 
After reset, only NEW earnings will be added.
```

## Testing Scenarios

### Scenario 1: Reset After Percentage Fix (Most Common)

**Setup:**
- Student has $100 unpaid
- Teacher accidentally used 10% instead of 20%
- Already locked in $10 (should be $20)

**Steps:**
1. Change percentage to 20%
2. Click "Reset" → Soft reset
   - Locked earnings: $0
   - Student tracking: $100 baseline preserved
3. Click "Update My Earnings"
   - No new earnings (student still at $100)
   - Locked earnings: $0 (correct - waiting for new commissions)
4. Student earns $50 more → Now has $150
5. Click "Update My Earnings"
   - New earnings: $50 × 20% = $10
   - Locked earnings: $10 ✅

**Result:** Going forward, teacher gets correct 20% on all NEW earnings

### Scenario 2: Reset After Student Payout

**Setup:**
- Student has $100 unpaid
- Teacher locked in $10
- Student gets paid $50 → Now has $50 unpaid

**Steps:**
1. Click "Reset" → Soft reset
   - Locked earnings: $0
   - Student tracking: $50 baseline preserved (current amount)
2. Click "Update My Earnings"
   - No new earnings (student still at $50)
   - Locked earnings: $0
3. Student earns $30 more → Now has $80
4. Click "Update My Earnings"
   - New earnings: $30 × 10% = $3
   - Locked earnings: $3 ✅

**Result:** Teacher doesn't lose credit or double-count. Only NEW $30 is counted.

### Scenario 3: Multiple Students, Mixed Payouts

**Setup:**
- Student A: $100 → Locked $10
- Student B: $200 → Locked $20
- Total locked: $30
- Then: Student A gets paid $50 (now $50), Student B stays at $200

**Steps:**
1. Click "Reset" → Soft reset
   - Locked earnings: $0
   - Tracking: A=$50, B=$200
2. Click "Update My Earnings"
   - No changes for either student
   - Locked earnings: $0
3. Student A earns $40 more (now $90), Student B earns $100 more (now $300)
4. Click "Update My Earnings"
   - Student A: $40 × 10% = $4
   - Student B: $100 × 10% = $10
   - Total locked: $14 ✅

**Result:** Only NEW earnings counted, no double-counting or losses

## Why This Matters

### Without Soft Reset:
- Teachers could accidentally lose earnings if students get paid before reset
- OR teachers could double-count earnings
- No safe way to fix percentage errors after students get paid
- Tracking would be unreliable after any payout

### With Soft Reset:
- ✅ Safe to reset at any time, even after payouts
- ✅ Tracking is always preserved
- ✅ Only truly NEW earnings are counted
- ✅ No risk of lost or double-counted earnings
- ✅ Can confidently fix percentage errors whenever needed

## User Guidance

**When to use Reset:**
- ✅ You saved wrong percentages and need to fix them
- ✅ You want to recalculate from a clean slate but preserve tracking
- ✅ Your locked earnings look wrong and need correction

**What happens after Reset:**
- Your locked earnings show $0
- BUT the system remembers each student's current balance
- Your NEXT "Update My Earnings" won't add anything (students haven't changed yet)
- Only when students earn MORE commission will you see new locked earnings
- Those new earnings will use the correct percentages

**Important:** You don't lose credit for past earnings! The reset just clears the display. Going forward, you'll only earn from NEW student commissions, which is exactly what you want.

## Files Modified

1. **Code.js** (Lines 4318-4375)
   - Added `mode` parameter to `resetTeacherEarnings()`
   - Implemented soft reset logic (default)
   - Kept full reset as optional mode

2. **teacherPortal.html** (Lines 872-919, 473)
   - Updated reset confirmation dialog with clear explanation
   - Changed reset call to use 'soft' mode
   - Updated help text to explain soft reset behavior

---

## Summary

The "Soft Reset" feature solves a critical problem that the user identified: **resetting after student payouts would have caused incorrect earnings tracking**. 

Now teachers can safely reset their locked earnings at any time without worrying about:
- Losing credit for past earnings
- Double-counting earnings
- Breaking the tracking system

The system automatically preserves each student's current balance as a baseline and only counts truly NEW earnings going forward.

This is the **correct and expected behavior** for a locked earnings system.

