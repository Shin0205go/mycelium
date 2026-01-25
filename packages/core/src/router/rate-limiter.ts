// ============================================================================
// MYCELIUM - RateLimiter Stub
// Minimal implementation for skill-based worker pattern
// ============================================================================

import type { Logger } from '@mycelium/shared';

export interface RoleQuota {
  maxCallsPerMinute?: number;
  maxCallsPerHour?: number;
  maxConcurrent?: number;
  toolLimits?: Record<string, { maxCallsPerMinute?: number }>;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export interface RateLimitEvent {
  type: 'limit_exceeded' | 'quota_reset';
  roleId: string;
  toolName?: string;
  timestamp: Date;
}

/**
 * RateLimiter - Controls request rates per role/session
 */
export class RateLimiter {
  private logger: Logger;
  private quotas = new Map<string, RoleQuota>();
  private callCounts = new Map<string, { minute: number; hour: number; lastReset: Date }>();
  private concurrentCounts = new Map<string, number>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  setQuota(roleId: string, quota: RoleQuota): void {
    this.quotas.set(roleId, quota);
  }

  setQuotas(quotas: Record<string, RoleQuota>): void {
    for (const [roleId, quota] of Object.entries(quotas)) {
      this.setQuota(roleId, quota);
    }
  }

  check(roleId: string, sessionId: string, toolName: string): RateLimitResult {
    const quota = this.quotas.get(roleId);
    if (!quota) {
      return { allowed: true };
    }

    const key = `${roleId}:${sessionId}`;
    const counts = this.getOrCreateCounts(key);
    this.maybeResetCounts(counts);

    // Check per-minute limit
    if (quota.maxCallsPerMinute && counts.minute >= quota.maxCallsPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${quota.maxCallsPerMinute} calls/minute`,
        retryAfterMs: 60000 - (Date.now() - counts.lastReset.getTime()),
      };
    }

    // Check per-hour limit
    if (quota.maxCallsPerHour && counts.hour >= quota.maxCallsPerHour) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${quota.maxCallsPerHour} calls/hour`,
      };
    }

    // Check concurrent limit
    if (quota.maxConcurrent) {
      const concurrent = this.concurrentCounts.get(key) || 0;
      if (concurrent >= quota.maxConcurrent) {
        return {
          allowed: false,
          reason: `Concurrent limit exceeded: ${quota.maxConcurrent}`,
        };
      }
    }

    return { allowed: true };
  }

  consume(roleId: string, sessionId: string, toolName: string): void {
    const key = `${roleId}:${sessionId}`;
    const counts = this.getOrCreateCounts(key);
    counts.minute++;
    counts.hour++;
  }

  startConcurrent(sessionId: string): void {
    const current = this.concurrentCounts.get(sessionId) || 0;
    this.concurrentCounts.set(sessionId, current + 1);
  }

  endConcurrent(sessionId: string): void {
    const current = this.concurrentCounts.get(sessionId) || 0;
    this.concurrentCounts.set(sessionId, Math.max(0, current - 1));
  }

  private getOrCreateCounts(key: string) {
    let counts = this.callCounts.get(key);
    if (!counts) {
      counts = { minute: 0, hour: 0, lastReset: new Date() };
      this.callCounts.set(key, counts);
    }
    return counts;
  }

  private maybeResetCounts(counts: { minute: number; hour: number; lastReset: Date }): void {
    const now = Date.now();
    const elapsed = now - counts.lastReset.getTime();

    // Reset minute counter every minute
    if (elapsed >= 60000) {
      counts.minute = 0;
      counts.lastReset = new Date();
    }

    // Reset hour counter every hour
    if (elapsed >= 3600000) {
      counts.hour = 0;
    }
  }
}

export function createRateLimiter(logger: Logger): RateLimiter {
  return new RateLimiter(logger);
}
