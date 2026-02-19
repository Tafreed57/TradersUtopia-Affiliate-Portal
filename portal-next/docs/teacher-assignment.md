# Teacher–Student Assignment (Request + Approval Workflow)

This document describes the state machine and data rules for teacher–student assignment in the Traders Utopia portal. Assignment changes **never** happen by directly overwriting a student’s teacher; they go through a **request + approval** flow.

## Goal

- **Students**: See current teacher in “My Teacher”, and use “Change Teacher” to **request** a new teacher. The target teacher must **accept** before the change takes effect.
- **Teachers**: See **current students (ACTIVE)** and **pending requests (OPEN)**. They can **Accept** or **Reject** requests, and **Remove** an active student (soft delete).

## Data Model

### TeacherStudentLink (existing)

- `teacherId`, `studentId`, `status` (`ACTIVE` | `REMOVED`), `createdAt`, `updatedAt`, `removedAt`, `removedBy`, `createdBy`, `percentageOverride`.
- **Unique** on `(teacherId, studentId)`.
- **Only one ACTIVE assignment per student** is enforced in application logic: when accepting a request, any existing ACTIVE link for that student is set to REMOVED before creating/activating the new link.

### TeacherChangeRequest (new)

- `id`, `studentId`, `fromTeacherId` (nullable), `toTeacherId`, `status` (`OPEN` | `ACCEPTED` | `REJECTED` | `CANCELLED` | `EXPIRED`), `requestedAt`, `resolvedAt`, `resolvedByTeacherId`, `message` (optional).
- **At most one OPEN request per student** (enforced in application logic).
- A student cannot request `toTeacherId` equal to their current active teacher.

## State Machine (Request)

- **OPEN** → (teacher accepts) → **ACCEPTED**
- **OPEN** → (teacher rejects) → **REJECTED**
- **OPEN** → (student cancels) → **CANCELLED**
- **EXPIRED** is reserved for future use (e.g. auto-expiry).

## State Machine (Assignment)

- **ACTIVE** → (teacher removes or request accepted and student moves to another teacher) → **REMOVED** (soft delete: `removedAt`, `removedBy` set).
- When a request is **ACCEPTED**:
  1. All current ACTIVE links for that student are set to REMOVED.
  2. A link for `(toTeacherId, studentId)` is created or reactivated as ACTIVE.
  3. The student’s `AttendanceProfile.currentTeacherEmail` is updated for legacy attendance.

## Non-Negotiable Rules

1. **Never directly overwrite `student.teacherId`** (or equivalent) outside this workflow, except in admin tools.
2. **Idempotency**:
   - Accepting the same request twice returns success and does not duplicate the assignment.
   - Removing a student twice (same teacher–student) is a no-op the second time.
3. **Audit trail**: Requests store who requested, who resolved (accept/reject), timestamps, and `fromTeacherId` for history.
4. **One OPEN request per student**: If the student already has an OPEN request, a new request is blocked with a clear message.
5. **Tracking**: Never hard-delete assignments. “Current teacher” is derived from the single ACTIVE link per student. Historical analytics use assignment history (ACTIVE/REMOVED + timestamps).

## API (Session-Based)

- **Student**
  - `getStudentCurrentTeacher(token)` → current teacher + open request (if any).
  - `getEligibleTeachersForAssignment(token)` → list of teachers (id, email, name) for dropdown.
  - `createTeacherChangeRequest(token, toTeacherId, message?)` → create OPEN request (blocked if already OPEN or if toTeacherId is current teacher).
  - `cancelTeacherChangeRequest(token)` → set own OPEN request to CANCELLED.
- **Teacher**
  - `getTeacherOpenRequests(token)` → OPEN requests where `toTeacherId === me`.
  - `acceptTeacherChangeRequest(token, requestId)` → accept (transaction: resolve request, end prior assignment, create/activate link, update attendance profile); idempotent.
  - `rejectTeacherChangeRequest(token, requestId)` → set to REJECTED.
  - `removeStudentFromTeacherByTeacherSession(token, studentId)` → soft-remove student from me; idempotent.

## UI

- **Student dashboard**: “My Teacher” card (current teacher or “No teacher assigned”), pending request status with cancel, and “Change Teacher” / “Request a teacher” opening a modal (teacher list + optional message).
- **Teacher portal**: Tabs **Students** (ACTIVE list + Add Student form) and **Requests** (OPEN list with Accept/Reject). Students list has **Remove** with confirmation modal. All mutations refetch or update state so the UI stays in sync.

## Migration and deploy

- **Apply the new table to your database** (once, before or right after deploy):
  - If you use Prisma Migrate: run `npx prisma migrate deploy` (e.g. locally with `DATABASE_URL` set to production, or in a CI step). The migration is in `prisma/migrations/20260219000000_add_teacher_change_request/`.
  - If you use `db push`: run `npx prisma db push` against your production DB to sync the schema.
- **Build**: `npm run build` (runs `prisma generate && next build`).
- **Deploy (Vercel)**: From `portal-next`, run `npx vercel login` if needed, then `npx vercel --prod`. Ensure `DATABASE_URL` and `DIRECT_URL` are set in the Vercel project environment.
