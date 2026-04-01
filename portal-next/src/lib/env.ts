/**
 * Environment Variable Validation
 *
 * Validates required environment variables at startup.
 */

import { z } from 'zod';

/**
 * Schema for server-side environment variables
 */
const serverEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  DIRECT_URL: z.string().url('DIRECT_URL must be a valid URL').optional(),

  // Authentication
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .describe('Secret for signing JWT tokens'),

  // Rewardful API
  REWARDFUL_API_KEY: z
    .string()
    .min(1, 'REWARDFUL_API_KEY is required')
    .describe('API key for Rewardful'),
  REWARDFUL_API_BASE_URL: z
    .string()
    .url()
    .default('https://api.getrewardful.com/v1'),

  // Admin configuration
  ADMIN_EMAILS: z
    .string()
    .min(1, 'ADMIN_EMAILS is required')
    .describe('Comma-separated list of admin emails'),

  // Optional settings
  TEACHER_OVERRIDE_EMAILS: z.string().optional(),
  SESSION_DURATION_HOURS: z.string().transform(Number).default('12'),
  PASSWORD_HASH_ITERATIONS: z.string().transform(Number).default('10000'),
  MAX_FAILED_LOGIN_ATTEMPTS: z.string().transform(Number).default('5'),
  LOCKOUT_DURATION_MINUTES: z.string().transform(Number).default('15'),
  USD_TO_CAD_RATE: z.string().transform(Number).default('1.4'),
  REWARDFUL_WEBHOOK_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_JSON: z.string().transform((v) => v === 'true').default('false'),

  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

/**
 * Schema for client-side environment variables
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_NAME: z.string().default('TradersUtopia Portal'),
});

/**
 * Validated server environment
 */
let serverEnv: z.infer<typeof serverEnvSchema> | null = null;

/**
 * Validate and get server environment variables
 */
export function getServerEnv(): z.infer<typeof serverEnvSchema> {
  if (serverEnv) return serverEnv;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);

    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment variables');
    }

    // In development, log warning but continue with defaults
    console.warn('⚠ Using default values for missing environment variables');

    // Create a partial env with defaults
    serverEnv = {
      DATABASE_URL: process.env.DATABASE_URL || '',
      JWT_SECRET: process.env.JWT_SECRET || 'development-secret-min-32-characters',
      REWARDFUL_API_KEY: process.env.REWARDFUL_API_KEY || '',
      REWARDFUL_API_BASE_URL: 'https://api.getrewardful.com/v1',
      ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'admin@example.com',
      SESSION_DURATION_HOURS: 12,
      PASSWORD_HASH_ITERATIONS: 10000,
      MAX_FAILED_LOGIN_ATTEMPTS: 5,
      LOCKOUT_DURATION_MINUTES: 15,
      USD_TO_CAD_RATE: 1.4,
      LOG_LEVEL: 'info',
      LOG_JSON: false,
      NODE_ENV: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
    } as z.infer<typeof serverEnvSchema>;

    return serverEnv;
  }

  serverEnv = parsed.data;
  return serverEnv;
}

/**
 * Validate client environment variables
 */
export function getClientEnv(): z.infer<typeof clientEnvSchema> {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  });

  if (!parsed.success) {
    console.warn('Invalid client environment variables:', parsed.error.flatten().fieldErrors);
  }

  return parsed.data || {
    NEXT_PUBLIC_APP_NAME: 'TradersUtopia Portal',
  };
}

/**
 * Check if required environment variables are set
 */
export function validateEnvOnStartup(): void {
  console.log('Validating environment variables...');

  try {
    getServerEnv();
    console.log('✓ Environment variables validated');
  } catch (error) {
    console.error('✗ Environment validation failed:', error);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

/**
 * List of required environment variables for documentation
 */
export const requiredEnvVars = [
  { name: 'DATABASE_URL', description: 'PostgreSQL connection string', required: true },
  { name: 'JWT_SECRET', description: 'Secret for JWT signing (min 32 chars)', required: true },
  { name: 'REWARDFUL_API_KEY', description: 'Rewardful API key', required: true },
  { name: 'ADMIN_EMAILS', description: 'Comma-separated admin emails', required: true },
  { name: 'TEACHER_OVERRIDE_EMAILS', description: 'Comma-separated teacher emails', required: false },
  { name: 'SESSION_DURATION_HOURS', description: 'Session duration (default: 12)', required: false },
  { name: 'USD_TO_CAD_RATE', description: 'Currency conversion rate (default: 1.4)', required: false },
];
