/**
 * Logger Utility
 *
 * Provides structured logging with levels, context, and optional JSON output.
 * Replaces the legacy Logger.log() calls from Google Apps Script.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

// Log level hierarchy
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get configured log level (defaults to 'info')
function getConfiguredLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (level && LOG_LEVELS[level] !== undefined) {
    return level;
  }
  return 'info';
}

// Check if JSON logging is enabled
function isJsonLogging(): boolean {
  return process.env.LOG_JSON === 'true';
}

// Should we log at this level?
function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getConfiguredLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

// Format log entry
function formatEntry(entry: LogEntry): string {
  if (isJsonLogging()) {
    return JSON.stringify(entry);
  }

  const contextStr = entry.context
    ? ` ${JSON.stringify(entry.context)}`
    : '';

  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;
}

// Core log function
function log(level: LogLevel, message: string, context?: LogContext): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };

  const formatted = formatEntry(entry);

  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'debug':
      console.debug(formatted);
      break;
    default:
      console.log(formatted);
  }
}

/**
 * Logger object with level-specific methods
 */
export const logger = {
  /**
   * Debug level - verbose output for development
   */
  debug(message: string, context?: LogContext): void {
    log('debug', message, context);
  },

  /**
   * Info level - general operational messages
   */
  info(message: string, context?: LogContext): void {
    log('info', message, context);
  },

  /**
   * Warn level - warning conditions
   */
  warn(message: string, context?: LogContext): void {
    log('warn', message, context);
  },

  /**
   * Error level - error conditions
   */
  error(message: string, context?: LogContext): void {
    log('error', message, context);
  },

  /**
   * Create a child logger with preset context
   */
  child(baseContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) =>
        log('debug', message, { ...baseContext, ...context }),
      info: (message: string, context?: LogContext) =>
        log('info', message, { ...baseContext, ...context }),
      warn: (message: string, context?: LogContext) =>
        log('warn', message, { ...baseContext, ...context }),
      error: (message: string, context?: LogContext) =>
        log('error', message, { ...baseContext, ...context }),
    };
  },

  /**
   * Log a separator line (for debugging, mimics legacy Logger.log('==='))
   */
  separator(label?: string): void {
    if (!shouldLog('debug')) return;
    const line = '═'.repeat(50);
    if (label) {
      log('debug', `${line}\n${label}\n${line}`);
    } else {
      log('debug', line);
    }
  },

  /**
   * Log function entry (for debugging)
   */
  enter(functionName: string, params?: LogContext): void {
    log('debug', `→ ${functionName}`, params);
  },

  /**
   * Log function exit (for debugging)
   */
  exit(functionName: string, result?: unknown): void {
    log('debug', `← ${functionName}`, result ? { result } : undefined);
  },

  /**
   * Time an operation
   */
  async time<T>(
    label: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await operation();
      const duration = Date.now() - start;
      log('debug', `${label} completed`, { durationMs: duration });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      log('error', `${label} failed`, {
        durationMs: duration,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};

// Export type
export type Logger = typeof logger;
