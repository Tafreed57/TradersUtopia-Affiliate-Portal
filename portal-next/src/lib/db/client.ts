/**
 * Prisma Client Singleton
 *
 * Ensures a single Prisma client instance across the application.
 * Handles development hot-reload gracefully.
 */

import { PrismaClient } from '@prisma/client';

// Extend global type to include prisma
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Create Prisma client with logging configuration
 */
function createPrismaClient(): PrismaClient {
  const isDevelopment = process.env.NODE_ENV === 'development';

  return new PrismaClient({
    log: isDevelopment
      ? [
          { level: 'query', emit: 'event' },
          { level: 'error', emit: 'stdout' },
          { level: 'warn', emit: 'stdout' },
        ]
      : [{ level: 'error', emit: 'stdout' }],
  });
}

/**
 * Prisma client singleton
 *
 * In development, we store the client on global to prevent
 * hot-reload from creating multiple connections.
 */
export const prisma: PrismaClient = global.prisma ?? createPrismaClient();

// In development, attach to global to survive hot-reload
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

/**
 * Gracefully disconnect Prisma on shutdown
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

// Handle process termination
if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    await disconnectPrisma();
  });
}
