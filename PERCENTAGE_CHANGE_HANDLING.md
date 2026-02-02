# How the System Handles Percentage Changes

## Summary

The locked earnings system correctly handles per-student percentage changes. When you change a student's percentage, it **only affects FUTURE earnings**, not past earnings already locked.

## How It Works

### The Key Logic (Code.js Lines 4230-4250)

```javascript
// 1. Calculate NEW earnings (only increases)
var unpaidIncrease = Math.max(0, currentUnpaid - lastTracked.unpaid);
var dueNowIncrease = Math.max(0, currentDueNow - lastTracked.dueNow);

if (unpaidIncrease > 0 || dueNowIncrease > 0) {
  // 2. Get the CURRENT percentage for this student
  var studentPercentage = student.teacherPercentage || defaultPercentage;
  var multiplier = studentPercentage / 100;
  
  // 3. Apply CURRENT percentage to the NEW increase only
  newEarningsUnpaid += unpaidIncrease * multiplier;
  newEarningsDueNow += dueNowIncrease * multiplier;
}

// 4. ALWAYS update tracking (preserves baseline for next calculation)
history.studentTracking[studentEmail] = {
  unpaid: currentUnpaid,
  dueNow: currentDueNow
};
```

### Why This Works Correctly

1. **Tracks increases only**: Only NEW earnings (increases from last tracked amount) are calculated
2. **Uses current percentage**: The percentage used is whatever is set at the TIME of the update
3. **Past earnings untouched**: Already-locked earnings are never recalculated
4. **Tracking always updates**: The baseline is always current, ready for the next change

## Example Scenarios

### Scenario 1: Changing Percentage Mid-Way

**Setup:**
- Student has $100
- Teacher percentage: 10%

**Step 1: Initial Update**
- Current: $100, Tracked: $0
- Increase: $100
- Percentage: 10%
- **Earn: $10**, Track: $100
- **Locked Total: $10**

**Step 2: Change Percentage to 20%**
- Teacher saves 20% for this student
- Locked earnings: Still $10 (unchanged)

**Step 3: Student Earns $50 More ($150 total)**
- Current: $150, Tracked: $100
- Increase: $50
- Percentage: **20%** (uses NEW percentage)
- **Earn: $10** ($50 × 20%)
- Track: $150
- **Locked Total: $20** ($10 old + $10 new)

**Result:** ✅ Old $100 earned at 10%, new $50 earned at 20%

### Scenario 2: Multiple Percentage Changes

**Setup:**
- Student at $100, percentage 10%

**Updates:**
1. Student: $100 → Earn: $10 @ 10% → Total: $10
2. Change to 15%
3. Student: $200 → Earn: $15 @ 15% ($100 increase) → Total: $25
4. Change to 20%
5. Student: $300 → Earn: $20 @ 20% ($100 increase) → Total: $45
6. Change to 25%
7. Student: $400 → Earn: $25 @ 25% ($100 increase) → Total: $70

**Result:** ✅ Each increase uses the percentage set at that moment

### Scenario 3: Percentage Change During Student Payout

**Setup:**
- Student at $100, percentage 10%

**Steps:**
1. Update → Earn: $10 @ 10%, Track: $100
2. Student paid $50 → Now has $50
3. Change percentage to 20%
4. Update → No increase ($50 < $100), Track: $50 (baseline updated)
5. Student earns $100 more → Now has $150
6. Update → Increase: $100, Earn: $20 @ **20%**, Track: $150
7. **Total: $30** ($10 old + $20 new)

**Result:** ✅ Payout doesn't break tracking, new percentage applies to new earnings

### Scenario 4: Different Percentages for Different Students

**Setup:**
- Student A: 10%
- Student B: 15%
- Student C: 20%
- All start at $100

**Initial Update:**
- Student A: $10 (10% of $100)
- Student B: $15 (15% of $100)
- Student C: $20 (20% of $100)
- **Total: $45**

**Change Student B to 25%**

**All Earn $50 More (now at $150):**
- Student A: $5 more (10% of $50) → Total from A: $15
- Student B: $12.50 more (**25%** of $50) → Total from B: $27.50
- Student C: $10 more (20% of $50) → Total from C: $30
- **Total: $72.50**

**Result:** ✅ Each student uses their own percentage independently

## Key Safeguards

### 1. Only Increases Count
```javascript
var unpaidIncrease = Math.max(0, currentUnpaid - lastTracked.unpaid);
```
- `Math.max(0, ...)` ensures decreases are treated as 0
- No negative earnings
- Payouts don't reduce locked earnings

### 2. Current Percentage Used
```javascript
var studentPercentage = student.teacherPercentage || defaultPercentage;
```
- Fetches percentage from student data at runtime
- Always uses the most current saved percentage
- Past earnings never recalculated

### 3. Tracking Always Updates
```javascript
// Outside the "if" block - ALWAYS executes
history.studentTracking[studentEmail] = {
  unpaid: currentUnpaid,
  dueNow: currentDueNow
};
```
- Updates even on decreases (payouts)
- Updates even when percentage changes
- Ensures next calculation has correct baseline

### 4. History Always Saved
```javascript
// Outside the "if (newEarnings > 0)" block
saveTeacherEarningsHistory(teacherEmail, history);
```
- Saves tracking updates even with no new earnings
- Ensures percentage changes don't break tracking
- Persistent across all scenarios

## What CANNOT Happen

❌ **Past earnings recalculated when percentage changes**
- Locked earnings are cumulative additions only
- Once locked, they never change

❌ **Wrong percentage applied to new earnings**
- System always fetches current percentage at update time
- No cached or stale percentages

❌ **Lost tracking after percentage change**
- Tracking updates regardless of percentage
- Baseline preserved across all changes

❌ **Duplicate earnings from same amount**
- Tracking prevents re-earning from same money
- Even with percentage changes

❌ **Negative earnings from decreases**
- `Math.max(0, ...)` prevents this
- Decreases are simply ignored for earnings

## User Workflow for Percentage Changes

### Safe Workflow:

1. **Change the percentage** for a student (e.g., 10% → 20%)
2. Click "Save" to store the new percentage
3. **That's it!** The system handles the rest automatically:
   - Next "Update My Earnings" will use the new 20%
   - Only applies to NEW commissions going forward
   - Past earnings stay locked at the old percentage

### Example:

**Day 1:**
- Student at $100, set to 10%
- Update → Lock $10

**Day 5:**
- Change to 20%
- Student still at $100
- Update → No new earnings (no increase)
- Locked: Still $10

**Day 10:**
- Student earned $50 more → Now $150
- Update → Earn $10 more ($50 × 20%)
- Locked: $20 total

**Understanding:**
- The first $100 forever "earned" you $10 (at 10%)
- The new $50 "earns" you $10 (at 20%)
- Total: $20 ✅

## Reset Button Removed

The Reset button has been removed because:
- ❌ It cleared past earnings (causing loss)
- ❌ It didn't help with percentage changes
- ❌ It caused confusion
- ✅ The system handles percentage changes automatically
- ✅ No manual reset needed

## Testing Recommendations

**Before deploying, test:**

1. Set student to 10%, add earnings
2. Change to 20%
3. Add more earnings
4. Verify: Total = (first amount × 10%) + (new amount × 20%)

**Example:**
- $100 @ 10% = $10
- $50 more @ 20% = $10
- Total should be $20 ✅

## Files Modified

1. **teacherPortal.html**: Removed Reset button and handler
2. **Code.js**: Already had correct percentage handling (no changes needed)

## Conclusion

The system is **designed from the ground up** to handle percentage changes correctly:

- ✅ Each earning "snapshot" uses the percentage at that moment
- ✅ Past earnings are immutable (locked forever)
- ✅ Future earnings use current percentage
- ✅ Tracking is independent of percentages
- ✅ No manual intervention or reset needed

**Teachers can safely change student percentages at any time without worrying about breaking anything.**

