# Data Migration Scripts

This directory contains scripts for migrating data from the legacy Google Apps Script PropertiesService to the new PostgreSQL database.

## Prerequisites

1. Database is set up and accessible (update `.env.local` with `DATABASE_URL`)
2. Prisma client is generated: `npm run db:generate`
3. Database schema is applied: `npm run db:push`

## Migration Workflow

### Step 1: Export Data from GAS

1. Open your Google Apps Script project
2. Create a new file called `ExportData.gs`
3. Copy the contents of `gas-export.js` into that file
4. Run the `exportAllData()` function
5. Download the JSON file from Google Drive
6. Place it in `portal-next/data/legacy-export.json`

### Step 2: Run Migration

```bash
# Full migration (recommended)
npx tsx scripts/migration/run-all.ts

# With clean slate (deletes all existing data first)
npx tsx scripts/migration/run-all.ts --clean

# Skip validation
npx tsx scripts/migration/run-all.ts --skip-validation
```

### Step 3: Validate

```bash
npx tsx scripts/migration/validate.ts
```

## Individual Scripts

You can run each import script individually:

```bash
# Import users
npx tsx scripts/migration/import-users.ts

# Import attendance data
npx tsx scripts/migration/import-attendance.ts

# Import teacher-student links
npx tsx scripts/migration/import-teacher-links.ts

# Import commission data
npx tsx scripts/migration/import-commissions.ts
```

## Test Data (Development)

To seed the database with test data for development:

```bash
npm run db:seed
```

This creates:
- Admin: `admin@tradersutopia.test` / `password123`
- Teacher: `teacher@tradersutopia.test` / `password123`
- 5 Students: `affiliate1-5@tradersutopia.test` / `password123`
- 1 Pending account
- 1 Approved (needs password) account

## File Structure

```
scripts/migration/
├── README.md           # This file
├── types.ts            # Legacy data type definitions
├── utils.ts            # Shared utilities
├── gas-export.js       # GAS script to export PropertiesService
├── import-users.ts     # User import script
├── import-attendance.ts    # Attendance import script
├── import-teacher-links.ts # Teacher links import script
├── import-commissions.ts   # Commission data import script
├── validate.ts         # Data validation script
└── run-all.ts          # Master migration runner

data/
├── legacy-export.json      # Place your GAS export here
└── migration-results/      # Import results and logs
    ├── import-users-results.json
    ├── import-attendance-results.json
    ├── import-teacher-links-results.json
    ├── import-commissions-results.json
    ├── validation-results.json
    └── migration-summary.json
```

## Legacy Key Mapping

| Legacy Key Pattern | Database Table |
|-------------------|----------------|
| `AUTH_*` | `User` (passwordHash, passwordSalt) |
| `AFFILIATE_AUTH_*` | `User` (aliasEmail, internalEmail) |
| `PENDING_*` | `User` (accountStatus: PENDING) |
| `APPROVED_*` | `User` (accountStatus: APPROVED) |
| `REJECTED_*` | `User` (accountStatus: REJECTED) |
| `ATTENDANCE_USER_*` | `AttendanceProfile` |
| `ATTENDANCE_RECORDS_*` | `AttendanceRecord` |
| `TEACHER_LINKS_*` | `TeacherStudentLink` |
| `TEACHER_STUDENTS_*` | `TeacherStudentLink` (legacy) |
| `TEACHER_EARNINGS_*` | `TeacherEarnings`, `TeacherPayment` |
| `OVERRIDE_*` | `CommissionOverride` |
| `TRACKING_*` | `CommissionTracking` |
| `REFERRAL_DATA_*` | `ReferralCache` |

## Troubleshooting

### "Export file not found"
Make sure `legacy-export.json` is in the `data/` directory.

### Database connection errors
Check `DATABASE_URL` in `.env.local` matches your database.

### Import errors
Check the results files in `data/migration-results/` for detailed error logs.

### Validation failures
Run `npx tsx scripts/migration/validate.ts` to see what checks are failing.
