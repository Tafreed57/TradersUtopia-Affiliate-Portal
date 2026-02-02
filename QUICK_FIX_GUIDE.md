# Quick Fix Guide for momo50%@gmail.com

## The Problem
- **Displaying**: $1,156.78 CAD (100% of commissions)
- **Should Display**: ~$578.39 CAD (50% of commissions)
- **Reason**: Tracking baseline was initialized incorrectly

## Quick Fix (5 Minutes)

### Step 1: Access Admin Panel
1. Go to: Commission Lookup page
2. Enter your admin email: `tafreed57@gmail.com` OR `shehrozeps9721@gmail.com`
3. Click "Lookup Affiliate"
4. Admin panel will appear

### Step 2: Lookup the Affected Affiliate
1. In the "Admin Panel" section, find the field: "Lookup Any Affiliate Email"
2. Enter: `momo50%@gmail.com`
3. Click "Lookup & Manage"
4. Wait for data to load

### Step 3: Diagnose the Issue
1. Scroll down to find: **"🔍 Email Percentage Diagnostics"** (blue section)
2. Click: **"🔍 Diagnose Current Affiliate"**
3. Review the diagnostic output - should show:
   ```
   Status: MISMATCH
   Expected Percentage: 50%
   Tracking Percentage: null (or different value)
   ```

### Step 4: Apply the Fix
1. Click: **"🔧 Fix Current Affiliate"**
2. Confirm when prompted
3. Wait 2-3 seconds
4. Page will automatically refresh and re-lookup the affiliate

### Step 5: Verify the Fix
After the page refreshes, check:
- ✅ Unpaid Amount: Should now show **~$578.39 CAD** (50% of $1,156.78)
- ✅ Due Now: Should show **$0.00 CAD** (50% of $0.00)
- ✅ Commission Details table displays corrected values

## If You Want to Fix All Affiliates

If you discover multiple affiliates have this issue:

1. Go to the "Email Percentage Diagnostics" section
2. Click: **"📊 Audit All Affiliates"**
3. Review the list of affiliates with issues
4. Click: **"🔧 Fix All Mismatches"**
5. Confirm the action
6. Wait for completion
7. Review the detailed results

## What the Fix Does

1. **Deletes** the incorrect tracking data for the affiliate
2. **Forces reinitialization** on next lookup
3. **Correctly applies** the 50% baseline from the email
4. **Maintains** all historical tracking going forward

## Important Notes

- ✅ **Safe to use** - Only affects tracking, not actual API data
- ✅ **Reversible** - If something goes wrong, you can always reset tracking again
- ✅ **No data loss** - Historical payment records are unchanged
- ⚠️ **One-time fix** - After fixing, the system will track correctly going forward

## Troubleshooting

**If the fix doesn't work:**
1. Clear your browser cache
2. Log out and log back in as admin
3. Try the fix again

**If you see errors:**
1. Check that you're logged in as an admin email
2. Verify the affiliate email is spelled correctly
3. Check browser console (F12) for detailed error messages

**If values are still wrong after fix:**
1. Run "Diagnose Current Affiliate" again
2. Check if tracking percentage now shows "50%"
3. If still showing as MISMATCH, contact technical support

## Contact

If you need help or encounter issues, refer to `DIAGNOSTIC_REPORT.md` for comprehensive technical documentation.

---

**Last Updated**: November 18, 2025

