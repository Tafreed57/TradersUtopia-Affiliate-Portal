/**
 * Migration Utilities
 *
 * Helper functions for data migration.
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Create Prisma client for migrations
export const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

/**
 * Normalize email address (matches legacy behavior)
 */
export function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.toLowerCase().trim();
}

/**
 * Parse legacy date string to Date object
 */
export function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

/**
 * Load JSON export file
 */
export function loadExportFile<T>(filename: string): T {
  const filePath = path.resolve(process.cwd(), 'data', filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Export file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Save migration result to file
 */
export function saveResult(filename: string, data: unknown): void {
  const dirPath = path.resolve(process.cwd(), 'data', 'migration-results');

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const filePath = path.join(dirPath, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Result saved to: ${filePath}`);
}

/**
 * Create a progress logger
 */
export function createProgressLogger(entity: string, total: number) {
  let current = 0;
  const startTime = Date.now();

  return {
    tick(message?: string) {
      current++;
      const percent = Math.round((current / total) * 100);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(
        `\r[${entity}] ${current}/${total} (${percent}%) - ${elapsed}s${message ? ` - ${message}` : ''}`
      );
    },
    done() {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n[${entity}] Complete: ${current} items in ${elapsed}s`);
    },
  };
}

/**
 * Batch process items with concurrency limit
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<R[]> {
  const { batchSize = 10, onProgress } = options;
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + batchSize, items.length), items.length);
    }
  }

  return results;
}

/**
 * Check if user already exists
 */
export async function userExists(email: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { aliasEmail: normalizeEmail(email) },
  });
  return count > 0;
}

/**
 * Get or create user by email
 */
export async function getOrCreateUser(email: string): Promise<string> {
  const normalizedEmail = normalizeEmail(email);

  let user = await prisma.user.findUnique({
    where: { aliasEmail: normalizedEmail },
    select: { id: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        aliasEmail: normalizedEmail,
        email: normalizedEmail,
        accountStatus: 'ACTIVE',
      },
      select: { id: true },
    });
  }

  return user.id;
}

/**
 * Clean up database for fresh migration
 */
export async function cleanDatabase(): Promise<void> {
  console.log('Cleaning database...');

  // Delete in order to respect foreign keys
  await prisma.auditLog.deleteMany();
  await prisma.apiCache.deleteMany();
  await prisma.referralCache.deleteMany();
  await prisma.teacherPayment.deleteMany();
  await prisma.teacherEarnings.deleteMany();
  await prisma.commissionTracking.deleteMany();
  await prisma.commissionOverride.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceProfile.deleteMany();
  await prisma.teacherStudentLink.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  console.log('Database cleaned');
}

/**
 * Get migration stats
 */
export async function getMigrationStats(): Promise<{
  users: number;
  sessions: number;
  attendanceProfiles: number;
  attendanceRecords: number;
  teacherLinks: number;
  commissionOverrides: number;
}> {
  const [
    users,
    sessions,
    attendanceProfiles,
    attendanceRecords,
    teacherLinks,
    commissionOverrides,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.session.count(),
    prisma.attendanceProfile.count(),
    prisma.attendanceRecord.count(),
    prisma.teacherStudentLink.count(),
    prisma.commissionOverride.count(),
  ]);

  return {
    users,
    sessions,
    attendanceProfiles,
    attendanceRecords,
    teacherLinks,
    commissionOverrides,
  };
}

/**
 * Disconnect Prisma client
 */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
