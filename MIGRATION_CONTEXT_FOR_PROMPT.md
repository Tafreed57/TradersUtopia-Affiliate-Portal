# Traders Utopia Portal — Full Context for Migration / Modularization Prompt

**Purpose:** Feed this document to ChatGPT (or another LLM) to generate a **single, specialized, step-by-step prompt** that you will then give to Cursor. That prompt should instruct the Cursor agent how to migrate and modularize this codebase without overlooking anything, in a logical order, and as quickly as possible.

**Current state:** ~30,000+ lines across one monolithic backend file and several large HTML frontends. Code is "super sloppy" and violates good computer-science/modular design. Goal: modularize, clean up, and (optionally) migrate off Google Apps Script to Vercel + database.

---

## 1. Project Overview

- **Name:** Traders Utopia Portal
- **What it is:** A multi-role web app for affiliates/students, teachers, and admins. Handles login, account requests, password setup, attendance tracking, teacher–student assignment, referral/leads data from Rewardful, commission lookup, and admin tools.
- **Current host:** Google Apps Script (single GAS web app, one `Code.js` backend, multiple HTML files served via `doGet` routing).
- **Target (recommended):** Vercel (frontend + serverless API) + managed database (e.g. Vercel Postgres, Supabase). Alternative: AWS if long-running jobs or strict compliance are required later.

---

## 2. Current Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Google Apps Script (single `Code.js` file) |
| Frontend | Vanilla HTML + CSS + JS, no framework; each "page" is a separate HTML file |
| Storage | `PropertiesService.getScriptProperties()` (key-value), `CacheService.getScriptCache()` (sessions + some API cache) |
| Auth | Custom: password hash + salt in Properties, session token in Cache + Properties |
| External API | Rewardful (https://api.getrewardful.com/v1) for affiliates, referrals, commissions |
| Routing | URL param `?page=...`; `doGet(e)` switches on `e.parameter.page` and serves one HTML file per page |

---

## 3. File Inventory (Approximate)

| File | Approx. Lines | Purpose |
|------|----------------|---------|
| **Code.js** | ~15,800 | Entire backend: routing, auth, attendance, teacher–student links, Rewardful sync, commission logic, admin APIs, account request/set-password, diagnostics. **~280 functions.** |
| **attendenceportal.html** | ~3,450 | Student dashboard: attendance UI, teacher selection, referrals/leads table, admin-only “user database search” and “full student dashboard” viewer, legacy/orphan account cleanup UI. |
| **CommissionLookup.Html** | ~1,000+ | Commission lookup UI; admin pending-account approval/rejection. |
| **teacherPortal.html** | ~1,000+ | Teacher portal: students list, earnings, locked amounts, percentage. |
| **SetPassword.html** | ~1,170 | Request access + set password + “check status” popup; back-to-login uses `getWebAppUrl()`. |
| **home.html** | ~650+ | Post-login dashboard: links to Commission, Teacher Portal, Student Dashboard; logout. |
| **Login.html** | ~600+ | Unified login form; session token stored in `localStorage` under `tradersutopia_session_token`. |
| **style.html** | (partial) | Shared styles (if included elsewhere). |
| **testpage.html** | Small | Test/debug page. |
| **Various .md** | — | README_AUTH.md, README_SESSION_NAV.md, README_PROVIDER_VISIBILITY.md, QUICK_DEPLOYMENT_GUIDE.md, plus many fix/audit docs (ATTENDANCE_*, COMMISSION_*, TEACHER_*, etc.). |

**Total codebase:** ~30,000+ lines (backend + frontend). Single backend file is the main maintainability and “sloppy” problem.

---

## 4. URL Routing (doGet)

- **Parameter:** `page` (lowercase, trimmed). Default when missing: `login`.
- **Mapping:**
  - (none) or `login` → Login.html
  - `test` → TestPage (testpage.html)
  - `commission` → CommissionLookup.Html
  - `teacher` → teacherPortal.html
  - `attendance` → attendenceportal.html (Student Dashboard)
  - `setpassword` | `set-password` | `requestaccess` → SetPassword.html
  - `home` → home.html
  - Anything else → “Page Not Found” (rendered by backend).

All HTML is loaded with `HtmlService.createHtmlOutputFromFile(...)`. No bundler; each HTML file is self-contained (inline or local styles/scripts).

---

## 5. Data Layer (Backend)

### 5.1 PropertiesService keys (conceptual “tables”)

- **AFFILIATE_AUTH_{normalized_email}** — Auth record: email, passwordHash, passwordSalt, aliasEmail, rewardfulEmail, lockout, etc. Key normalization: email lowercased, special chars replaced (e.g. `@` → `_AT_`, `.` → `_`).
- **ATTENDANCE_USER_{normalized_email}** — Per-user attendance record: name, email, createdDate, teacherEmail, isTeacher, aliasEmail, internalEmail, etc.
- **ATTENDANCE_{?}** — Other attendance-related keys (e.g. date-based records); exact key patterns used in code for cleanup/orphan delete.
- **TEACHER_LINKS_{normalized_teacher_email}** — **Canonical** teacher–student links (single source of truth). Value: list of students with status (ACTIVE/REMOVED). Replaces legacy TEACHER_STUDENTS_ for reads; writes keep both in sync.
- **TEACHER_STUDENTS_{normalized_teacher_email}** — Legacy teacher–student list; still written for backward compatibility.
- **SESSION_{token}** — Session persistence (fallback when not in cache).
- **REFERRAL_DATA_{email}** — Metadata for referral/leads (e.g. lastKnownLeadCount, lastFetchedAt); actual lead lists cached in CacheService.

Normalization for storage keys often: `email.toLowerCase().replace('@','_AT_').replace(/[^a-zA-Z0-9_]/g,'_')` or similar (varies slightly by function). Auth key uses `AFFILIATE_AUTH_` prefix and a different normalize (e.g. `replace(/[@.]/g,'_')` in some places).

### 5.2 CacheService

- Sessions: key `SESSION_{token}`, value = session payload.
- API cache: e.g. Rewardful responses (keyed by request).
- Referral/leads cache: larger payloads for “all leads” per user (CacheService used because Properties has size limits).

### 5.3 Important backend functions (representative)

- **doGet(e)** — Entry; routes by `page` and serves HTML.
- **getWebAppUrl()** — Returns `ScriptApp.getService().getUrl()` (used by SetPassword “back to login” and similar).
- **Auth:** validateSessionToken, validateSession_, isAdmin_, isAdminAny_, getAuthRecord_, saveAuthRecord_, getAuthKey_, normalizeAuthEmail_, findAuthRecordByAliasOrInternal_; login (password check), logout, lockout logic.
- **Account lifecycle:** requestAccountAccess, checkAccountStatus, getRequestStatus, setApprovedAccountPassword, admin approval/reject (adminApproveAccount, adminRejectAccount, adminGetPendingAccounts).
- **Attendance:** getAttendanceData, setAttendanceData, recordAttendance, getAllAttendanceUsers, searchAttendanceUsers, getAttendanceStats, deleteAttendanceUser, adminGetStudentDashboard, adminUpdateAliasEmail, adminUpdateInternalEmail, adminAuditLegacyAccounts, adminDeleteOrphanedLegacy, adminCleanupAllOrphanedLegacy, etc. Teacher assignment: setTeacherForAttendanceUser, getTeacherData, linkStudentToTeacher, unlinkStudentFromTeacher, listStudentsForTeacher, reconcileTeacherStudentLinks.
- **Rewardful:** BASE_URL = 'https://api.getrewardful.com/v1'; fetchWithRetry_, fetchAllReferralsFromRewardful_, getReferralData, prepareLeadsForDisplay_, isVisitor_, isLead_, isConversion_; rate limiting (RATE_LIMIT_DELAY_MS, 429 backoff). Commission/affiliate sync logic in same file.
- **Commission:** Commission lookup, teacher earnings, locked amounts, percentage handling; many functions intertwined with Rewardful and teacher-student data.
- **Admin:** ADMIN_EMAILS array; isAdmin_; admin-only endpoints for user DB, student dashboard, alias/internal email updates, legacy cleanup.

There are **~280 functions** in Code.js; the above is a minimal “map” for the prompt generator.

---

## 6. Auth and Session (Summary)

- **Login:** User submits email + password. Backend checks AFFILIATE_AUTH_ record, verifies hash with salt, applies lockout (e.g. 5 failures = 15 min lockout). On success: create session, store in Cache + Properties, return session token.
- **Session token:** Stored client-side in `localStorage` under key `tradersutopia_session_token`. Sent to server on each `google.script.run` that needs auth (e.g. validateSessionToken(token)).
- **Teachers:** Determined by Rewardful “name” check and/or TEACHER_OVERRIDE_EMAILS. Teacher-only pages (e.g. Teacher Portal) validate session and teacher status.
- **Admins:** ADMIN_EMAILS hardcoded list; isAdmin_() / isAdminAny_() used for admin-only APIs and UI branches.

---

## 7. Frontend–Backend Contract

- **Mechanism:** All server calls from HTML go through `google.script.run.withSuccessHandler(...).withFailureHandler(...).functionName(...)`.
- **No REST API:** There is no REST layer; every action is a named server function invoked from the client.
- **Approx. 99 `google.script.run` call sites** across the HTML files (attendenceportal.html has the most, then CommissionLookup, teacherPortal, SetPassword, Login, home, style, testpage).

For migration to Vercel, each such “functionName” becomes an API route or a shared backend module called from API routes; the frontend then uses `fetch()` to hit those routes instead of `google.script.run`.

---

## 8. External Dependency: Rewardful

- **Base URL:** https://api.getrewardful.com/v1
- **Uses:** Affiliates list, affiliate by email, referrals (paginated), commissions. API key stored in Script Properties (e.g. AFFILIATE_API_KEY).
- **Behavior in code:** Pagination with rate limiting (delay between pages, 429 retry with backoff). Referral state: visitor vs lead vs conversion; visitors excluded from “leads” in UI. Caching of referral metadata and lead lists (CacheService) to avoid repeated full fetches.

---

## 9. Major Feature Domains (for modularization)

Group these so the generated prompt can assign “steps” and “modules” without missing areas:

1. **Routing and entry** — doGet, page switch, getWebAppUrl, error/not-found pages.
2. **Auth** — Login, logout, session create/validate, password hash/salt, lockout, getAuthRecord/saveAuthRecord, key normalization.
3. **Account lifecycle** — Request access, check status, set password (approved/token), admin approve/reject, pending list.
4. **Attendance** — User CRUD, attendance records by date, stats, teacher assignment per user, admin “full student dashboard” and alias/internal email updates.
5. **Teacher–student links** — Canonical TEACHER_LINKS_ + legacy TEACHER_STUDENTS_; link/unlink/list; reconciliation job; used by teacher portal and attendance.
6. **Rewardful / referrals** — API client, retry/backoff, fetch referrals, classify visitor/lead/conversion, cache, getReferralData, prepareLeadsForDisplay.
7. **Rewardful / commissions** — Affiliate sync, commission totals, teacher earnings, locked amounts, percentage logic.
8. **Commission lookup UI** — Admin + affiliate commission view; admin pending accounts (calls same account APIs).
9. **Teacher portal** — Students list, earnings, locked amounts, percentage; uses teacher-student and commission data.
10. **Student dashboard (attendenceportal)** — Attendance UI, teacher select, referrals/leads table; admin: user DB search, full student dashboard viewer, legacy/orphan cleanup.
11. **SetPassword flow** — Request form, set password form, check-status popup, redirect to login (getWebAppUrl).
12. **Admin** — ADMIN_EMAILS, isAdmin_, all admin-only endpoints and UI branches.
13. **Legacy/orphan cleanup** — getAllAttendanceUsers (legacy vs migrated vs orphan), adminAuditLegacyAccounts, adminDeleteOrphanedLegacy, adminCleanupAllOrphanedLegacy.

---

## 10. Known Pain Points and Code Quality

- **Single 15k+ line backend file** — Hard to navigate, test, or refactor; no clear module boundaries.
- **Duplicate or inconsistent key normalization** — Different helpers for auth vs attendance vs teacher keys; risk of bugs when keys don’t match.
- **Mixed concerns** — Rewardful, commission, attendance, auth, and admin logic all in one file.
- **No tests** — No automated tests described; regression risk is high when splitting or migrating.
- **Large HTML files** — attendenceportal.html is a single ~3.5k-line file with many inline scripts and styles; hard to maintain and reason about.
- **Google.script.run everywhere** — Many small round-trips; no single “API layer” to replace during migration.
- **Hardcoded config** — ADMIN_EMAILS, TEACHER_OVERRIDE_EMAILS, WEB_APP_URL_FALLBACK, BASE_URL, etc. Should become config/env.
- **Legacy + canonical data** — TEACHER_STUDENTS_ vs TEACHER_LINKS_; orphan legacy cleanup logic; migration must preserve or simplify this.

---

## 11. Migration Target (Vercel + DB)

- **Frontend:** Next.js (or Vite + React) recommended; split current HTML into pages/components; replace `google.script.run` with `fetch('/api/...')`.
- **Backend:** Node.js serverless functions (Vercel API routes) or a small Express app; one route per “domain” or per logical operation.
- **Database:** Replace PropertiesService (and session store) with a single managed DB (e.g. Vercel Postgres, Supabase). Model: users (auth + profile), sessions, attendance records, teacher_student_links, referral_cache or similar; keep Rewardful as source of truth for affiliates/commissions and sync or proxy as needed.
- **Auth:** Keep custom password hash/salt and session token pattern, or move to NextAuth/Supabase Auth; ADMIN_EMAILS and teacher flags can live in DB or env.
- **Rewardful:** Same API; call from serverless/API route with same rate-limiting/retry logic; cache in DB or Redis if needed.
- **Env:** API keys (Rewardful, etc.), DB URL, app URL, admin list (or “admin” role in DB).

---

## 12. What the Specialized Prompt Must Produce

The prompt that you (the user) will get from ChatGPT and feed into Cursor should:

1. **Be a single, self-contained “master” prompt** that the Cursor agent can follow from start to finish.
2. **Define a clear order of work** (e.g. Phase 1: split backend into logical modules without changing behavior; Phase 2: extract config and env; Phase 3: introduce API layer and DB schema; Phase 4: migrate frontend to call API and optionally modernize UI framework; Phase 5: deploy to Vercel and retire GAS). Adjust phases to match “modularize only” vs “full migration.”
3. **List every major area** from Section 9 and assign concrete tasks (e.g. “Create Auth.gs and move all AFFILIATE_AUTH_ and session logic” or “Create /api/auth/login and /api/auth/validate”).
4. **Include file-by-file or module-by-module checklist** so nothing is overlooked (every HTML file, every group of backend functions).
5. **Specify naming and structure** (e.g. backend modules: Auth, Attendance, TeacherLinks, RewardfulReferrals, RewardfulCommissions, Admin, Routing; frontend: pages + components per portal).
6. **Call out risks** (key normalization, legacy vs canonical teacher data, session storage, Rewardful rate limits) and tell the agent to preserve behavior and add minimal logging/tests where possible.
7. **Be concise enough** to use in one Cursor chat, but **complete enough** that the agent doesn’t have to guess; all critical context is either in this document or summarized in the generated prompt.
8. **Optional:** Include a “modularize only on GAS first” path (split Code.js into multiple .gs files, split HTML into smaller partials if GAS allows) so that a full Vercel migration can come later with a cleaner codebase.

---

## 13. One-Line Summary for the Prompt Generator

**“Using the above context, write a single, detailed, step-by-step prompt that I can paste into Cursor to modularize and optionally migrate the Traders Utopia Portal from one 15k-line Google Apps Script backend and several large HTML files to a clean, modular structure (either on GAS first or directly to Vercel + database), without overlooking any feature, data key, or integration (auth, attendance, teacher–student links, Rewardful, commission, admin, SetPassword, legacy cleanup), and in an order that minimizes rework and regression.”**

---

*End of context document.*
