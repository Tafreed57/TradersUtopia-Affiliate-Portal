/**
 * Application Configuration
 *
 * Centralizes all environment variable access with validation and defaults.
 * Throws at startup if required variables are missing.
 */

// ----------------------------------------------------------------------------
// Validation helpers
// ----------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function optionalEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid number for ${name}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function optionalEnvFloat(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    console.warn(`Invalid float for ${name}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function optionalEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseEmailList(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

// ----------------------------------------------------------------------------
// Configuration object
// ----------------------------------------------------------------------------

export const config = {
  // Environment
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  // App metadata
  app: {
    name: optionalEnv('NEXT_PUBLIC_APP_NAME', 'TradersUtopia Portal'),
    url: optionalEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
    version: '2.0.0',
  },

  // Database (validated at runtime when accessed)
  database: {
    get url(): string {
      return requireEnv('DATABASE_URL');
    },
    get directUrl(): string | undefined {
      return process.env.DIRECT_URL;
    },
  },

  // Authentication
  auth: {
    get jwtSecret(): string {
      return requireEnv('JWT_SECRET');
    },
    sessionDurationHours: optionalEnvNumber('SESSION_DURATION_HOURS', 12),
    passwordHashIterations: optionalEnvNumber('PASSWORD_HASH_ITERATIONS', 10000),
    maxFailedLoginAttempts: optionalEnvNumber('MAX_FAILED_LOGIN_ATTEMPTS', 5),
    lockoutDurationMinutes: optionalEnvNumber('LOCKOUT_DURATION_MINUTES', 15),
    minPasswordLength: 8,
    sessionTokenLength: 64,
  },

  // Rewardful API
  rewardful: {
    get apiKey(): string {
      // Optional at build time; required at runtime when commission features are used
      return process.env.REWARDFUL_API_KEY || '';
    },
    baseUrl: optionalEnv(
      'REWARDFUL_API_BASE_URL',
      'https://api.getrewardful.com/v1'
    ),
    // Rate limiting settings
    maxRetries: 3,
    retryDelayMs: 2000, // Base delay, doubles on each retry
    // Webhook signature verification
    get webhookSecret(): string {
      return process.env.REWARDFUL_WEBHOOK_SECRET || '';
    },
  },

  // Admin configuration
  admin: {
    emails: parseEmailList(process.env.ADMIN_EMAILS),
    teacherOverrideEmails: parseEmailList(process.env.TEACHER_OVERRIDE_EMAILS),
  },

  // Currency conversion
  currency: {
    usdToCadRate: optionalEnvFloat('USD_TO_CAD_RATE', 1.4),
    defaultCurrency: 'CAD' as const,
  },

  // Caching (in seconds)
  cache: {
    sessionTtl: optionalEnvNumber('SESSION_CACHE_TTL_SECONDS', 45000),
    apiResponseTtl: optionalEnvNumber('API_CACHE_TTL_SECONDS', 300),
    referralTtl: optionalEnvNumber('REFERRAL_CACHE_TTL_SECONDS', 900),
  },

  // Logging
  logging: {
    level: optionalEnv('LOG_LEVEL', 'info') as
      | 'debug'
      | 'info'
      | 'warn'
      | 'error',
    json: optionalEnvBoolean('LOG_JSON', false),
  },

  // Legacy migration
  legacy: {
    enableCompatApi: optionalEnvBoolean('ENABLE_LEGACY_COMPAT_API', true),
    gasUrl: process.env.LEGACY_GAS_URL || null,
  },
} as const;

// ----------------------------------------------------------------------------
// Helper functions
// ----------------------------------------------------------------------------

/**
 * Check if an email is an admin
 */
export function isAdminEmail(email: string): boolean {
  return config.admin.emails.includes(email.toLowerCase().trim());
}

/**
 * Check if an email has teacher override access
 */
export function isTeacherOverrideEmail(email: string): boolean {
  return config.admin.teacherOverrideEmails.includes(email.toLowerCase().trim());
}

/**
 * Normalize email for consistent storage/comparison
 */
export function normalizeEmail(email: string): string {
  return (email || '').toLowerCase().trim();
}

/**
 * Convert USD to CAD
 */
export function usdToCad(usdAmount: number): number {
  return usdAmount * config.currency.usdToCadRate;
}

/**
 * Round to 2 decimal places
 */
export function round2(num: number): number {
  return Math.round(num * 100) / 100;
}

// Export type for config
export type Config = typeof config;
