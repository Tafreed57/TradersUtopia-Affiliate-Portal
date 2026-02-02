# Teacher Earnings - Locked Earnings System & Per-Student Percentages

## Overview

This document describes the new **Locked Earnings System** for teachers and the **Per-Student Percentage Override** functionality. These features address two critical requirements:

1. **Teacher earnings should remain locked in and not decrease when students get paid out**
2. **Teachers should be able to set individual percentages for each student**

## Problem Statement

### Issue 1: Earnings Decreasing When Students Get Paid
**Before:** Teacher earnings were calculated dynamically from current student unpaid amounts. When a student got paid (their unpaid amount decreased), the teacher's calculated share would also decrease, which was incorrect.

**Solution:** Implemented a cumulative earnings tracking system where teacher earnings are "locked in" when they're calculated. Only NEW student earnings are added to the teacher's totals. When students get paid, the teacher's earnings remain unchanged.

### Issue 2: One-Size-Fits-All Percentage
**Before:** Teachers had only one percentage that applied to all students collectively.

**Solution:** Teachers can now set individual percentages for each student, with a default percentage that can be applied to all students at once.

---

## Architecture

### 1. Teacher Earnings Tracking System

#### Storage Structure
Teacher earnings are stored in `PropertiesService` with the key pattern:
```
teacher_earnings_{teacherEmail}
```

The stored data structure:
```javascript
{
  totalEarned: 0,              // Cumulative total earnings
  totalUnpaidEarned: 0,        // Cumulative unpaid earnings (locked in)
  totalDueNowEarned: 0,        // Cumulative due now earnings (locked in)
  lastUpdated: "ISO date",     // Timestamp of last update
  studentTracking: {           // Tracks last known amounts for each student
    "student@email.com": {
      unpaid: 0,
      dueNow: 0
    }
  }
}
```

#### How It Works

1. **Initialization**: When a teacher first uses the system, their earnings history starts at $0.

2. **Updating Earnings**: When the teacher clicks "Update My Earnings", the system:
   - Fetches current student commission data (100% raw values)
   - Compares each student's current amounts to their last tracked amounts
   - Calculates the INCREASE (if any) for each student
   - Applies the teacher's percentage (default or per-student override) to the increase
   - Adds this to the teacher's cumulative locked earnings
   - Updates the tracking for each student

3. **Key Logic**: 
   ```javascript
   unpaidIncrease = Math.max(0, currentUnpaid - lastTrackedUnpaid);
   teacherShare = unpaidIncrease * (teacherPercentage / 100);
   totalUnpaidEarned += teacherShare;
   ```

4. **Locked Earnings**: Once added, these earnings never decrease, even if students get paid.

### 2. Per-Student Percentage Override System

#### Storage Structure
Per-student percentages are stored with the key pattern:
```
teacher_student_pct_{teacherEmail}_{studentEmail}
```

Value: The percentage as a float (e.g., "10", "15.5")

#### Hierarchy
- Each student can have a specific percentage override
- If no override is set, the teacher's default percentage is used
- The default percentage is saved separately (existing functionality)

---

## Code Changes

### Backend Functions (Code.js)

#### New Functions Added (Lines 4048-4339)

1. **`setStudentPercentageOverride(teacherEmail, studentEmail, percentage)`**
   - Saves a percentage override for a specific student
   - Returns: `{success: true}` or `{success: false, error: message}`

2. **`getStudentPercentageOverride(teacherEmail, studentEmail)`**
   - Retrieves the percentage override for a specific student
   - Returns: percentage (number) or null if not set

3. **`getAllStudentPercentageOverrides(teacherEmail)`**
   - Gets all percentage overrides for all students under a teacher
   - Returns: Object mapping student emails to percentages

4. **`applyDefaultPercentageToAllStudents(teacherEmail, defaultPercentage)`**
   - Applies the default percentage to all students at once
   - Returns: `{success: true, count: number}` or `{success: false, error: message}`

5. **`getTeacherEarningsHistory(teacherEmail)`**
   - Retrieves the teacher's locked earnings history
   - Returns: earnings history object (see structure above)
   - Initializes with zeros if no history exists

6. **`saveTeacherEarningsHistory(teacherEmail, earningsData)`**
   - Saves the teacher's earnings history
   - Automatically updates the `lastUpdated` timestamp

7. **`updateTeacherEarnings(teacherEmail)`**
   - **Main function** for the locked earnings system
   - Calculates NEW earnings since last check
   - Applies appropriate percentages (per-student or default)
   - Adds to cumulative locked totals
   - Returns detailed result including new earnings and updated totals

8. **`recordTeacherPayout(teacherEmail, amount)`**
   - Records when a teacher is paid out
   - Reduces the `totalUnpaidEarned` balance
   - For future admin functionality

9. **`resetTeacherEarnings(teacherEmail)`**
   - Resets a teacher's earnings tracking (for testing/corrections)
   - Clears the earnings history

#### Modified Functions

**`getStudentsCommissionData(teacherEmail)`** (Lines 4635-4726)
- Now retrieves and includes `teacherPercentage` for each student
- Calls `getAllStudentPercentageOverrides()` to get all overrides
- Adds `teacherPercentage` field to each student object in the response

### Frontend Changes (teacherPortal.html)

#### UI Sections Modified/Added

1. **Locked Earnings Display** (Lines 447-472)
   - Replaced the old "Adjusted Totals" section
   - Shows three locked earning values:
     - 💎 Locked Unpaid Earned
     - 💎 Locked Due Now Earned
     - 💎 Total Locked Earnings
   - Includes "Update My Earnings" button

2. **Default Percentage Section** (Lines 474-490)
   - Renamed from "Percentage Adjustment"
   - Has input for default percentage
   - Two buttons:
     - 💾 Save Default (saves the default percentage)
     - 🔄 Apply to All Students (applies default to all students at once)

3. **Student List Items** (Lines 743-749)
   - Each student now has a percentage control:
     - Input field showing their current percentage (or "Default" placeholder)
     - 💾 Save button to save that specific student's percentage

4. **Info Box** (Lines 421-429)
   - Updated to explain the new locked earnings system
   - Explains per-student percentages

#### JavaScript Functions Added/Modified

1. **`loadDashboard()`** (Lines 636-673)
   - Now calls `getTeacherEarningsHistory()` to load and display locked earnings on login

2. **`renderStudentsList()`** (Lines 716-760)
   - Adds percentage input and save button for each student
   - Displays existing percentage override if set

3. **`saveStudentPercentage(studentEmail, index)`** (Lines 873-907)
   - Saves the percentage for a specific student
   - Validates input (0-100)
   - Updates student object in memory
   - Shows success/error message

4. **Button Event Handlers:**
   - **btnSaveDefault** (Lines 827-841): Saves default percentage
   - **btnApplyToAll** (Lines 843-871): Applies default to all students (with confirmation)
   - **btnUpdateEarnings** (Lines 909-947): Updates locked earnings by checking for new student commissions

---

## User Workflow

### For Teachers

#### Setting Up Percentages

1. **Set a Default Percentage:**
   - Enter your preferred default percentage (e.g., 10%)
   - Click "💾 Save Default"

2. **Apply Default to All Students (Optional):**
   - Enter the percentage you want
   - Click "🔄 Apply to All Students"
   - Confirm the action
   - All students will now have this percentage

3. **Set Individual Student Percentages:**
   - Scroll to any student in the list
   - Find the "Your %" field under their commission data
   - Enter a specific percentage for that student
   - Click "💾 Save"
   - This overrides the default for that specific student

#### Tracking Earnings

1. **View Current Locked Earnings:**
   - Log into the Teacher Portal
   - The "💰 Your Locked Earnings" section shows your cumulative earnings
   - These values won't decrease when students get paid

2. **Check for New Earnings:**
   - Click "🔄 Update My Earnings (Check for New Student Commissions)"
   - The system calculates any NEW student earnings since your last check
   - Your percentage is applied to these new earnings
   - They're added to your locked totals
   - A message shows how much new earnings were added

3. **Understanding the Numbers:**
   - **Top Cards:** Show 100% raw student totals (for transparency)
   - **Locked Earnings:** Show YOUR cumulative earnings (the actual amount you've earned)
   - **Student List:** Shows 30-day amounts for each student with your percentage control

---

## Example Scenario

### Scenario: Teacher with Two Students

**Setup:**
- Teacher "John" has a default percentage of 10%
- Student A has no override (uses default 10%)
- Student B has an override of 15%

**Day 1:**
- Student A earns $1000 unpaid commission
- Student B earns $500 unpaid commission
- Teacher clicks "Update My Earnings"
- Result:
  - From Student A: $1000 × 10% = $100
  - From Student B: $500 × 15% = $75
  - Total Locked Unpaid Earned: $175

**Day 2:**
- Student A gets paid $500 (their unpaid drops to $500)
- Student B earns another $300 (their unpaid is now $800)
- Teacher clicks "Update My Earnings"
- Result:
  - From Student A: $0 (they decreased, so no new earnings)
  - From Student B: $300 × 15% = $45 (only the INCREASE)
  - Total Locked Unpaid Earned: $175 + $45 = **$220**
  - ✅ Teacher's earnings didn't decrease when Student A got paid!

**Day 3:**
- Student A earns $200 more (their unpaid is now $700)
- Teacher clicks "Update My Earnings"
- Result:
  - From Student A: $200 × 10% = $20
  - From Student B: $0 (no change)
  - Total Locked Unpaid Earned: $220 + $20 = **$240**

---

## Admin Features (Future)

The system includes infrastructure for admin management:

1. **`recordTeacherPayout(teacherEmail, amount)`**: To record when teachers are paid
2. **`resetTeacherEarnings(teacherEmail)`**: To reset a teacher's earnings for corrections

These can be integrated into an admin panel in the future.

---

## Data Integrity

### Safeguards

1. **Only Increases Count**: The system only adds earnings when student amounts INCREASE, never when they decrease
2. **Locked Storage**: Once earnings are added, they're stored persistently and don't recalculate dynamically
3. **Per-Student Tracking**: Each student's last known amount is tracked separately to detect changes accurately
4. **Validation**: All percentage inputs are validated (0-100 range)
5. **Cache Clearing**: When percentages change, caches are cleared to ensure fresh data

### Edge Cases Handled

1. **New Students**: Start with no tracking; their full amount counts as "new" on first update
2. **Student Removed**: Their tracking remains but won't affect future calculations
3. **Percentage Changes**: Only affect NEW earnings going forward, not historical earnings
4. **Multiple Updates**: Idempotent - running update multiple times without student changes won't add duplicate earnings

---

## Testing Recommendations

### Manual Test Cases

1. **Basic Locked Earnings:**
   - Add a student
   - Update earnings (should add their full amount × your %)
   - Simulate the student getting paid (admin manually reduces their API amounts)
   - Update earnings again (should NOT decrease)
   - ✅ Expected: Locked earnings remain the same

2. **Per-Student Percentages:**
   - Set different percentages for different students
   - Update earnings
   - ✅ Expected: Each student's contribution is calculated with their specific percentage

3. **Apply to All:**
   - Set various individual percentages
   - Use "Apply to All" with a new percentage
   - Reload the portal
   - ✅ Expected: All students now show the new percentage

4. **Incremental Earnings:**
   - Update earnings
   - Wait for students to earn more commissions
   - Update earnings again
   - ✅ Expected: Only the NEW earnings are added to locked totals

---

## Files Modified

1. **Code.js**: Lines 4048-4339 (new functions), Lines 4635-4726 (modified function)
2. **teacherPortal.html**: Multiple sections updated (UI and JavaScript)

---

## Migration Notes

### For Existing Teachers

- Existing teachers start with $0 locked earnings
- Their first "Update My Earnings" will capture ALL current student unpaid amounts
- This is the correct baseline to start tracking from

### Backward Compatibility

- All existing teacher portal functionality remains intact
- The default percentage system still works as before
- Student list displays remain compatible

---

## Summary

This implementation solves both critical issues:

1. ✅ **Teacher earnings are now locked in** and won't decrease when students get paid
2. ✅ **Teachers can set individual percentages** for each student

The system is:
- **Persistent**: Uses PropertiesService for storage
- **Accurate**: Only tracks increases, not decreases
- **Flexible**: Supports per-student overrides and default percentages
- **User-Friendly**: Clear UI with helpful explanations
- **Scalable**: Can handle many students per teacher

Teachers now have full control over their commission structure while maintaining accurate, locked-in earnings tracking.

