/**
 * Utility Functions Index
 *
 * Re-exports all utility functions for convenient importing.
 */

export { logger } from './logger';

// ============================================================================
// STRING UTILITIES
// ============================================================================

/**
 * Normalize email for consistent storage/comparison
 */
export function normalizeEmail(email: string): string {
  return (email || '').toLowerCase().trim();
}

/**
 * Mask email for display (e.g., "j***@example.com")
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return email;
  return `${local[0]}***@${domain}`;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
  };
  return str.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

// ============================================================================
// NUMBER UTILITIES
// ============================================================================

/**
 * Round to 2 decimal places
 */
export function round2(num: number): number {
  return Math.round(num * 100) / 100;
}

/**
 * Convert cents to dollars
 */
export function centsToDollars(cents: number): number {
  return round2(cents / 100);
}

/**
 * Format currency for display
 */
export function formatCurrency(
  amount: number,
  currency: string = 'CAD'
): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Convert USD to CAD
 */
export function usdToCad(usdAmount: number, rate: number = 1.4): number {
  return round2(usdAmount * rate);
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse YYYY-MM-DD string to Date
 */
export function parseDateString(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

/**
 * Get today's date as YYYY-MM-DD in local timezone
 */
export function getTodayDateString(): string {
  return formatDateString(new Date());
}

/**
 * Format date for display (e.g., "Jan 15, 2024")
 */
export function formatDateDisplay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format datetime for display (e.g., "Jan 15, 2024, 3:45 PM")
 */
export function formatDateTimeDisplay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Calculate days between two dates
 */
export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
}

// ============================================================================
// OBJECT UTILITIES
// ============================================================================

/**
 * Safely parse JSON with fallback
 */
export function safeParseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Remove undefined values from object
 */
export function removeUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Check if string is valid email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if password meets requirements
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  error?: string;
} {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
}

// ============================================================================
// TOKEN UTILITIES
// ============================================================================

/**
 * Generate a random token
 */
export function generateToken(length: number = 64): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let token = '';
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Add timestamp component for uniqueness
  token += '_' + Date.now().toString(36);
  return token;
}

/**
 * Generate UUID v4
 */
export function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
