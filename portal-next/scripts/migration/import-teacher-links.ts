/**
 * Import Teacher-Student Links Script
 *
 * Imports teacher-student relationships and teacher earnings from legacy export.
 *
 * Run with: npx tsx scripts/migration/import-teacher-links.ts
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
  LegacyTeacherLinks,
  LegacyTeacherStudents,
  LegacyTeacherEarnings,
  MigrationResult,
} from './types';

async function importTeacherLinks(): Promise<MigrationResult> {
  console.log('\n=== IMPORTING TEACHER-STUDENT LINKS ===\n');

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
      entity: 'teacher-links',
      imported: 0,
      skipped: 0,
      errors: [{ key: 'file', error: String(error) }],
      duration: Date.now() - startTime,
    };
  }

  const teacherLinks = exportData.teacherLinks || {};
  const teacherStudents = exportData.teacherStudents || {};
  const teacherEarnings = exportData.teacherEarnings || {};

  // Collect all teacher emails
  const allTeachers = new Set([
    ...Object.keys(teacherLinks),
    ...Object.keys(teacherStudents),
    ...Object.keys(teacherEarnings),
  ]);

  console.log(`Found ${allTeachers.size} teachers`);

  let linksCreated = 0;
  let earningsCreated = 0;
  let skipped = 0;

  const progress = createProgressLogger('Teacher Links', allTeachers.size);

  for (const teacherEmail of allTeachers) {
    const normalizedTeacher = normalizeEmail(teacherEmail);
    if (!normalizedTeacher) {
      skipped++;
      progress.tick('skipped - invalid email');
      continue;
    }

    try {
      // Get or create teacher user
      const teacherId = await getOrCreateUser(normalizedTeacher);

      // Mark as teacher
      await prisma.user.update({
        where: { id: teacherId },
        data: { isTeacher: true },
      });

      // Process canonical links (TEACHER_LINKS_*)
      const canonicalLinks: LegacyTeacherLinks = teacherLinks[teacherEmail] || { students: [] };

      for (const studentData of canonicalLinks.students || []) {
        const normalizedStudent = normalizeEmail(studentData.email);
        if (!normalizedStudent) continue;

        try {
          const studentId = await getOrCreateUser(normalizedStudent);

          // Check if link already exists
          const existingLink = await prisma.teacherStudentLink.findUnique({
            where: {
              teacherId_studentId: {
                teacherId,
                studentId,
              },
            },
          });

          if (!existingLink) {
            await prisma.teacherStudentLink.create({
              data: {
                teacherId,
                studentId,
                status: 'ACTIVE',
                percentageOverride: studentData.percentageOverride,
                createdAt: parseDate(studentData.addedAt) || new Date(),
                createdBy: studentData.addedBy || 'migration',
              },
            });
            linksCreated++;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({
            key: `${teacherEmail}:${studentData.email}`,
            error: errorMsg,
          });
        }
      }

      // Process legacy links (TEACHER_STUDENTS_*)
      const legacyStudents: LegacyTeacherStudents = teacherStudents[teacherEmail] || [];

      for (const studentEmail of legacyStudents) {
        const normalizedStudent = normalizeEmail(studentEmail);
        if (!normalizedStudent) continue;

        try {
          const studentId = await getOrCreateUser(normalizedStudent);

          // Check if link already exists (may have been created from canonical)
          const existingLink = await prisma.teacherStudentLink.findUnique({
            where: {
              teacherId_studentId: {
                teacherId,
                studentId,
              },
            },
          });

          if (!existingLink) {
            await prisma.teacherStudentLink.create({
              data: {
                teacherId,
                studentId,
                status: 'ACTIVE',
                createdBy: 'legacy_migration',
              },
            });
            linksCreated++;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({
            key: `${teacherEmail}:${studentEmail}:legacy`,
            error: errorMsg,
          });
        }
      }

      // Process teacher earnings
      const earnings: LegacyTeacherEarnings = teacherEarnings[teacherEmail];

      if (earnings) {
        // Check if earnings record exists
        const existingEarnings = await prisma.teacherEarnings.findUnique({
          where: { userId: teacherId },
        });

        if (!existingEarnings) {
          const earningsRecord = await prisma.teacherEarnings.create({
            data: {
              userId: teacherId,
              lockedEarnings: earnings.lockedEarnings || 0,
              lockedAt: parseDate(earnings.lockedAt),
              totalEarnedAllTime: earnings.totalEarnedAllTime || 0,
              totalPaidAllTime: earnings.totalPaidAllTime || 0,
            },
          });

          // Import payment history
          if (earnings.payments && earnings.payments.length > 0) {
            for (const payment of earnings.payments) {
              await prisma.teacherPayment.create({
                data: {
                  earningsId: earningsRecord.id,
                  amount: payment.amount,
                  paidAt: parseDate(payment.paidAt) || new Date(),
                  paidBy: payment.paidBy,
                },
              });
            }
          }

          earningsCreated++;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ key: teacherEmail, error: errorMsg });
    }

    progress.tick();
  }

  progress.done();

  // Save results
  saveResult('import-teacher-links-results.json', {
    importedAt: new Date().toISOString(),
    summary: {
      totalTeachers: allTeachers.size,
      linksCreated,
      earningsCreated,
      skipped,
      errors: errors.length,
    },
    errors,
  });

  console.log(`\nTeacher links import complete:`);
  console.log(`- Links created: ${linksCreated}`);
  console.log(`- Earnings records: ${earningsCreated}`);
  console.log(`- Skipped: ${skipped}`);
  console.log(`- Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    entity: 'teacher-links',
    imported: linksCreated + earningsCreated,
    skipped,
    errors,
    duration: Date.now() - startTime,
  };
}

// Run if executed directly
if (require.main === module) {
  importTeacherLinks()
    .then((result) => {
      console.log('\nMigration result:', result);
      return disconnect();
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      return disconnect();
    });
}

export { importTeacherLinks };
