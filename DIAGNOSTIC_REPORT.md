# Commission Percentage Diagnostic Report

## Problem Identified

The issue with **momo50%@gmail.com** displaying an incorrect "Unpaid Amount" of $1,156.78 CAD instead of ~$578.39 CAD (50%) is due to a **tracking baseline mismatch**.

### Root Cause

Your system uses an **incremental tracking system** that works as follows:

1. **First Lookup**: When an affiliate is looked up for the first time, the system:
   - Extracts the percentage from their email (e.g., "50" from "momo50%@gmail.com")
   - Applies this percentage to the current API values as a **baseline**
   - Stores this baseline in tracking data
   - Example: If API says $1,156.78 and email has 50%, the baseline is set to $578.39

2. **Subsequent Lookups**: The system:
   - Calculates the **delta** (change) in API values since last lookup
   - Adds this delta to the previously displayed value
   - This ensures affiliates only see their percentage of NEW commissions

### The Problem

The tracking data for `momo50%@gmail.com` was initialized **before** the percentage feature was properly implemented OR the baseline was set incorrectly. This means:
- Expected percentage from email: **50%**
- Tracking percentage stored: **null** (100%)
- Result: User sees 100% of commissions instead of 50%

---

## Solution Implemented

I've added comprehensive diagnostic and fix tools to your admin panel.

### New Functions Added to `Code.js`

1. **`diagnoseAffiliatePercentage(email)`**
   - Checks if an affiliate's tracking data matches their email percentage
   - Returns detailed diagnostic information
   - Shows expected vs actual percentages
   - Calculates what the correct values should be

2. **`fixAffiliatePercentage(email)`**
   - Resets tracking data for a specific affiliate
   - Forces reinitialization with correct percentage on next lookup
   - Safe to use - only affects the specified affiliate

3. **`auditAllAffiliatePercentages()`**
   - Scans ALL affiliates with tracking data
   - Identifies percentage mismatches
   - Returns summary statistics and detailed list of issues

4. **`fixAllAffiliatePercentages()`**
   - Automatically fixes ALL affiliates with mismatches
   - Resets their tracking data
   - Provides detailed results for each affiliate

### New UI Added to `CommissionLookup.Html`

A new **"Email Percentage Diagnostics"** section in the admin panel with four buttons:

1. **🔍 Diagnose Current Affiliate**
   - Analyzes the currently looked-up affiliate
   - Shows detailed diagnostic information
   - Displays expected vs actual values

2. **🔧 Fix Current Affiliate**
   - Fixes the currently looked-up affiliate
   - Resets their tracking baseline
   - Auto-refreshes to show corrected values

3. **📊 Audit All Affiliates**
   - Scans entire database
   - Shows summary: total affiliates, correct count, mismatch count
   - Lists all affiliates with issues

4. **🔧 Fix All Mismatches**
   - Automatically fixes all identified issues
   - Shows detailed results for each fix
   - Comprehensive summary of actions taken

---

## How to Fix momo50%@gmail.com (Step-by-Step)

### Option A: Fix Single Affiliate (Recommended for Testing)

1. **Log in as admin** (use tafreed57@gmail.com or shehrozeps9721@gmail.com)
2. **Access the Commission Lookup page**
3. **Admin panel appears automatically**
4. In the "Admin Panel" section, enter: `momo50%@gmail.com`
5. Click **"Lookup & Manage"**
6. Scroll down to the **"Email Percentage Diagnostics"** section
7. Click **"🔍 Diagnose Current Affiliate"**
8. Review the diagnostic results:
   - Should show "Status: MISMATCH"
   - Expected Percentage: 50%
   - Tracking Percentage: null or different value
   - Shows what the correct values should be
9. Click **"🔧 Fix Current Affiliate"**
10. Confirm the action
11. The system will:
    - Reset the tracking data
    - Automatically refresh and re-lookup the affiliate
    - Apply the correct 50% baseline
12. **Verify**: The unpaid amount should now show ~$578.39 (50% of $1,156.78)

### Option B: Fix All Affiliates (Comprehensive Solution)

1. **Log in as admin**
2. **Access the Commission Lookup page**
3. In the "Admin Panel" section, enter any admin email to activate admin mode
4. Click **"Lookup & Manage"**
5. Scroll to **"Email Percentage Diagnostics"**
6. Click **"📊 Audit All Affiliates"**
7. Review the audit results:
   - Total affiliates tracked
   - Number of mismatches found
   - List of all affiliates with issues
8. Click **"🔧 Fix All Mismatches"**
9. Confirm the action (will show warning)
10. The system will:
    - Automatically fix all affiliates with percentage mismatches
    - Show detailed results for each affiliate
    - Provide summary statistics

---

## Technical Details

### Email Percentage Pattern Matching

The system uses regex pattern matching to extract percentages from emails:

```javascript
Pattern: /(\d+)%@/
Examples:
  - momo50%@gmail.com → 50%
  - user25%@example.com → 25%
  - tafreed100%@gmail.com → 100%
  - regular@email.com → null (100%)
```

### Incremental Tracking Storage

Tracking data is stored in Google Apps Script Properties Service:

```javascript
Key format: INCREMENTAL_TRACKING_{email_sanitized}
Data structure:
{
  isInitialized: true,
  emailBaselinePercentage: 50,  // Extracted from email
  lastApiUnpaid: 1156.78,        // Last API value (100%)
  lastDisplayedUnpaid: 578.39,   // Last displayed value (50%)
  lastApiDueNow: 0,
  lastDisplayedDueNow: 0,
  lastApiTotalPaid: 478.36,
  lastDisplayedTotalPaid: 478.36,
  initialApiUnpaid: 1156.78,
  initialApiDueNow: 0,
  initialApiTotalPaid: 478.36,
  lastUpdateTime: "2025-11-18T..."
}
```

### How Percentage Application Works

**First Lookup (Baseline Initialization):**
```
API Value: $1,156.78
Email: momo50%@gmail.com
Extracted Percentage: 50%
Baseline Multiplier: 0.50
Displayed Value: $1,156.78 × 0.50 = $578.39
```

**Subsequent Lookups (Incremental Changes):**
```
Previous API: $1,156.78
Current API: $1,300.00
Delta: +$143.22

User sees: $578.39 + $143.22 = $721.61
(Not 50% of $1,300, but 50% of the INCREASE added to previous display)
```

This ensures that affiliates see their percentage applied to their **initial baseline** plus their **percentage of all subsequent changes**.

---

## Additional Notes

### Admin Percentage Multiplier vs Email Percentage

These are **two different features** that work together:

1. **Email Percentage** (from email address):
   - Sets the initial baseline on first lookup
   - Example: momo50%@gmail.com starts at 50% of API values

2. **Admin Percentage Multiplier** (manual override):
   - Applies to **incremental changes only**
   - Does NOT affect the baseline
   - Example: If set to 30%, user sees only 30% of NEW commissions
   - Useful for temporary adjustments without changing email

### When to Use Each Tool

- **Diagnose Current Affiliate**: When you suspect a single affiliate has issues
- **Fix Current Affiliate**: To fix a single known issue
- **Audit All Affiliates**: To check if there are system-wide issues after an update
- **Fix All Mismatches**: After major system changes or migrations

### Preventive Measures

To prevent this issue in the future:

1. Always test new affiliates with percentage emails immediately after creation
2. Run an audit after any system updates that affect tracking
3. Consider adding a validation check that alerts when tracking percentage doesn't match email percentage

---

## Verification Checklist

After fixing momo50%@gmail.com:

- [ ] Unpaid Amount shows ~$578.39 (50% of $1,156.78)
- [ ] Due Now shows $0.00 (50% of $0.00)
- [ ] Total Paid shows $478.36 (unchanged)
- [ ] Status shows "active"
- [ ] Diagnostic shows "Status: CORRECT"
- [ ] Tracking percentage matches email percentage (50%)

---

## Support

If you encounter any issues:

1. Check the browser console (F12) for error messages
2. Review the diagnostic output for detailed information
3. Verify admin access is working (check email is in ADMIN_EMAILS)
4. Try the "Reset ALL Tracking Data" button if problems persist (⚠️ This resets EVERYONE)

---

**Created**: November 18, 2025
**Version**: 1.0
**Status**: Ready for Testing

