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
    // Support both field naming conventions (hash/salt OR passwordHash/passwordSalt)
    const pwHash = (data as Record<string, unknown>).passwordHash ?? data.hash;
    const pwSalt = (data as Record<string, unknown>).passwordSalt ?? data.salt;
    userMap.set(normalizedEmail, {
      ...existing,
      aliasEmail: normalizeEmail(data.aliasEmail || email),
      internalEmail: data.internalEmail ? normalizeEmail(data.internalEmail) : undefined,
      passwordHash: pwHash as string | undefined,
      passwordSalt: pwSalt as string | undefined,
      passwordSetAt: parseDate(data.passwordSetAt || data.createdAt),
      accountStatus: pwHash ? 'ACTIVE' : 'APPROVED',
      isAdmin: ADMIN_EMAILS.includes(normalizedEmail),
      isTeacher: TEACHER_EMAILS.includes(normalizedEmail),
    });
  }

  // Process basic auth data
  console.log('Processing auth data...');
  for (const [email, data] of Object.entries(exportData.authData || {})) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) continue;

    // Support both field naming conventions AND extended fields from export
    const rawData = data as Record<string, unknown>;
    const pwHash = rawData.passwordHash ?? data.hash;
    const pwSalt = rawData.passwordSalt ?? data.salt;
    const aliasEmail = (rawData.aliasEmail as string) || normalizedEmail;
    const internalEmail = (rawData.internalEmail as string) || (rawData.rewardfulEmail as string);
    const firstName = rawData.firstName as string | undefined;
    const lastName = rawData.lastName as string | undefined;
    const accountStatus = (rawData.accountStatus as string) || (pwHash ? 'ACTIVE' : 'PENDING');
    const rewardfulAffiliateId = (rawData.rewardfulAffiliateId as string) || (rawData.affiliateId as string);
    const approvedAt = parseDate(rawData.approvedAt as string);
    const approvedBy = rawData.approvedBy as string | undefined;
    const lastLoginAt = parseDate((rawData.lastLoginAt as string) || data.lastLogin);
    const passwordSetAt = parseDate((rawData.passwordSetAt as string) || data.createdAt);
    const failedLoginCount = (rawData.failedLoginCount as number) || data.failedAttempts || 0;
    const lockUntilTimestamp = parseDate((rawData.lockUntilTimestamp as string) || data.lockUntil);

    const existing = userMap.get(normalizedEmail);
    if (!existing) {
      userMap.set(normalizedEmail, {
        aliasEmail: normalizeEmail(aliasEmail),
        internalEmail: internalEmail ? normalizeEmail(internalEmail) : undefined,
        firstName,
        lastName,
        passwordHash: pwHash as string | undefined,
        passwordSalt: pwSalt as string | undefined,
        passwordSetAt,
        accountStatus: accountStatus as 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'COMPLETED',
        isAdmin: ADMIN_EMAILS.includes(normalizedEmail),
        isTeacher: TEACHER_EMAILS.includes(normalizedEmail),
        rewardfulAffiliateId,
        approvedAt,
        approvedBy,
        lastLoginAt,
        failedLoginCount,
        lockUntilTimestamp,
      });
    } else {
      // Merge data
      userMap.set(normalizedEmail, {
        ...existing,
        aliasEmail: existing.aliasEmail || normalizeEmail(aliasEmail),
        internalEmail: existing.internalEmail || (internalEmail ? normalizeEmail(internalEmail) : undefined),
        firstName: existing.firstName || firstName,
        lastName: existing.lastName || lastName,
        passwordHash: existing.passwordHash || (pwHash as string | undefined),
        passwordSalt: existing.passwordSalt || (pwSalt as string | undefined),
        passwordSetAt: existing.passwordSetAt || passwordSetAt,
        accountStatus: (accountStatus as 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'COMPLETED') || existing.accountStatus,
        rewardfulAffiliateId: existing.rewardfulAffiliateId || rewardfulAffiliateId,
        approvedAt: existing.approvedAt || approvedAt,
        approvedBy: existing.approvedBy || approvedBy,
        lastLoginAt: lastLoginAt || existing.lastLoginAt,
        failedLoginCount: failedLoginCount || existing.failedLoginCount,
        lockUntilTimestamp: lockUntilTimestamp || existing.lockUntilTimestamp,
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
