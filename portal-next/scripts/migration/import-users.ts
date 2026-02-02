/**
 * Import Users Script
 *
 * Imports user data from legacy PropertiesService export.
 *
 * Run with: npx tsx scripts/migration/import-users.ts
 */

import {
  prisma,
  normalizeEmail,
  parseDate,
  loadExportFile,
  saveResult,
  createProgressLogger,
  disconnect,
} from './utils';
import type {
  LegacyDataExport,
  LegacyAffiliateAuth,
  LegacyPendingAccount,
  LegacyApprovedAccount,
  LegacyRejectedAccount,
  LegacyAuthData,
  MigrationResult,
} from './types';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').filter(Boolean);
const TEACHER_EMAILS = (process.env.TEACHER_OVERRIDE_EMAILS || '').toLowerCase().split(',').filter(Boolean);

interface UserImportResult {
  email: string;
  status: 'created' | 'updated' | 'skipped' | 'error';
  error?: string;
}

async function importUsers(): Promise<MigrationResult> {
  console.log('\n=== IMPORTING USERS ===\n');

  const startTime = Date.now();
  const results: UserImportResult[] = [];
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
      entity: 'users',
      imported: 0,
      skipped: 0,
      errors: [{ key: 'file', error: String(error) }],
      duration: Date.now() - startTime,
    };
  }

  // Collect all unique users from various sources
  const userMap = new Map<string, {
    aliasEmail: string;
    internalEmail?: string;
    firstName?: string;
    lastName?: string;
    passwordHash?: string;
    passwordSalt?: string;
    passwordSetAt?: Date | null;
    accountStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'COMPLETED';
    isAdmin: boolean;
    isTeacher: boolean;
    requestedAt?: Date | null;
    approvedAt?: Date | null;
    approvedBy?: string;
    rejectedAt?: Date | null;
    rejectedBy?: string;
    rejectionReason?: string;
    rewardfulAffiliateId?: string;
    lastLoginAt?: Date | null;
    failedLoginCount?: number;
    lockUntilTimestamp?: Date | null;
  }>();

  // Process affiliate auth (primary source)
  console.log('Processing affiliate auth data...');
  for (const [email, data] of Object.entries(exportData.affiliateAuth || {})) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) continue;

    const existing = userMap.get(normalizedEmail);
    userMap.set(normalizedEmail, {
      ...existing,
      aliasEmail: normalizeEmail(data.aliasEmail || email),
      internalEmail: data.internalEmail ? normalizeEmail(data.internalEmail) : undefined,
      passwordHash: data.hash,
      passwordSalt: data.salt,
      passwordSetAt: parseDate(data.passwordSetAt || data.createdAt),
      accountStatus: data.hash ? 'ACTIVE' : 'APPROVED',
      isAdmin: ADMIN_EMAILS.includes(normalizedEmail),
      isTeacher: TEACHER_EMAILS.includes(normalizedEmail),
    });
  }

  // Process basic auth data
  console.log('Processing auth data...');
  for (const [email, data] of Object.entries(exportData.authData || {})) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) continue;

    const existing = userMap.get(normalizedEmail);
    if (!existing) {
      userMap.set(normalizedEmail, {
        aliasEmail: normalizedEmail,
        passwordHash: data.hash,
        passwordSalt: data.salt,
        passwordSetAt: parseDate(data.createdAt),
        accountStatus: data.hash ? 'ACTIVE' : 'PENDING',
        isAdmin: ADMIN_EMAILS.includes(normalizedEmail),
        isTeacher: TEACHER_EMAILS.includes(normalizedEmail),
        lastLoginAt: parseDate(data.lastLogin),
        failedLoginCount: data.failedAttempts || 0,
        lockUntilTimestamp: parseDate(data.lockUntil),
      });
    } else {
      // Merge data
      userMap.set(normalizedEmail, {
        ...existing,
        passwordHash: existing.passwordHash || data.hash,
        passwordSalt: existing.passwordSalt || data.salt,
        lastLoginAt: parseDate(data.lastLogin) || existing.lastLoginAt,
        failedLoginCount: data.failedAttempts || existing.failedLoginCount,
        lockUntilTimestamp: parseDate(data.lockUntil) || existing.lockUntilTimestamp,
      });
    }
  }

  // Process pending accounts
  console.log('Processing pending accounts...');
  for (const [email, data] of Object.entries(exportData.pendingAccounts || {})) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) continue;

    const existing = userMap.get(normalizedEmail);
    if (!existing) {
      userMap.set(normalizedEmail, {
        aliasEmail: normalizedEmail,
        firstName: data.firstName,
        lastName: data.lastName,
        accountStatus: 'PENDING',
        isAdmin: false,
        isTeacher: false,
        requestedAt: parseDate(data.requestedAt),
      });
    }
  }

  // Process approved accounts
  console.log('Processing approved accounts...');
  for (const [email, data] of Object.entries(exportData.approvedAccounts || {})) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) continue;

    const existing = userMap.get(normalizedEmail);
    userMap.set(normalizedEmail, {
      ...existing,
      aliasEmail: normalizeEmail(data.aliasEmail || email),
      internalEmail: data.internalEmail ? normalizeEmail(data.internalEmail) : existing?.internalEmail,
      firstName: data.firstName || existing?.firstName,
      lastName: data.lastName || existing?.lastName,
      accountStatus: existing?.passwordHash ? 'ACTIVE' : 'APPROVED',
      isAdmin: existing?.isAdmin || ADMIN_EMAILS.includes(normalizedEmail),
      isTeacher: existing?.isTeacher || TEACHER_EMAILS.includes(normalizedEmail),
      approvedAt: parseDate(data.approvedAt),
      approvedBy: data.approvedBy,
      rewardfulAffiliateId: data.affiliateId,
    });
  }

  // Process rejected accounts
  console.log('Processing rejected accounts...');
  for (const [email, data] of Object.entries(exportData.rejectedAccounts || {})) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) continue;

    const existing = userMap.get(normalizedEmail);
    if (!existing) {
      userMap.set(normalizedEmail, {
        aliasEmail: normalizedEmail,
        accountStatus: 'REJECTED',
        isAdmin: false,
        isTeacher: false,
        rejectedAt: parseDate(data.rejectedAt),
        rejectedBy: data.rejectedBy,
        rejectionReason: data.reason,
      });
    }
  }

  // Import to database
  console.log(`\nImporting ${userMap.size} users to database...`);
  const progress = createProgressLogger('Users', userMap.size);

  let imported = 0;
  let skipped = 0;

  for (const [email, userData] of userMap) {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { aliasEmail: userData.aliasEmail },
      });

      if (existingUser) {
        // Update existing user
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            email: userData.aliasEmail,
            internalEmail: userData.internalEmail || existingUser.internalEmail,
            firstName: userData.firstName || existingUser.firstName,
            lastName: userData.lastName || existingUser.lastName,
            passwordHash: userData.passwordHash || existingUser.passwordHash,
            passwordSalt: userData.passwordSalt || existingUser.passwordSalt,
            passwordSetAt: userData.passwordSetAt || existingUser.passwordSetAt,
            accountStatus: userData.accountStatus,
            isAdmin: userData.isAdmin,
            isTeacher: userData.isTeacher,
            requestedAt: userData.requestedAt || existingUser.requestedAt,
            approvedAt: userData.approvedAt || existingUser.approvedAt,
            approvedBy: userData.approvedBy || existingUser.approvedBy,
            rejectedAt: userData.rejectedAt || existingUser.rejectedAt,
            rejectedBy: userData.rejectedBy || existingUser.rejectedBy,
            rejectionReason: userData.rejectionReason || existingUser.rejectionReason,
            rewardfulAffiliateId: userData.rewardfulAffiliateId || existingUser.rewardfulAffiliateId,
            lastLoginAt: userData.lastLoginAt || existingUser.lastLoginAt,
            failedLoginCount: userData.failedLoginCount ?? existingUser.failedLoginCount,
            lockUntilTimestamp: userData.lockUntilTimestamp || existingUser.lockUntilTimestamp,
          },
        });

        results.push({ email, status: 'updated' });
        imported++;
      } else {
        // Create new user
        await prisma.user.create({
          data: {
            aliasEmail: userData.aliasEmail,
            email: userData.aliasEmail,
            internalEmail: userData.internalEmail,
            firstName: userData.firstName,
            lastName: userData.lastName,
            passwordHash: userData.passwordHash,
            passwordSalt: userData.passwordSalt,
            passwordSetAt: userData.passwordSetAt,
            accountStatus: userData.accountStatus,
            isAdmin: userData.isAdmin,
            isTeacher: userData.isTeacher,
            requestedAt: userData.requestedAt,
            approvedAt: userData.approvedAt,
            approvedBy: userData.approvedBy,
            rejectedAt: userData.rejectedAt,
            rejectedBy: userData.rejectedBy,
            rejectionReason: userData.rejectionReason,
            rewardfulAffiliateId: userData.rewardfulAffiliateId,
            lastLoginAt: userData.lastLoginAt,
            failedLoginCount: userData.failedLoginCount || 0,
            lockUntilTimestamp: userData.lockUntilTimestamp,
          },
        });

        results.push({ email, status: 'created' });
        imported++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ email, status: 'error', error: errorMsg });
      errors.push({ key: email, error: errorMsg });
    }

    progress.tick();
  }

  progress.done();

  // Save detailed results
  saveResult('import-users-results.json', {
    importedAt: new Date().toISOString(),
    results,
    summary: {
      total: userMap.size,
      imported,
      skipped,
      errors: errors.length,
    },
  });

  console.log(`\nUser import complete:`);
  console.log(`- Imported: ${imported}`);
  console.log(`- Skipped: ${skipped}`);
  console.log(`- Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    entity: 'users',
    imported,
    skipped,
    errors,
    duration: Date.now() - startTime,
  };
}

// Run if executed directly
if (require.main === module) {
  importUsers()
    .then((result) => {
      console.log('\nMigration result:', result);
      return disconnect();
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      return disconnect();
    });
}

export { importUsers };
