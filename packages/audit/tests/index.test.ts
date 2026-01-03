/**
 * Unit tests for @aegis/audit
 * Tests audit logging and rate limiting constants
 */

import { describe, it, expect } from 'vitest';
import { AUDIT_VERSION } from '../src/index.js';

describe('@aegis/audit', () => {
  describe('AUDIT_VERSION', () => {
    it('should be defined', () => {
      expect(AUDIT_VERSION).toBeDefined();
    });

    it('should be a semver string', () => {
      expect(AUDIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should be version 1.0.0', () => {
      expect(AUDIT_VERSION).toBe('1.0.0');
    });
  });

  describe('Future exports (placeholder)', () => {
    it('should document planned AuditLogger export', () => {
      // AuditLogger will be migrated from @aegis/router
      // Expected interface:
      // - log(entry: AuditLogEntry): void
      // - getStats(): AuditStats
      // - getRecentDenials(count: number): AuditLogEntry[]
      // - exportLogs(): AuditLogEntry[]
      // - exportLogsCsv(): string
      expect(true).toBe(true);
    });

    it('should document planned RateLimiter export', () => {
      // RateLimiter will be migrated from @aegis/router
      // Expected interface:
      // - setQuota(roleId: string, quota: RoleQuota): void
      // - checkLimit(roleId: string, toolName: string): boolean
      // - getUsage(roleId: string): QuotaUsage
      // - resetUsage(roleId: string): void
      expect(true).toBe(true);
    });
  });
});
