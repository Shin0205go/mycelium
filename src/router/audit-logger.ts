// ============================================================================
// AEGIS Router - Audit Logger
// Records all tool access attempts for compliance and debugging
// ============================================================================

import { Logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

/**
 * Audit log entry for tool access
 */
export interface AuditLogEntry {
  /** Unique entry ID */
  id: string;

  /** Timestamp of the event */
  timestamp: Date;

  /** Session ID */
  sessionId: string;

  /** Current role */
  role: string;

  /** Tool that was accessed */
  tool: string;

  /** Source server of the tool */
  sourceServer: string;

  /** Tool arguments (sanitized) */
  args: Record<string, unknown>;

  /** Access result */
  result: 'allowed' | 'denied' | 'error';

  /** Reason for denial or error message */
  reason?: string;

  /** Execution duration in ms (for allowed calls) */
  durationMs?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Audit log query options
 */
export interface AuditQueryOptions {
  /** Filter by role */
  role?: string;

  /** Filter by tool */
  tool?: string;

  /** Filter by result */
  result?: 'allowed' | 'denied' | 'error';

  /** Start time */
  startTime?: Date;

  /** End time */
  endTime?: Date;

  /** Maximum entries to return */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

/**
 * Audit statistics
 */
export interface AuditStats {
  /** Total entries */
  totalEntries: number;

  /** Entries by result */
  byResult: {
    allowed: number;
    denied: number;
    error: number;
  };

  /** Top tools by usage */
  topTools: Array<{ tool: string; count: number }>;

  /** Top roles by activity */
  topRoles: Array<{ role: string; count: number }>;

  /** Denial rate */
  denialRate: number;

  /** Average execution time for allowed calls */
  avgExecutionTimeMs: number;
}

/**
 * Sensitive argument keys to redact
 */
const SENSITIVE_KEYS = [
  'password',
  'secret',
  'token',
  'api_key',
  'apiKey',
  'credentials',
  'private_key',
  'privateKey',
  'authorization',
  'auth',
];

/**
 * AuditLogger - Records and queries tool access logs
 */
export class AuditLogger extends EventEmitter {
  private logger: Logger;
  private logs: AuditLogEntry[] = [];
  private maxLogSize: number;
  private enabled: boolean = true;

  constructor(logger: Logger, options?: { maxLogSize?: number }) {
    super();
    this.logger = logger;
    this.maxLogSize = options?.maxLogSize ?? 10000;
    this.logger.debug('AuditLogger initialized', { maxLogSize: this.maxLogSize });
  }

  /**
   * Enable audit logging
   */
  enable(): void {
    this.enabled = true;
    this.logger.info('Audit logging enabled');
  }

  /**
   * Disable audit logging
   */
  disable(): void {
    this.enabled = false;
    this.logger.info('Audit logging disabled');
  }

  /**
   * Check if audit logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Log a tool access attempt
   */
  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    if (!this.enabled) {
      return { ...entry, id: '', timestamp: new Date() };
    }

    const fullEntry: AuditLogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: new Date(),
      args: this.sanitizeArgs(entry.args),
    };

    // Add to log
    this.logs.push(fullEntry);

    // Trim if needed
    if (this.logs.length > this.maxLogSize) {
      this.logs = this.logs.slice(-this.maxLogSize);
    }

    // Emit event
    this.emit('logged', fullEntry);

    // Log to console based on result
    if (fullEntry.result === 'denied') {
      this.logger.warn('🚫 Access denied', {
        role: fullEntry.role,
        tool: fullEntry.tool,
        reason: fullEntry.reason,
      });
    } else if (fullEntry.result === 'error') {
      this.logger.error('❌ Tool error', {
        role: fullEntry.role,
        tool: fullEntry.tool,
        reason: fullEntry.reason,
      });
    } else {
      this.logger.debug('✅ Access allowed', {
        role: fullEntry.role,
        tool: fullEntry.tool,
        durationMs: fullEntry.durationMs,
      });
    }

    return fullEntry;
  }

  /**
   * Log an allowed tool call
   */
  logAllowed(
    sessionId: string,
    role: string,
    tool: string,
    sourceServer: string,
    args: Record<string, unknown>,
    durationMs?: number,
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return this.log({
      sessionId,
      role,
      tool,
      sourceServer,
      args,
      result: 'allowed',
      durationMs,
      metadata,
    });
  }

  /**
   * Log a denied tool call
   */
  logDenied(
    sessionId: string,
    role: string,
    tool: string,
    sourceServer: string,
    args: Record<string, unknown>,
    reason: string,
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return this.log({
      sessionId,
      role,
      tool,
      sourceServer,
      args,
      result: 'denied',
      reason,
      metadata,
    });
  }

  /**
   * Log an error during tool call
   */
  logError(
    sessionId: string,
    role: string,
    tool: string,
    sourceServer: string,
    args: Record<string, unknown>,
    error: string,
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return this.log({
      sessionId,
      role,
      tool,
      sourceServer,
      args,
      result: 'error',
      reason: error,
      metadata,
    });
  }

  /**
   * Query audit logs
   */
  query(options: AuditQueryOptions = {}): AuditLogEntry[] {
    let results = [...this.logs];

    // Apply filters
    if (options.role) {
      results = results.filter((e) => e.role === options.role);
    }
    if (options.tool) {
      results = results.filter((e) => e.tool === options.tool);
    }
    if (options.result) {
      results = results.filter((e) => e.result === options.result);
    }
    if (options.startTime) {
      results = results.filter((e) => e.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      results = results.filter((e) => e.timestamp <= options.endTime!);
    }

    // Sort by timestamp descending (most recent first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get audit statistics
   */
  getStats(): AuditStats {
    const byResult = {
      allowed: 0,
      denied: 0,
      error: 0,
    };

    const toolCounts = new Map<string, number>();
    const roleCounts = new Map<string, number>();
    let totalExecutionTime = 0;
    let executionCount = 0;

    for (const entry of this.logs) {
      // Count by result
      byResult[entry.result]++;

      // Count by tool
      toolCounts.set(entry.tool, (toolCounts.get(entry.tool) ?? 0) + 1);

      // Count by role
      roleCounts.set(entry.role, (roleCounts.get(entry.role) ?? 0) + 1);

      // Sum execution time
      if (entry.durationMs !== undefined) {
        totalExecutionTime += entry.durationMs;
        executionCount++;
      }
    }

    // Sort and get top items
    const topTools = Array.from(toolCounts.entries())
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topRoles = Array.from(roleCounts.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const totalEntries = this.logs.length;
    const denialRate = totalEntries > 0 ? byResult.denied / totalEntries : 0;
    const avgExecutionTimeMs =
      executionCount > 0 ? totalExecutionTime / executionCount : 0;

    return {
      totalEntries,
      byResult,
      topTools,
      topRoles,
      denialRate,
      avgExecutionTimeMs,
    };
  }

  /**
   * Get recent denials (useful for security monitoring)
   */
  getRecentDenials(limit: number = 10): AuditLogEntry[] {
    return this.query({ result: 'denied', limit });
  }

  /**
   * Export logs as JSON
   */
  exportJson(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Export logs as CSV
   */
  exportCsv(): string {
    const headers = [
      'id',
      'timestamp',
      'sessionId',
      'role',
      'tool',
      'sourceServer',
      'result',
      'reason',
      'durationMs',
    ];
    const lines = [headers.join(',')];

    for (const entry of this.logs) {
      const row = [
        entry.id,
        entry.timestamp.toISOString(),
        entry.sessionId,
        entry.role,
        entry.tool,
        entry.sourceServer,
        entry.result,
        entry.reason ?? '',
        entry.durationMs?.toString() ?? '',
      ];
      lines.push(row.map((v) => `"${v}"`).join(','));
    }

    return lines.join('\n');
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
    this.logger.info('Audit logs cleared');
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Sanitize arguments by redacting sensitive values
   */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (SENSITIVE_KEYS.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeArgs(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

/**
 * Create an AuditLogger instance
 */
export function createAuditLogger(
  logger: Logger,
  options?: { maxLogSize?: number }
): AuditLogger {
  return new AuditLogger(logger, options);
}
