// ============================================================================
// MYCELIUM - AuditLogger Stub
// Minimal implementation for skill-based worker pattern
// ============================================================================

import type { Logger, ThinkingSignature } from '@mycelium/shared';

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  sessionId: string;
  roleId: string;
  toolName: string;
  sourceServer: string;
  arguments: Record<string, unknown>;
  result: 'allowed' | 'denied' | 'error';
  reason?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  thinkingSignature?: ThinkingSignature;
}

export interface AuditQueryOptions {
  sessionId?: string;
  roleId?: string;
  toolName?: string;
  result?: 'allowed' | 'denied' | 'error';
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  hasThinking?: boolean;
  thinkingType?: ThinkingSignature['type'];
}

export interface AuditStats {
  totalEntries: number;
  allowedCount: number;
  deniedCount: number;
  errorCount: number;
  byRole: Record<string, number>;
  byTool: Record<string, number>;
  thinkingStats?: {
    entriesWithThinking: number;
    thinkingCoverageRate: number;
    totalThinkingTokens: number;
    avgThinkingTokens: number;
    byType: Record<string, number>;
  };
}

/**
 * AuditLogger - Logs tool access for compliance and debugging
 */
export class AuditLogger {
  private logger: Logger;
  private entries: AuditLogEntry[] = [];
  private maxEntries: number = 10000;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  private generateId(): string {
    return `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  logAllowed(
    sessionId: string,
    roleId: string,
    toolName: string,
    sourceServer: string,
    args: Record<string, unknown>,
    durationMs?: number,
    metadata?: Record<string, unknown>,
    thinkingSignature?: ThinkingSignature
  ): void {
    this.addEntry({
      id: this.generateId(),
      timestamp: new Date(),
      sessionId,
      roleId,
      toolName,
      sourceServer,
      arguments: args,
      result: 'allowed',
      durationMs,
      metadata,
      thinkingSignature,
    });
  }

  logDenied(
    sessionId: string,
    roleId: string,
    toolName: string,
    sourceServer: string,
    args: Record<string, unknown>,
    reason: string,
    metadata?: Record<string, unknown>,
    thinkingSignature?: ThinkingSignature
  ): void {
    this.addEntry({
      id: this.generateId(),
      timestamp: new Date(),
      sessionId,
      roleId,
      toolName,
      sourceServer,
      arguments: args,
      result: 'denied',
      reason,
      metadata,
      thinkingSignature,
    });
    this.logger.warn(`Access denied: ${toolName} for role ${roleId} - ${reason}`);
  }

  logError(
    sessionId: string,
    roleId: string,
    toolName: string,
    sourceServer: string,
    args: Record<string, unknown>,
    errorMessage: string,
    metadata?: Record<string, unknown>,
    thinkingSignature?: ThinkingSignature
  ): void {
    this.addEntry({
      id: this.generateId(),
      timestamp: new Date(),
      sessionId,
      roleId,
      toolName,
      sourceServer,
      arguments: args,
      result: 'error',
      reason: errorMessage,
      metadata,
      thinkingSignature,
    });
  }

  private addEntry(entry: AuditLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  query(options: AuditQueryOptions = {}): AuditLogEntry[] {
    let results = [...this.entries];

    if (options.sessionId) {
      results = results.filter(e => e.sessionId === options.sessionId);
    }
    if (options.roleId) {
      results = results.filter(e => e.roleId === options.roleId);
    }
    if (options.toolName) {
      results = results.filter(e => e.toolName === options.toolName);
    }
    if (options.result) {
      results = results.filter(e => e.result === options.result);
    }
    if (options.hasThinking !== undefined) {
      results = results.filter(e => options.hasThinking ? !!e.thinkingSignature : !e.thinkingSignature);
    }
    if (options.thinkingType) {
      results = results.filter(e => e.thinkingSignature?.type === options.thinkingType);
    }
    if (options.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  getStats(): AuditStats {
    const byRole: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    let allowedCount = 0;
    let deniedCount = 0;
    let errorCount = 0;
    let entriesWithThinking = 0;
    let totalThinkingTokens = 0;
    const byThinkingType: Record<string, number> = {};

    for (const entry of this.entries) {
      byRole[entry.roleId] = (byRole[entry.roleId] || 0) + 1;
      byTool[entry.toolName] = (byTool[entry.toolName] || 0) + 1;

      switch (entry.result) {
        case 'allowed': allowedCount++; break;
        case 'denied': deniedCount++; break;
        case 'error': errorCount++; break;
      }

      if (entry.thinkingSignature) {
        entriesWithThinking++;
        totalThinkingTokens += entry.thinkingSignature.thinkingTokens || 0;
        const type = entry.thinkingSignature.type;
        byThinkingType[type] = (byThinkingType[type] || 0) + 1;
      }
    }

    return {
      totalEntries: this.entries.length,
      allowedCount,
      deniedCount,
      errorCount,
      byRole,
      byTool,
      thinkingStats: {
        entriesWithThinking,
        thinkingCoverageRate: this.entries.length > 0 ? entriesWithThinking / this.entries.length : 0,
        totalThinkingTokens,
        avgThinkingTokens: entriesWithThinking > 0 ? totalThinkingTokens / entriesWithThinking : 0,
        byType: byThinkingType,
      },
    };
  }

  getRecentDenials(limit: number = 10): AuditLogEntry[] {
    return this.query({ result: 'denied', limit });
  }

  getEntriesWithThinking(limit: number = 50): AuditLogEntry[] {
    return this.query({ hasThinking: true, limit });
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  exportCsv(): string {
    const headers = ['timestamp', 'sessionId', 'roleId', 'toolName', 'result', 'reason'];
    const rows = this.entries.map(e =>
      [e.timestamp.toISOString(), e.sessionId, e.roleId, e.toolName, e.result, e.reason || ''].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  exportThinkingReport(): string {
    const entriesWithThinking = this.getEntriesWithThinking(100);
    return JSON.stringify(entriesWithThinking.map(e => ({
      timestamp: e.timestamp,
      tool: e.toolName,
      role: e.roleId,
      thinking: e.thinkingSignature?.thinking,
      thinkingType: e.thinkingSignature?.type,
    })), null, 2);
  }
}

export function createAuditLogger(logger: Logger): AuditLogger {
  return new AuditLogger(logger);
}
