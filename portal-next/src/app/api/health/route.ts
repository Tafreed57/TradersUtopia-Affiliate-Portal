/**
 * Health Check Endpoint
 *
 * GET /api/health
 *
 * Returns application health status for monitoring.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: { status: 'ok' | 'error'; latencyMs?: number; error?: string };
    memory: { status: 'ok' | 'warning'; usedMB: number; totalMB: number };
  };
}

const startTime = Date.now();

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const timestamp = new Date().toISOString();
  const version = process.env.npm_package_version || '1.0.0';
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const checks: HealthStatus['checks'] = {
    database: { status: 'ok' },
    memory: { status: 'ok', usedMB: 0, totalMB: 0 },
  };

  // Database health check
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = {
      status: 'ok',
      latencyMs: Date.now() - dbStart,
    };
  } catch (error) {
    checks.database = {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }

  // Memory usage check
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const memory = process.memoryUsage();
    const usedMB = Math.round(memory.heapUsed / 1024 / 1024);
    const totalMB = Math.round(memory.heapTotal / 1024 / 1024);

    checks.memory = {
      status: usedMB > totalMB * 0.9 ? 'warning' : 'ok',
      usedMB,
      totalMB,
    };
  }

  // Determine overall status
  let status: HealthStatus['status'] = 'healthy';

  if (checks.database.status === 'error') {
    status = 'unhealthy';
  } else if (checks.memory.status === 'warning') {
    status = 'degraded';
  }

  const health: HealthStatus = {
    status,
    timestamp,
    version,
    uptime,
    checks,
  };

  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

  return NextResponse.json(health, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
