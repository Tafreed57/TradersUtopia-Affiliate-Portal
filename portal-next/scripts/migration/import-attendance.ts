/**
 * Import Attendance Data Script
 *
 * Imports attendance profiles and records from legacy PropertiesService export.
 *
 * Run with: npx tsx scripts/migration/import-attendance.ts
 */

import {
  prisma,
  normalizeEmail,
  parseDate,
  loadExportFile,
  saveResult,
  createProgressLogger,
  getOrCreateUser,
  disconnect,
} from './utils';
import type {
  LegacyDataExport,
  LegacyAttendanceUser,
  LegacyAttendanceRecords,
  MigrationResult,
} from './types';

async function importAttendance(): Promise<MigrationResult> {
  console.log('\n=== IMPORTING ATTENDANCE DATA ===\n');

  const startTime = Date.now();
  const errors: Array<{ key: string; error: string }> = [];

  // Load export file
  let exportData: LegacyDataExport;
  try {
    exportData = loadExportFile<LegacyDataExport>('legacy-export.json');
    console.log(`Loaded export from: ${exportData.exportedAt}`);
  } catch (error) {
    console.error('Failed to load export file:', error);
    return {
      success: false,
      entity: 'attendance',
      imported: 0,
      skipped: 0,
      errors: [{ key: 'file', error: String(error) }],
      duration: Date.now() - startTime,
    };
  }

  const attendanceUsers = exportData.attendanceUsers || {};
  const attendanceRecords = exportData.attendanceRecords || {};

  // Collect all unique emails from both sources
  const allEmails = new Set([
    ...Object.keys(attendanceUsers),
    ...Object.keys(attendanceRecords),
  ]);

  console.log(`Found ${allEmails.size} attendance users`);

  let profilesCreated = 0;
  let recordsCreated = 0;
  let skipped = 0;

  const progress = createProgressLogger('Attendance', allEmails.size);

  for (const email of allEmails) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      skipped++;
      progress.tick('skipped - invalid email');
      continue;
    }

    try {
      // Get or create user
      const userId = await getOrCreateUser(normalizedEmail);

      // Get attendance user data
      const userData: LegacyAttendanceUser = attendanceUsers[email] || {};
      const records: LegacyAttendanceRecords = attendanceRecords[email] || {};

      // Check if profile already exists
      let profile = await prisma.attendanceProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        // Create attendance profile
        profile = await prisma.attendanceProfile.create({
          data: {
            userId,
            currentTeacherEmail: userData.teacherEmail
              ? normalizeEmail(userData.teacherEmail)
              : null,
            createdAt: parseDate(userData.createdAt) || new Date(),
            legacyPasswordHash: userData.passwordHash,
          },
        });
        profilesCreated++;
      }

      // Import attendance records
      for (const [date, recordData] of Object.entries(records)) {
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push({ key: `${email}:${date}`, error: 'Invalid date format' });
          continue;
        }

        // Check if record already exists
        const existingRecord = await prisma.attendanceRecord.findUnique({
          where: {
            profileId_date: {
              profileId: profile.id,
              date,
            },
          },
        });

        if (!existingRecord) {
          await prisma.attendanceRecord.create({
            data: {
              profileId: profile.id,
              date,
              confirmedAt: parseDate(recordData.confirmedAt) || new Date(),
              teacherEmail: recordData.teacherEmail
                ? normalizeEmail(recordData.teacherEmail)
                : null,
              confirmationCount: recordData.confirmationCount || 1,
            },
          });
          recordsCreated++;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ key: email, error: errorMsg });
    }

    progress.tick();
  }

  progress.done();

  // Save results
  saveResult('import-attendance-results.json', {
    importedAt: new Date().toISOString(),
    summary: {
      totalUsers: allEmails.size,
      profilesCreated,
      recordsCreated,
      skipped,
      errors: errors.length,
    },
    errors,
  });

  console.log(`\nAttendance import complete:`);
  console.log(`- Profiles created: ${profilesCreated}`);
  console.log(`- Records created: ${recordsCreated}`);
  console.log(`- Skipped: ${skipped}`);
  console.log(`- Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    entity: 'attendance',
    imported: profilesCreated + recordsCreated,
    skipped,
    errors,
    duration: Date.now() - startTime,
  };
}

// Run if executed directly
if (require.main === module) {
  importAttendance()
    .then((result) => {
      console.log('\nMigration result:', result);
      return disconnect();
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      return disconnect();
    });
}

export { importAttendance };
