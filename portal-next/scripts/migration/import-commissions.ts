/**
 * Import Commission Data Script
 *
 * Imports commission overrides and tracking data from legacy export.
 *
 * Run with: npx tsx scripts/migration/import-commissions.ts
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
  LegacyCommissionOverride,
  LegacyCommissionTracking,
  LegacyReferralData,
  MigrationResult,
} from './types';

async function importCommissions(): Promise<MigrationResult> {
  console.log('\n=== IMPORTING COMMISSION DATA ===\n');

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
      entity: 'commissions',
      imported: 0,
      skipped: 0,
      errors: [{ key: 'file', error: String(error) }],
      duration: Date.now() - startTime,
    };
  }

  const overrides = exportData.commissionOverrides || {};
  const tracking = exportData.commissionTracking || {};
  const referralData = exportData.referralData || {};

  let overridesCreated = 0;
  let trackingCreated = 0;
  let referralCacheCreated = 0;
  let skipped = 0;

  // Import overrides
  console.log(`Importing ${Object.keys(overrides).length} commission overrides...`);
  const overrideProgress = createProgressLogger('Overrides', Object.keys(overrides).length);

  for (const [email, data] of Object.entries(overrides)) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      skipped++;
      overrideProgress.tick('skipped');
      continue;
    }

    try {
      const userId = await getOrCreateUser(normalizedEmail);

      // Check if override exists
      const existing = await prisma.commissionOverride.findUnique({
        where: { userId },
      });

      if (!existing) {
        await prisma.commissionOverride.create({
          data: {
            userId,
            unpaidAmount: data.unpaid,
            dueNowAmount: data.dueNow,
            totalPaidAmount: data.totalPaid,
            note: data.note,
            reason: data.reason,
            setBy: data.setBy,
            setAt: parseDate(data.setAt),
          },
        });
        overridesCreated++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ key: `override:${email}`, error: errorMsg });
    }

    overrideProgress.tick();
  }
  overrideProgress.done();

  // Import tracking data
  console.log(`\nImporting ${Object.keys(tracking).length} tracking records...`);
  const trackingProgress = createProgressLogger('Tracking', Object.keys(tracking).length);

  for (const [email, data] of Object.entries(tracking)) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      skipped++;
      trackingProgress.tick('skipped');
      continue;
    }

    try {
      // Check if tracking exists
      const existing = await prisma.commissionTracking.findUnique({
        where: { email: normalizedEmail },
      });

      if (!existing) {
        await prisma.commissionTracking.create({
          data: {
            email: normalizedEmail,
            lastApiAmount: data.lastApiAmount || 0,
            lastDisplayedAmount: data.lastDisplayedAmount || 0,
            lastFetchedAt: parseDate(data.lastFetchedAt) || new Date(),
          },
        });
        trackingCreated++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ key: `tracking:${email}`, error: errorMsg });
    }

    trackingProgress.tick();
  }
  trackingProgress.done();

  // Import referral cache
  console.log(`\nImporting ${Object.keys(referralData).length} referral cache records...`);
  const referralProgress = createProgressLogger('Referrals', Object.keys(referralData).length);

  for (const [email, data] of Object.entries(referralData)) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      skipped++;
      referralProgress.tick('skipped');
      continue;
    }

    try {
      // Check if cache exists
      const existing = await prisma.referralCache.findUnique({
        where: { email: normalizedEmail },
      });

      if (!existing) {
        await prisma.referralCache.create({
          data: {
            email: normalizedEmail,
            affiliateId: data.affiliateId,
            lastKnownLeadCount: data.lastKnownLeadCount || 0,
            previousLeadCount: data.previousLeadCount || 0,
            lastFetchedAt: parseDate(data.lastFetchedAt) || new Date(),
            lastSuccessfulFetchAt: parseDate(data.lastFetchedAt) || new Date(),
          },
        });
        referralCacheCreated++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ key: `referral:${email}`, error: errorMsg });
    }

    referralProgress.tick();
  }
  referralProgress.done();

  // Save results
  saveResult('import-commissions-results.json', {
    importedAt: new Date().toISOString(),
    summary: {
      overridesCreated,
      trackingCreated,
      referralCacheCreated,
      skipped,
      errors: errors.length,
    },
    errors,
  });

  console.log(`\nCommission data import complete:`);
  console.log(`- Overrides created: ${overridesCreated}`);
  console.log(`- Tracking records: ${trackingCreated}`);
  console.log(`- Referral cache: ${referralCacheCreated}`);
  console.log(`- Skipped: ${skipped}`);
  console.log(`- Errors: ${errors.length}`);

  const totalImported = overridesCreated + trackingCreated + referralCacheCreated;

  return {
    success: errors.length === 0,
    entity: 'commissions',
    imported: totalImported,
    skipped,
    errors,
    duration: Date.now() - startTime,
  };
}

// Run if executed directly
if (require.main === module) {
  importCommissions()
    .then((result) => {
      console.log('\nMigration result:', result);
      return disconnect();
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      return disconnect();
    });
}

export { importCommissions };
