/**
 * Password Hashing Utilities
 *
 * Implements secure password hashing compatible with the legacy system.
 * Legacy used SHA-256 with 10,000 iterations; we use bcrypt for new passwords
 * but support verifying legacy hashes during migration.
 */

import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { config } from '../config';

// ============================================================================
// BCRYPT (Recommended for new passwords)
// ============================================================================

const BCRYPT_ROUNDS = 12;

/**
 * Hash a password using bcrypt (recommended for new passwords)
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a bcrypt hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============================================================================
// LEGACY SHA-256 (For migration compatibility)
// ============================================================================

/**
 * Generate a random salt (legacy format)
 */
export function generateLegacySalt(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  for (let i = 0; i < 32; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

/**
 * Hash password using legacy SHA-256 method
 * This mimics the GAS hashPassword_ function exactly
 */
export function hashPasswordLegacy(password: string, salt: string): string {
  const iterations = config.auth.passwordHashIterations;
  let combined = password + salt;

  // Iterative hashing (matches GAS implementation)
  for (let i = 0; i < iterations; i++) {
    const hash = createHash('sha256').update(combined).digest('base64');
    combined = hash + salt;
  }

  // Final hash
  return createHash('sha256').update(combined).digest('base64');
}

/**
 * Verify password against legacy hash
 */
export function verifyPasswordLegacy(
  password: string,
  salt: string,
  hash: string
): boolean {
  const computedHash = hashPasswordLegacy(password, salt);
  return computedHash === hash;
}

// ============================================================================
// UNIFIED VERIFICATION (Handles both formats)
// ============================================================================

/**
 * Password hash format detection
 */
export function isLegacyHash(hash: string): boolean {
  // Bcrypt hashes start with $2a$, $2b$, or $2y$
  return !hash.startsWith('$2');
}

/**
 * Verify password against either legacy or bcrypt hash
 *
 * @param password - Plain text password
 * @param hash - Password hash (bcrypt or legacy)
 * @param salt - Salt (only needed for legacy hashes)
 * @returns true if password matches
 */
export async function verifyPasswordUnified(
  password: string,
  hash: string,
  salt?: string | null
): Promise<boolean> {
  if (isLegacyHash(hash)) {
    // Legacy SHA-256 hash
    if (!salt) {
      return false;
    }
    return verifyPasswordLegacy(password, salt, hash);
  } else {
    // Bcrypt hash
    return verifyPassword(password, hash);
  }
}

/**
 * Rehash a password to bcrypt if it was legacy
 * Returns new hash if rehashing needed, null otherwise
 */
export async function rehashIfLegacy(
  password: string,
  currentHash: string
): Promise<string | null> {
  if (isLegacyHash(currentHash)) {
    // Upgrade to bcrypt
    return hashPassword(password);
  }
  return null;
}
