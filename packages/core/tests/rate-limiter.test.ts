/**
 * Unit tests for rate-limiter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, createRateLimiter, type RoleQuota } from '../src/router/rate-limiter.js';
import type { Logger } from '@aegis/shared';

// Silent test logger
const createTestLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('RateLimiter', () => {
  let logger: Logger;
  let limiter: RateLimiter;

  beforeEach(() => {
    logger = createTestLogger();
    limiter = new RateLimiter(logger);
  });

  describe('constructor', () => {
    it('should create with logging enabled', () => {
      const rl = new RateLimiter(logger);
      expect(rl.isEnabled()).toBe(true);
    });
  });

  describe('createRateLimiter factory', () => {
    it('should create RateLimiter instance', () => {
      const rl = createRateLimiter(logger);
      expect(rl).toBeInstanceOf(RateLimiter);
    });
  });

  describe('enable/disable', () => {
    it('should enable rate limiting', () => {
      limiter.disable();
      expect(limiter.isEnabled()).toBe(false);
      limiter.enable();
      expect(limiter.isEnabled()).toBe(true);
    });

    it('should disable rate limiting', () => {
      expect(limiter.isEnabled()).toBe(true);
      limiter.disable();
      expect(limiter.isEnabled()).toBe(false);
    });
  });

  describe('quota management', () => {
    it('should set quota for a role', () => {
      const quota: RoleQuota = { maxCallsPerMinute: 10 };
      limiter.setQuota('guest', quota);

      expect(limiter.getQuota('guest')).toEqual(quota);
    });

    it('should set quotas for multiple roles', () => {
      limiter.setQuotas({
        guest: { maxCallsPerMinute: 10 },
        admin: { maxCallsPerMinute: 100 },
      });

      expect(limiter.getQuota('guest')?.maxCallsPerMinute).toBe(10);
      expect(limiter.getQuota('admin')?.maxCallsPerMinute).toBe(100);
    });

    it('should return undefined for undefined quota', () => {
      expect(limiter.getQuota('unknown')).toBeUndefined();
    });
  });

  describe('check - no quota', () => {
    it('should allow when no quota defined', () => {
      const result = limiter.check('guest', 'session-1');

      expect(result.allowed).toBe(true);
    });

    it('should allow when disabled', () => {
      limiter.setQuota('guest', { maxCallsPerMinute: 1 });
      limiter.disable();

      const result = limiter.check('guest', 'session-1');

      expect(result.allowed).toBe(true);
    });
  });

  describe('check - per minute limit', () => {
    beforeEach(() => {
      limiter.setQuota('guest', { maxCallsPerMinute: 3 });
    });

    it('should allow when under limit', () => {
      const result = limiter.check('guest', 'session-1');
      expect(result.allowed).toBe(true);
    });

    it('should deny when at limit', () => {
      // Consume quota
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');

      const result = limiter.check('guest', 'session-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('per minute');
    });
  });

  describe('check - per hour limit', () => {
    beforeEach(() => {
      limiter.setQuota('guest', { maxCallsPerHour: 2 });
    });

    it('should deny when at hour limit', () => {
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');

      const result = limiter.check('guest', 'session-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('per hour');
    });
  });

  describe('check - per day limit', () => {
    beforeEach(() => {
      limiter.setQuota('guest', { maxCallsPerDay: 2 });
    });

    it('should deny when at day limit', () => {
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');

      const result = limiter.check('guest', 'session-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('per day');
    });
  });

  describe('check - concurrent limit', () => {
    beforeEach(() => {
      limiter.setQuota('guest', { maxConcurrent: 2 });
    });

    it('should allow when under concurrent limit', () => {
      limiter.startConcurrent('session-1');

      const result = limiter.check('guest', 'session-1');
      expect(result.allowed).toBe(true);
    });

    it('should deny when at concurrent limit', () => {
      limiter.startConcurrent('session-1');
      limiter.startConcurrent('session-1');

      const result = limiter.check('guest', 'session-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('concurrent');
    });

    it('should allow after concurrent operation ends', () => {
      limiter.startConcurrent('session-1');
      limiter.startConcurrent('session-1');
      limiter.endConcurrent('session-1');

      const result = limiter.check('guest', 'session-1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('check - tool-specific limits', () => {
    beforeEach(() => {
      limiter.setQuota('guest', {
        maxCallsPerMinute: 100,
        toolLimits: {
          'expensive_tool': { maxCallsPerMinute: 2 },
        },
      });
    });

    it('should apply tool-specific limit', () => {
      limiter.consume('guest', 'session-1', 'expensive_tool');
      limiter.consume('guest', 'session-1', 'expensive_tool');

      const result = limiter.check('guest', 'session-1', 'expensive_tool');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('expensive_tool');
    });

    it('should not affect other tools', () => {
      limiter.consume('guest', 'session-1', 'expensive_tool');
      limiter.consume('guest', 'session-1', 'expensive_tool');

      const result = limiter.check('guest', 'session-1', 'other_tool');
      expect(result.allowed).toBe(true);
    });
  });

  describe('consume', () => {
    it('should increment counters', () => {
      limiter.setQuota('guest', { maxCallsPerMinute: 10 });

      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage.callsThisMinute).toBe(2);
      expect(usage.callsThisHour).toBe(2);
      expect(usage.callsThisDay).toBe(2);
    });

    it('should not consume when disabled', () => {
      limiter.disable();
      limiter.consume('guest', 'session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage.callsThisMinute).toBe(0);
    });
  });

  describe('concurrent tracking', () => {
    it('should track concurrent operations', () => {
      limiter.startConcurrent('session-1');
      limiter.startConcurrent('session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage.concurrent).toBe(2);
    });

    it('should decrement on end', () => {
      limiter.startConcurrent('session-1');
      limiter.startConcurrent('session-1');
      limiter.endConcurrent('session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage.concurrent).toBe(1);
    });

    it('should not go below zero', () => {
      limiter.endConcurrent('session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage.concurrent).toBe(0);
    });

    it('should not track when disabled', () => {
      limiter.disable();
      limiter.startConcurrent('session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage.concurrent).toBe(0);
    });
  });

  describe('getUsage', () => {
    it('should return zero usage for unknown session', () => {
      const usage = limiter.getUsage('unknown');

      expect(usage.callsThisMinute).toBe(0);
      expect(usage.callsThisHour).toBe(0);
      expect(usage.callsThisDay).toBe(0);
      expect(usage.concurrent).toBe(0);
    });
  });

  describe('resetUsage', () => {
    it('should reset usage for a session', () => {
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');

      limiter.resetUsage('session-1');

      const usage = limiter.getUsage('session-1');
      expect(usage.callsThisMinute).toBe(0);
    });
  });

  describe('resetAllUsage', () => {
    it('should reset all usage', () => {
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-2');

      limiter.resetAllUsage();

      expect(limiter.getUsage('session-1').callsThisMinute).toBe(0);
      expect(limiter.getUsage('session-2').callsThisMinute).toBe(0);
    });
  });

  describe('result structure', () => {
    it('should include usage in result', () => {
      limiter.setQuota('guest', { maxCallsPerMinute: 10 });
      limiter.consume('guest', 'session-1');

      const result = limiter.check('guest', 'session-1');

      expect(result.usage).toBeDefined();
      expect(result.usage.callsThisMinute).toBe(1);
    });

    it('should include limits in result', () => {
      limiter.setQuota('guest', {
        maxCallsPerMinute: 10,
        maxCallsPerHour: 100,
        maxConcurrent: 5,
      });

      const result = limiter.check('guest', 'session-1');

      expect(result.limits.perMinute).toBe(10);
      expect(result.limits.perHour).toBe(100);
      expect(result.limits.concurrent).toBe(5);
    });

    it('should include retryAfterMs when denied', () => {
      limiter.setQuota('guest', { maxCallsPerMinute: 1 });
      limiter.consume('guest', 'session-1');

      const result = limiter.check('guest', 'session-1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeDefined();
      expect(typeof result.retryAfterMs).toBe('number');
    });
  });

  describe('events', () => {
    it('should emit exceeded event when limit exceeded', () => {
      const handler = vi.fn();
      limiter.on('exceeded', handler);
      limiter.setQuota('guest', { maxCallsPerMinute: 1 });
      limiter.consume('guest', 'session-1');

      limiter.check('guest', 'session-1');

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0][0];
      expect(event.type).toBe('exceeded');
      expect(event.role).toBe('guest');
    });

    it('should emit warning event near limit', () => {
      const handler = vi.fn();
      limiter.on('warning', handler);
      limiter.setQuota('guest', { maxCallsPerMinute: 10 });

      // Consume 80% of quota
      for (let i = 0; i < 8; i++) {
        limiter.consume('guest', 'session-1');
      }

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0][0];
      expect(event.type).toBe('warning');
    });
  });

  describe('window expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should reset minute counter after 1 minute', () => {
      limiter.setQuota('guest', { maxCallsPerMinute: 2 });
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');

      // Should be denied now
      expect(limiter.check('guest', 'session-1').allowed).toBe(false);

      // Advance time by 1 minute
      vi.advanceTimersByTime(60 * 1000 + 1);

      // Should be allowed again
      expect(limiter.check('guest', 'session-1').allowed).toBe(true);
    });

    it('should reset hour counter after 1 hour', () => {
      limiter.setQuota('guest', { maxCallsPerHour: 2 });
      limiter.consume('guest', 'session-1');
      limiter.consume('guest', 'session-1');

      expect(limiter.check('guest', 'session-1').allowed).toBe(false);

      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      expect(limiter.check('guest', 'session-1').allowed).toBe(true);
    });
  });
});
