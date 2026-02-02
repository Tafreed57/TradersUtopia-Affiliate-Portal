/**
 * Master Migration Runner
 *
 * Runs all migration scripts in order.
 *
 * Run with: npx tsx scripts/migration/run-all.ts
 */

import { importUsers } from './import-users';
import { importAttendance } from './import-attendance';
import { importTeacherLinks } from './import-teacher-links';
import { importCommissions } from './import-commissions';
import { validateMigration } from './validate';
import {
  cleanDatabase,
  getMigrationStats,
  saveResult,
  disconnect,
} from './utils';
import type { MigrationResult, MigrationSummary } from './types';

interface RunOptions {
  clean?: boolean;
  skipValidation?: boolean;
}

async function runMigration(options: RunOptions = {}): Promise<MigrationSummary> {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║     TRADERSUTOPIA DATA MIGRATION           ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const results: MigrationResult[] = [];

  try {
    // Optional: Clean database
    if (options.clean) {
      console.log('⚠ Clean mode enabled - clearing all data first\n');
      await cleanDatabase();
    }

    // Step 1: Import users
    console.log('\n────────────────────────────────────────────');
    console.log('STEP 1/4: Import Users');
    console.log('────────────────────────────────────────────');
    const usersResult = await importUsers();
    results.push(usersResult);

    if (!usersResult.success && usersResult.errors.length > 10) {
      console.log('\n⚠ Too many user import errors. Stopping migration.');
      throw new Error('User import failed with too many errors');
    }

    // Step 2: Import attendance
    console.log('\n────────────────────────────────────────────');
    console.log('STEP 2/4: Import Attendance Data');
    console.log('────────────────────────────────────────────');
    const attendanceResult = await importAttendance();
    results.push(attendanceResult);

    // Step 3: Import teacher links
    console.log('\n────────────────────────────────────────────');
    console.log('STEP 3/4: Import Teacher-Student Links');
    console.log('────────────────────────────────────────────');
    const linksResult = await importTeacherLinks();
    results.push(linksResult);

    // Step 4: Import commissions
    console.log('\n────────────────────────────────────────────');
    console.log('STEP 4/4: Import Commission Data');
    console.log('────────────────────────────────────────────');
    const commissionsResult = await importCommissions();
    results.push(commissionsResult);

    // Validation
    if (!options.skipValidation) {
      console.log('\n────────────────────────────────────────────');
      console.log('VALIDATION');
      console.log('────────────────────────────────────────────');
      await validateMigration();
    }

    // Final stats
    const stats = await getMigrationStats();

    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║          MIGRATION COMPLETE                ║');
    console.log('╚════════════════════════════════════════════╝\n');

    console.log('Final database state:');
    console.log(`  Users:              ${stats.users}`);
    console.log(`  Sessions:           ${stats.sessions}`);
    console.log(`  Attendance Profiles: ${stats.attendanceProfiles}`);
    console.log(`  Attendance Records:  ${stats.attendanceRecords}`);
    console.log(`  Teacher Links:       ${stats.teacherLinks}`);
    console.log(`  Commission Overrides: ${stats.commissionOverrides}`);

    const completedAt = new Date().toISOString();
    const totalDuration = Date.now() - startTime;

    const summary: MigrationSummary = {
      startedAt,
      completedAt,
      totalDuration,
      results,
      overallSuccess: results.every((r) => r.errors.length === 0),
    };

    // Print summary table
    console.log('\nMigration Summary:');
    console.log('┌────────────────────┬──────────┬─────────┬────────┬──────────┐');
    console.log('│ Entity             │ Imported │ Skipped │ Errors │ Duration │');
    console.log('├────────────────────┼──────────┼─────────┼────────┼──────────┤');

    for (const result of results) {
      const entity = result.entity.padEnd(18);
      const imported = String(result.imported).padStart(8);
      const skipped = String(result.skipped).padStart(7);
      const errors = String(result.errors.length).padStart(6);
      const duration = `${(result.duration / 1000).toFixed(1)}s`.padStart(8);

      console.log(`│ ${entity} │ ${imported} │ ${skipped} │ ${errors} │ ${duration} │`);
    }

    console.log('└────────────────────┴──────────┴─────────┴────────┴──────────┘');
    console.log(`\nTotal duration: ${(totalDuration / 1000).toFixed(1)}s`);

    // Save summary
    saveResult('migration-summary.json', summary);

    return summary;
  } catch (error) {
    console.error('\n✗ Migration failed:', error);

    const completedAt = new Date().toISOString();
    const summary: MigrationSummary = {
      startedAt,
      completedAt,
      totalDuration: Date.now() - startTime,
      results,
      overallSuccess: false,
    };

    saveResult('migration-summary.json', summary);
    throw error;
  }
}

// CLI options
const args = process.argv.slice(2);
const options: RunOptions = {
  clean: args.includes('--clean'),
  skipValidation: args.includes('--skip-validation'),
};

// Run if executed directly
if (require.main === module) {
  console.log('Options:', options);

  runMigration(options)
    .then(() => {
      console.log('\n✓ Migration completed successfully');
      return disconnect();
    })
    .catch((error) => {
      console.error('\n✗ Migration failed:', error);
      return disconnect().then(() => process.exit(1));
    });
}

export { runMigration };
