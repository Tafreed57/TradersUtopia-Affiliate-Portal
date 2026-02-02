# README_PROVIDER_VISIBILITY.md

## Provider Visibility Rules (IMPORTANT)

This project integrates with a third-party provider to fetch affiliate/referral data. This integration is disclosed in our public-facing FAQ and Terms/Conditions.

---

## What Must NOT Appear in User-Facing UI or Frontend Code

- **Provider name** (e.g., "Rewardful")
- **"Rewardful API"** wording
- **Provider endpoint URLs** (e.g., `api.getrewardful.com` domains)
- **Raw provider JSON responses**
- **Provider-specific field names** if they are printed/logged to users
- **Any debug output** that reveals provider details to non-admin users

---

## What IS Allowed

### Neutral wording in the UI:
- "Your Leads"
- "Track your referral leads"
- "Fetching lead data…"
- "Updated at …"

### Backend server-side usage of provider API
- All provider API calls are made server-side in `Code.js`
- Server-side logs may contain provider information (for debugging by admins)

### Admin-only debugging
- Debug functions (`debugReferralData`, `clearReferralData`) are protected by `isAdmin_()` check
- Debug output is only shown to admins, never to regular users

---

## Architecture Requirements

### Server-Side Only API Calls
- All provider API calls must happen server-side (Apps Script `UrlFetchApp`)
- Frontend must **NEVER** call external provider endpoints directly
- Frontend only uses `google.script.run` to call server-side functions

### Sanitized Data Only to Frontend
Frontend must only receive minimal sanitized data:

| Field | Description |
|-------|-------------|
| `success` | Boolean success indicator |
| `totalLeads` | Total lead count |
| `previousCount` | Previous count (for delta calculation) |
| `deltaSinceLastFetch` | Change since last check |
| `lastFetchedAt` | Timestamp of last update |
| `fromCache` | Whether data is from cache |
| `leads` | Array of sanitized lead objects |

### Sanitized Lead Object Format
Each lead in the `leads` array contains only:
- `id` - Truncated (last 6 chars only)
- `state` - Normalized to "lead"
- `createdAt` - First click timestamp
- `becameLeadAt` - Lead conversion timestamp
- `becameConversionAt` - Conversion timestamp (or null)

**Explicitly excluded:**
- Full referral IDs
- Customer names
- Customer emails
- Affiliate IDs
- Provider-specific field names
- Raw API responses
- Debug information

---

## Debugging Rules

### Debug tools must be admin-only
- Use `isAdmin_()` check at the start of any debug function
- Return generic error for non-admin users

### Do not expose provider details to users
- Generic error messages: "Failed to fetch lead data. Please try again later."
- Generic warnings: "Using cached data. Refresh may be temporarily unavailable."
- Never show raw API errors or provider names in UI

### Server-side logging is acceptable
- `Logger.log()` statements in `Code.js` are server-side only
- These logs are only visible in the Apps Script execution log (admin access)

---

## Verification Checklist

When modifying lead/referral code, verify:

1. **No provider strings in frontend (HTML/JS)**
   ```bash
   # Search for provider mentions in frontend files
   grep -ri "rewardful\|getrewardful" *.html
   # Should return: No matches found
   ```

2. **No provider endpoints called from browser**
   - All API calls use `google.script.run` only
   - Network tab shows only Google Apps Script requests

3. **UI remains provider-neutral**
   - No mention of "Rewardful" in visible text
   - No mention of "Rewardful API" in tooltips/loading states
   - Error messages are generic

4. **Debug functions are protected**
   - All debug functions start with `if (!isAdmin_()) { return error; }`

---

## Disclosure Notice

While the UI remains provider-neutral, our public FAQ and Terms of Service properly disclose the use of third-party services for affiliate/referral tracking. This README enforces **implementation privacy**, not secrecy.

---

## Files Affected by This Policy

| File | Notes |
|------|-------|
| `attendenceportal.html` | Student Dashboard - leads section UI |
| `Code.js` | Server-side API calls, data sanitization |
| `CommissionLookup.Html` | Commission Portal - may reference affiliate data |

---

## Change Log

- **2026-01-20**: Initial creation of provider visibility guidelines
  - Removed all "Rewardful" mentions from `attendenceportal.html`
  - Removed `affiliateId` and `debugInfo` from frontend-facing returns
  - Sanitized error/warning messages
  - Added this documentation file

---

*For questions about this policy, contact the development team.*
