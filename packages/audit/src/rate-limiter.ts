// ============================================================================
// AEGIS Audit - Rate Limiter
// Provides quota and rate limiting per role/session
// ============================================================================

import { Logger } from '@aegis/shared';
import { EventEmitter } from 'events';

/**
 * Quota configuration for a role
 */
export interface RoleQuota {
  /** Maximum tool calls per minute */
  maxCallsPerMinute?: number;

  /** Maximum tool calls per hour */
  maxCallsPerHour?: number;

  /** Maximum tool calls per day */
  maxCallsPerDay?: number;

  /** Maximum concurrent tool calls */
  maxConcurrent?: number;

  /** Specific tool limits */
  toolLimits?: Record<string, {
    maxCallsPerMinute?: number;
    maxCallsPerHour?: number;
  }>;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;

  /** Reason if denied */
  reason?: string;

  /** Time until reset (ms) */
  retryAfterMs?: number;

  /** Current usage stats */
  usage: {
    callsThisMinute: number;
    callsThisHour: number;
    callsThisDay: number;
    concurrent: number;
  };

  /** Configured limits */
  limits: {
    perMinute?: number;
    perHour?: number;
    perDay?: number;
    concurrent?: number;
  };
}

/**
 * Rate limit event
 */
export interface RateLimitEvent {
  type: 'exceeded' | 'warning';
  role: string;
  sessionId: string;
  tool?: string;
  usage: number;
  limit: number;
  windowType: 'minute' | 'hour' | 'day' | 'concurrent';
}

/**
 * Internal tracking structure
 */
interface UsageTracker {
  // Sliding window counters
  minuteWindow: { count: number; resetAt: number };
  hourWindow: { count: number; resetAt: number };
  dayWindow: { count: number; resetAt: number };

  // Concurrent tracking
  concurrent: number;

  // Per-tool tracking
  toolUsage: Map<string, {
    minuteWindow: { count: number; resetAt: number };
    hourWindow: { count: number; resetAt: number };
  }>;
}

/**
 * RateLimiter - Enforces quotas and rate limits
 */
export class RateLimiter extends EventEmitter {
  private logger: Logger;
  private quotas: Map<string, RoleQuota> = new Map();
  private usage: Map<string, UsageTracker> = new Map();
  private enabled: boolean = true;

  // Warning thresholds (percentage of limit)
  private warningThreshold: number = 0.8;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.logger.debug('RateLimiter initialized');
  }

  /**
   * Enable rate limiting
   */
  enable(): void {
    this.enabled = true;
    this.logger.info('Rate limiting enabled');
  }

  /**
   * Disable rate limiting
   */
  disable(): void {
    this.enabled = false;
    this.logger.info('Rate limiting disabled');
  }

  /**
   * Check if rate limiting is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set quota for a role
   */
  setQuota(roleId: string, quota: RoleQuota): void {
    this.quotas.set(roleId, quota);
    this.logger.info(`Quota set for role: ${roleId}`, quota as unknown as Record<string, unknown>);
  }

  /**
   * Set quotas for multiple roles
   */
  setQuotas(quotas: Record<string, RoleQuota>): void {
    for (const [roleId, quota] of Object.entries(quotas)) {
      this.setQuota(roleId, quota);
    }
  }

  /**
   * Get quota for a role
   */
  getQuota(roleId: string): RoleQuota | undefined {
    return this.quotas.get(roleId);
  }

  /**
   * Check if a request is allowed (does not consume quota)
   */
  check(roleId: string, sessionId: string, tool?: string): RateLimitResult {
    if (!this.enabled) {
      return this.createAllowedResult(roleId, sessionId);
    }

    const quota = this.quotas.get(roleId);
    if (!quota) {
      // No quota defined = unlimited
      return this.createAllowedResult(roleId, sessionId);
    }

    const tracker = this.getOrCreateTracker(sessionId);
    this.cleanupExpiredWindows(tracker);

    const now = Date.now();

    // Check per-minute limit
    if (quota.maxCallsPerMinute !== undefined) {
      if (tracker.minuteWindow.count >= quota.maxCallsPerMinute) {
        return this.createDeniedResult(
          roleId,
          sessionId,
          tracker,
          quota,
          'minute',
          tracker.minuteWindow.resetAt - now
        );
      }
    }

    // Check per-hour limit
    if (quota.maxCallsPerHour !== undefined) {
      if (tracker.hourWindow.count >= quota.maxCallsPerHour) {
        return this.createDeniedResult(
          roleId,
          sessionId,
          tracker,
          quota,
          'hour',
          tracker.hourWindow.resetAt - now
        );
      }
    }

    // Check per-day limit
    if (quota.maxCallsPerDay !== undefined) {
      if (tracker.dayWindow.count >= quota.maxCallsPerDay) {
        return this.createDeniedResult(
          roleId,
          sessionId,
          tracker,
          quota,
          'day',
          tracker.dayWindow.resetAt - now
        );
      }
    }

    // Check concurrent limit
    if (quota.maxConcurrent !== undefined) {
      if (tracker.concurrent >= quota.maxConcurrent) {
        return this.createDeniedResult(
          roleId,
          sessionId,
          tracker,
          quota,
          'concurrent',
          0
        );
      }
    }

    // Check tool-specific limits
    if (tool && quota.toolLimits?.[tool]) {
      const toolLimit = quota.toolLimits[tool];
      const toolUsage = this.getOrCreateToolUsage(tracker, tool);

      if (toolLimit.maxCallsPerMinute !== undefined) {
        if (toolUsage.minuteWindow.count >= toolLimit.maxCallsPerMinute) {
          return {
            allowed: false,
            reason: `Tool '${tool}' rate limit exceeded (${toolLimit.maxCallsPerMinute}/min)`,
            retryAfterMs: toolUsage.minuteWindow.resetAt - now,
            usage: this.getUsageStats(tracker),
            limits: this.getLimits(quota),
          };
        }
      }
    }

    return this.createAllowedResult(roleId, sessionId, tracker, quota);
  }

  /**
   * Consume quota for a request (call after check passes)
   */
  consume(roleId: string, sessionId: string, tool?: string): void {
    if (!this.enabled) return;

    const tracker = this.getOrCreateTracker(sessionId);
    this.cleanupExpiredWindows(tracker);

    const now = Date.now();

    // Increment counters
    tracker.minuteWindow.count++;
    tracker.hourWindow.count++;
    tracker.dayWindow.count++;

    // Set reset times if needed
    if (tracker.minuteWindow.resetAt <= now) {
      tracker.minuteWindow.resetAt = now + 60 * 1000;
    }
    if (tracker.hourWindow.resetAt <= now) {
      tracker.hourWindow.resetAt = now + 60 * 60 * 1000;
    }
    if (tracker.dayWindow.resetAt <= now) {
      tracker.dayWindow.resetAt = now + 24 * 60 * 60 * 1000;
    }

    // Increment tool-specific counters
    if (tool) {
      const toolUsage = this.getOrCreateToolUsage(tracker, tool);
      toolUsage.minuteWindow.count++;
      toolUsage.hourWindow.count++;

      if (toolUsage.minuteWindow.resetAt <= now) {
        toolUsage.minuteWindow.resetAt = now + 60 * 1000;
      }
      if (toolUsage.hourWindow.resetAt <= now) {
        toolUsage.hourWindow.resetAt = now + 60 * 60 * 1000;
      }
    }

    // Check for warnings
    this.checkWarnings(roleId, sessionId, tracker);
  }

  /**
   * Start a concurrent operation
   */
  startConcurrent(sessionId: string): void {
    if (!this.enabled) return;

    const tracker = this.getOrCreateTracker(sessionId);
    tracker.concurrent++;
  }

  /**
   * End a concurrent operation
   */
  endConcurrent(sessionId: string): void {
    if (!this.enabled) return;

    const tracker = this.usage.get(sessionId);
    if (tracker && tracker.concurrent > 0) {
      tracker.concurrent--;
    }
  }

  /**
   * Get current usage for a session
   */
  getUsage(sessionId: string): RateLimitResult['usage'] {
    const tracker = this.usage.get(sessionId);
    if (!tracker) {
      return {
        callsThisMinute: 0,
        callsThisHour: 0,
        callsThisDay: 0,
        concurrent: 0,
      };
    }
    return this.getUsageStats(tracker);
  }

  /**
   * Reset usage for a session
   */
  resetUsage(sessionId: string): void {
    this.usage.delete(sessionId);
    this.logger.info(`Usage reset for session: ${sessionId}`);
  }

  /**
   * Reset all usage
   */
  resetAllUsage(): void {
    this.usage.clear();
    this.logger.info('All usage reset');
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private getOrCreateTracker(sessionId: string): UsageTracker {
    let tracker = this.usage.get(sessionId);
    if (!tracker) {
      const now = Date.now();
      tracker = {
        minuteWindow: { count: 0, resetAt: now + 60 * 1000 },
        hourWindow: { count: 0, resetAt: now + 60 * 60 * 1000 },
        dayWindow: { count: 0, resetAt: now + 24 * 60 * 60 * 1000 },
        concurrent: 0,
        toolUsage: new Map(),
      };
      this.usage.set(sessionId, tracker);
    }
    return tracker;
  }

  private getOrCreateToolUsage(
    tracker: UsageTracker,
    tool: string
  ): UsageTracker['toolUsage'] extends Map<string, infer T> ? T : never {
    let toolUsage = tracker.toolUsage.get(tool);
    if (!toolUsage) {
      const now = Date.now();
      toolUsage = {
        minuteWindow: { count: 0, resetAt: now + 60 * 1000 },
        hourWindow: { count: 0, resetAt: now + 60 * 60 * 1000 },
      };
      tracker.toolUsage.set(tool, toolUsage);
    }
    return toolUsage;
  }

  private cleanupExpiredWindows(tracker: UsageTracker): void {
    const now = Date.now();

    if (tracker.minuteWindow.resetAt <= now) {
      tracker.minuteWindow.count = 0;
      tracker.minuteWindow.resetAt = now + 60 * 1000;
    }
    if (tracker.hourWindow.resetAt <= now) {
      tracker.hourWindow.count = 0;
      tracker.hourWindow.resetAt = now + 60 * 60 * 1000;
    }
    if (tracker.dayWindow.resetAt <= now) {
      tracker.dayWindow.count = 0;
      tracker.dayWindow.resetAt = now + 24 * 60 * 60 * 1000;
    }

    // Cleanup tool windows
    for (const [tool, toolUsage] of tracker.toolUsage) {
      if (toolUsage.minuteWindow.resetAt <= now) {
        toolUsage.minuteWindow.count = 0;
        toolUsage.minuteWindow.resetAt = now + 60 * 1000;
      }
      if (toolUsage.hourWindow.resetAt <= now) {
        toolUsage.hourWindow.count = 0;
        toolUsage.hourWindow.resetAt = now + 60 * 60 * 1000;
      }
    }
  }

  private getUsageStats(tracker: UsageTracker): RateLimitResult['usage'] {
    return {
      callsThisMinute: tracker.minuteWindow.count,
      callsThisHour: tracker.hourWindow.count,
      callsThisDay: tracker.dayWindow.count,
      concurrent: tracker.concurrent,
    };
  }

  private getLimits(quota: RoleQuota): RateLimitResult['limits'] {
    return {
      perMinute: quota.maxCallsPerMinute,
      perHour: quota.maxCallsPerHour,
      perDay: quota.maxCallsPerDay,
      concurrent: quota.maxConcurrent,
    };
  }

  private createAllowedResult(
    roleId: string,
    sessionId: string,
    tracker?: UsageTracker,
    quota?: RoleQuota
  ): RateLimitResult {
    const usage = tracker ? this.getUsageStats(tracker) : {
      callsThisMinute: 0,
      callsThisHour: 0,
      callsThisDay: 0,
      concurrent: 0,
    };
    const limits = quota ? this.getLimits(quota) : {};

    return {
      allowed: true,
      usage,
      limits,
    };
  }

  private createDeniedResult(
    roleId: string,
    sessionId: string,
    tracker: UsageTracker,
    quota: RoleQuota,
    windowType: 'minute' | 'hour' | 'day' | 'concurrent',
    retryAfterMs: number
  ): RateLimitResult {
    const windowNames = {
      minute: 'per minute',
      hour: 'per hour',
      day: 'per day',
      concurrent: 'concurrent',
    };

    const limits = {
      minute: quota.maxCallsPerMinute,
      hour: quota.maxCallsPerHour,
      day: quota.maxCallsPerDay,
      concurrent: quota.maxConcurrent,
    };

    const limit = limits[windowType] ?? 0;
    const reason = `Rate limit exceeded: ${limit} calls ${windowNames[windowType]}`;

    // Emit event
    const event: RateLimitEvent = {
      type: 'exceeded',
      role: roleId,
      sessionId,
      usage: this.getUsageForWindow(tracker, windowType),
      limit,
      windowType,
    };
    this.emit('exceeded', event);

    this.logger.warn(`🚫 Rate limit exceeded`, {
      role: roleId,
      session: sessionId,
      window: windowType,
      limit,
    });

    return {
      allowed: false,
      reason,
      retryAfterMs: Math.max(0, retryAfterMs),
      usage: this.getUsageStats(tracker),
      limits: this.getLimits(quota),
    };
  }

  private getUsageForWindow(
    tracker: UsageTracker,
    windowType: 'minute' | 'hour' | 'day' | 'concurrent'
  ): number {
    switch (windowType) {
      case 'minute':
        return tracker.minuteWindow.count;
      case 'hour':
        return tracker.hourWindow.count;
      case 'day':
        return tracker.dayWindow.count;
      case 'concurrent':
        return tracker.concurrent;
    }
  }

  private checkWarnings(
    roleId: string,
    sessionId: string,
    tracker: UsageTracker
  ): void {
    const quota = this.quotas.get(roleId);
    if (!quota) return;

    const checks: Array<{
      current: number;
      limit: number | undefined;
      window: 'minute' | 'hour' | 'day';
    }> = [
      { current: tracker.minuteWindow.count, limit: quota.maxCallsPerMinute, window: 'minute' },
      { current: tracker.hourWindow.count, limit: quota.maxCallsPerHour, window: 'hour' },
      { current: tracker.dayWindow.count, limit: quota.maxCallsPerDay, window: 'day' },
    ];

    for (const check of checks) {
      if (check.limit !== undefined) {
        const ratio = check.current / check.limit;
        if (ratio >= this.warningThreshold && ratio < 1) {
          const event: RateLimitEvent = {
            type: 'warning',
            role: roleId,
            sessionId,
            usage: check.current,
            limit: check.limit,
            windowType: check.window,
          };
          this.emit('warning', event);

          this.logger.warn(`⚠️ Rate limit warning: ${Math.round(ratio * 100)}% of ${check.window} quota used`, {
            role: roleId,
            session: sessionId,
          });
        }
      }
    }
  }
}

/**
 * Create a RateLimiter instance
 */
export function createRateLimiter(logger: Logger): RateLimiter {
  return new RateLimiter(logger);
}
