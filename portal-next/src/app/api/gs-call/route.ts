/**
 * Legacy Compatibility API Endpoint
 *
 * This endpoint mimics the google.script.run interface from GAS.
 * It allows gradual frontend migration by providing a drop-in replacement
 * for the legacy backend calls.
 *
 * Request format:
 * POST /api/gs-call
 * {
 *   "function": "functionName",
 *   "args": [arg1, arg2, ...]
 * }
 *
 * Response format:
 * { "success": true, "result": <function result> }
 * { "success": false, "error": "<error message>" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { functionRegistry, type FunctionName } from '@/lib/services/registry';

// Request body schema
interface GsCallRequest {
  function: string;
  args?: unknown[];
}

// Response wrapper
interface GsCallResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * POST /api/gs-call
 *
 * Main compatibility endpoint that routes to legacy function implementations.
 */
export async function POST(request: NextRequest): Promise<NextResponse<GsCallResponse>> {
  // Check if compatibility API is enabled
  if (!config.legacy.enableCompatApi) {
    return NextResponse.json(
      { success: false, error: 'Legacy compatibility API is disabled' },
      { status: 403 }
    );
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  const log = logger.child({ requestId, endpoint: 'gs-call' });

  try {
    // Parse request body
    const body: GsCallRequest = await request.json();
    const { function: functionName, args = [] } = body;

    log.debug('Received gs-call request', { functionName, argCount: args.length });

    // Validate function name
    if (!functionName || typeof functionName !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Function name is required' },
        { status: 400 }
      );
    }

    // Check if function exists in registry
    const handler = functionRegistry[functionName as FunctionName];
    if (!handler) {
      log.warn('Unknown function requested', { functionName });
      return NextResponse.json(
        { success: false, error: `Unknown function: ${functionName}` },
        { status: 404 }
      );
    }

    // Execute the function
    log.info('Executing function', { functionName });
    const startTime = Date.now();

    const result = await handler(...args);

    const duration = Date.now() - startTime;
    log.info('Function completed', { functionName, durationMs: duration });

    // Return result
    return NextResponse.json({ success: true, result });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('gs-call error', { error: message });

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gs-call
 *
 * Returns list of available functions (for debugging)
 */
export async function GET(): Promise<NextResponse> {
  if (!config.legacy.enableCompatApi) {
    return NextResponse.json(
      { success: false, error: 'Legacy compatibility API is disabled' },
      { status: 403 }
    );
  }

  const functions = Object.keys(functionRegistry);

  return NextResponse.json({
    success: true,
    availableFunctions: functions,
    count: functions.length,
  });
}
