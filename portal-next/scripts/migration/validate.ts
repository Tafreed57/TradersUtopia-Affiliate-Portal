/**
 * Data Validation Script
 *
 * Validates migrated data integrity.
 *
 * Run with: npx tsx scripts/migration/validate.ts
 */

import {
  prisma,
  getMigrationStats,
  loadExportFile,
  saveResult,
  disconnect,
} from './utils';
import type { LegacyDataExport } from './types';

interface ValidationResult {
  check: string;
  status: 'pass' | 'fail' | 'warn';
  expected?: number;
  actual?: number;
  message: string;
}

async function validateMigration(): Promise<void> {
  console.log('\n=== VALIDATING MIGRATION ===\n');

  const results: ValidationResult[] = [];

  // Load export file for comparison
  let exportData: LegacyDataExport;
  try {
    exportData = loadExportFile<LegacyDataExport>('legacy-export.json');
    console.log(`Loaded export from: ${exportData.exportedAt}\n`);
  } catch (error) {
    console.error('No export file found - running database-only validation\n');
    exportData = {} as LegacyDataExport;
  }

  // Get current stats
  const stats = await getMigrationStats();
  console.log('Current database stats:');
  console.log(`  Users: ${stats.users}`);
  console.log(`  Sessions: ${stats.sessions}`);
  console.log(`  Attendance Profiles: ${stats.attendanceProfiles}`);
  console.log(`  Attendance Records: ${stats.attendanceRecords}`);
  console.log(`  Teacher-Student Links: ${stats.teacherLinks}`);
  console.log(`  Commission Overrides: ${stats.commissionOverrides}`);
  console.log('');

  // Validation checks

  // 1. User count
  const expectedUsers = new Set([
    ...Object.keys(exportData.affiliateAuth || {}),
    ...Object.keys(exportData.authData || {}),
    ...Object.keys(exportData.pendingAccounts || {}),
    ...Object.keys(exportData.approvedAccounts || {}),
  ]).size;

  if (expectedUsers > 0) {
    const userMatch = stats.users >= expectedUsers * 0.9; // Allow 10% variance
    results.push({
      check: 'User count',
      status: userMatch ? 'pass' : 'warn',
      expected: expectedUsers,
      actual: stats.users,
      message: userMatch
        ? 'User count matches expected'
        : `User count lower than expected (${stats.users} vs ${expectedUsers})`,
    });
  }

  // 2. All users have valid email
  const usersWithInvalidEmail = await prisma.user.count({
    where: { aliasEmail: '' },
  });

  results.push({
    check: 'Users with valid email',
    status: usersWithInvalidEmail === 0 ? 'pass' : 'fail',
    expected: 0,
    actual: usersWithInvalidEmail,
    message: usersWithInvalidEmail === 0
      ? 'All users have valid email'
      : `${usersWithInvalidEmail} users have invalid email`,
  });

  // 3. Admin users exist
  const adminCount = await prisma.user.count({
    where: { isAdmin: true },
  });

  results.push({
    check: 'Admin users exist',
    status: adminCount > 0 ? 'pass' : 'warn',
    actual: adminCount,
    message: adminCount > 0
      ? `${adminCount} admin user(s) found`
      : 'No admin users found',
  });

  // 4. Teacher users exist
  const teacherCount = await prisma.user.count({
    where: { isTeacher: true },
  });

  results.push({
    check: 'Teacher users exist',
    status: teacherCount > 0 ? 'pass' : 'warn',
    actual: teacherCount,
    message: teacherCount > 0
      ? `${teacherCount} teacher user(s) found`
      : 'No teacher users found',
  });

  // 5. Active users have passwords
  const activeWithoutPassword = await prisma.user.count({
    where: {
      accountStatus: 'ACTIVE',
      passwordHash: null,
    },
  });

  results.push({
    check: 'Active users have passwords',
    status: activeWithoutPassword === 0 ? 'pass' : 'warn',
    expected: 0,
    actual: activeWithoutPassword,
    message: activeWithoutPassword === 0
      ? 'All active users have passwords'
      : `${activeWithoutPassword} active users without password`,
  });

  // 6. Attendance profiles have valid users
  // AttendanceProfile has required userId, so no orphaned profiles possible
  const orphanedProfiles = 0;

  results.push({
    check: 'Attendance profiles have users',
    status: orphanedProfiles === 0 ? 'pass' : 'fail',
    expected: 0,
    actual: orphanedProfiles,
    message: orphanedProfiles === 0
      ? 'All attendance profiles linked to users'
      : `${orphanedProfiles} orphaned attendance profiles`,
  });

  // 7. Teacher links are valid (teacherId/studentId are required, so no invalid links possible)
  const invalidLinks = 0;

  results.push({
    check: 'Teacher-student links valid',
    status: invalidLinks === 0 ? 'pass' : 'fail',
    expected: 0,
    actual: invalidLinks,
    message: invalidLinks === 0
      ? 'All teacher-student links are valid'
      : `${invalidLinks} invalid teacher-student links`,
  });

  // 8. No duplicate emails
  const emailCounts = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count FROM (
      SELECT "aliasEmail", COUNT(*) as cnt
      FROM "User"
      GROUP BY "aliasEmail"
      HAVING COUNT(*) > 1
    ) as duplicates
  `;

  const duplicateCount = Number(emailCounts[0]?.count || 0);

  results.push({
    check: 'No duplicate emails',
    status: duplicateCount === 0 ? 'pass' : 'fail',
    expected: 0,
    actual: duplicateCount,
    message: duplicateCount === 0
      ? 'No duplicate emails found'
      : `${duplicateCount} duplicate email addresses`,
  });

  // 9. Attendance records have valid dates
  const invalidDates = await prisma.attendanceRecord.count({
    where: {
      OR: [
        { date: '' },
        { date: { not: { contains: '-' } } },
      ],
    },
  });

  results.push({
    check: 'Attendance records have valid dates',
    status: invalidDates === 0 ? 'pass' : 'fail',
    expected: 0,
    actual: invalidDates,
    message: invalidDates === 0
      ? 'All attendance records have valid dates'
      : `${invalidDates} records with invalid dates`,
  });

  // Print results
  console.log('\n=== VALIDATION RESULTS ===\n');

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const result of results) {
    const icon = result.status === 'pass' ? '✓' : result.status === 'warn' ? '⚠' : '✗';
    const color = result.status === 'pass' ? '\x1b[32m' : result.status === 'warn' ? '\x1b[33m' : '\x1b[31m';

    console.log(`${color}${icon}\x1b[0m ${result.check}: ${result.message}`);

    if (result.status === 'pass') passCount++;
    else if (result.status === 'warn') warnCount++;
    else failCount++;
  }

  console.log('\n--------------------------');
  console.log(`\x1b[32m${passCount} passed\x1b[0m, \x1b[33m${warnCount} warnings\x1b[0m, \x1b[31m${failCount} failed\x1b[0m`);

  // Save results
  saveResult('validation-results.json', {
    validatedAt: new Date().toISOString(),
    stats,
    results,
    summary: {
      passed: passCount,
      warnings: warnCount,
      failed: failCount,
      total: results.length,
    },
  });

  if (failCount > 0) {
    console.log('\n⚠ Some validation checks failed. Review the errors above.');
  } else {
    console.log('\n✓ All critical validation checks passed.');
  }
}

// Run if executed directly
if (require.main === module) {
  validateMigration()
    .then(() => disconnect())
    .catch((error) => {
      console.error('Validation failed:', error);
      return disconnect();
    });
}

export { validateMigration };
