/**
 * Unit tests for audit-logger.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogger, createAuditLogger } from '@aegis/audit';
import type { Logger } from '@aegis/shared';

// Silent test logger
const createTestLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('AuditLogger', () => {
  let logger: Logger;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    logger = createTestLogger();
    auditLogger = new AuditLogger(logger);
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const al = new AuditLogger(logger);
      expect(al.isEnabled()).toBe(true);
    });

    it('should create with custom maxLogSize', () => {
      const al = new AuditLogger(logger, { maxLogSize: 100 });
      expect(al.isEnabled()).toBe(true);
    });
  });

  describe('createAuditLogger factory', () => {
    it('should create AuditLogger instance', () => {
      const al = createAuditLogger(logger);
      expect(al).toBeInstanceOf(AuditLogger);
    });
  });

  describe('enable/disable', () => {
    it('should enable logging', () => {
      auditLogger.disable();
      expect(auditLogger.isEnabled()).toBe(false);
      auditLogger.enable();
      expect(auditLogger.isEnabled()).toBe(true);
    });

    it('should disable logging', () => {
      expect(auditLogger.isEnabled()).toBe(true);
      auditLogger.disable();
      expect(auditLogger.isEnabled()).toBe(false);
    });
  });

  describe('logAllowed', () => {
    it('should log allowed access', () => {
      const entry = auditLogger.logAllowed(
        'session-1',
        'admin',
        'filesystem__read_file',
        'filesystem',
        { path: '/test.txt' },
        150
      );

      expect(entry.id).toMatch(/^audit_/);
      expect(entry.sessionId).toBe('session-1');
      expect(entry.role).toBe('admin');
      expect(entry.tool).toBe('filesystem__read_file');
      expect(entry.sourceServer).toBe('filesystem');
      expect(entry.result).toBe('allowed');
      expect(entry.durationMs).toBe(150);
    });

    it('should include metadata if provided', () => {
      const entry = auditLogger.logAllowed(
        'session-1',
        'admin',
        'tool',
        'server',
        {},
        100,
        { custom: 'data' }
      );

      expect(entry.metadata).toEqual({ custom: 'data' });
    });
  });

  describe('logDenied', () => {
    it('should log denied access', () => {
      const entry = auditLogger.logDenied(
        'session-1',
        'guest',
        'admin__delete_all',
        'admin',
        {},
        'Permission denied'
      );

      expect(entry.result).toBe('denied');
      expect(entry.reason).toBe('Permission denied');
    });
  });

  describe('logError', () => {
    it('should log error', () => {
      const entry = auditLogger.logError(
        'session-1',
        'admin',
        'broken__tool',
        'broken',
        {},
        'Connection timeout'
      );

      expect(entry.result).toBe('error');
      expect(entry.reason).toBe('Connection timeout');
    });
  });

  describe('sensitive data sanitization', () => {
    it('should redact password fields', () => {
      const entry = auditLogger.logAllowed(
        'session-1',
        'admin',
        'tool',
        'server',
        { username: 'user', password: 'secret123' }
      );

      expect(entry.args.username).toBe('user');
      expect(entry.args.password).toBe('[REDACTED]');
    });

    it('should redact api_key fields', () => {
      const entry = auditLogger.logAllowed(
        'session-1',
        'admin',
        'tool',
        'server',
        { api_key: 'sk-12345' }
      );

      expect(entry.args.api_key).toBe('[REDACTED]');
    });

    it('should redact nested sensitive fields', () => {
      const entry = auditLogger.logAllowed(
        'session-1',
        'admin',
        'tool',
        'server',
        { config: { token: 'abc123', name: 'test' } }
      );

      const config = entry.args.config as Record<string, unknown>;
      expect(config.token).toBe('[REDACTED]');
      expect(config.name).toBe('test');
    });
  });

  describe('disabled logging', () => {
    it('should not store entries when disabled', () => {
      auditLogger.disable();

      auditLogger.logAllowed('s1', 'admin', 'tool', 'server', {});
      auditLogger.logDenied('s1', 'guest', 'tool', 'server', {}, 'denied');

      const stats = auditLogger.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('should return empty entry with no id when disabled', () => {
      auditLogger.disable();

      const entry = auditLogger.logAllowed('s1', 'admin', 'tool', 'server', {});

      expect(entry.id).toBe('');
    });
  });

  describe('max log size', () => {
    it('should trim logs when exceeding max size', () => {
      const al = new AuditLogger(logger, { maxLogSize: 3 });

      al.logAllowed('s1', 'admin', 'tool1', 'server', {});
      al.logAllowed('s2', 'admin', 'tool2', 'server', {});
      al.logAllowed('s3', 'admin', 'tool3', 'server', {});
      al.logAllowed('s4', 'admin', 'tool4', 'server', {});

      const stats = al.getStats();
      expect(stats.totalEntries).toBe(3);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      auditLogger.logAllowed('s1', 'admin', 'tool1', 'server1', {});
      auditLogger.logDenied('s1', 'guest', 'tool2', 'server2', {}, 'denied');
      auditLogger.logError('s2', 'admin', 'tool3', 'server1', {}, 'error');
      auditLogger.logAllowed('s2', 'guest', 'tool1', 'server1', {});
    });

    it('should return all logs by default', () => {
      const results = auditLogger.query();
      expect(results.length).toBe(4);
    });

    it('should filter by role', () => {
      const results = auditLogger.query({ role: 'admin' });
      expect(results.length).toBe(2);
      expect(results.every(r => r.role === 'admin')).toBe(true);
    });

    it('should filter by tool', () => {
      const results = auditLogger.query({ tool: 'tool1' });
      expect(results.length).toBe(2);
    });

    it('should filter by result', () => {
      const results = auditLogger.query({ result: 'denied' });
      expect(results.length).toBe(1);
      expect(results[0].result).toBe('denied');
    });

    it('should apply limit', () => {
      const results = auditLogger.query({ limit: 2 });
      expect(results.length).toBe(2);
    });

    it('should apply offset', () => {
      const all = auditLogger.query();
      const offset = auditLogger.query({ offset: 2 });
      expect(offset.length).toBe(2);
      expect(offset[0].id).toBe(all[2].id);
    });

    it('should sort by timestamp descending', () => {
      const results = auditLogger.query();
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].timestamp.getTime())
          .toBeGreaterThanOrEqual(results[i].timestamp.getTime());
      }
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      auditLogger.logAllowed('s1', 'admin', 'tool1', 'server', {}, 100);
      auditLogger.logAllowed('s1', 'admin', 'tool1', 'server', {}, 200);
      auditLogger.logDenied('s1', 'guest', 'tool2', 'server', {}, 'denied');
      auditLogger.logError('s2', 'admin', 'tool3', 'server', {}, 'error');
    });

    it('should return correct total entries', () => {
      const stats = auditLogger.getStats();
      expect(stats.totalEntries).toBe(4);
    });

    it('should return correct counts by result', () => {
      const stats = auditLogger.getStats();
      expect(stats.byResult.allowed).toBe(2);
      expect(stats.byResult.denied).toBe(1);
      expect(stats.byResult.error).toBe(1);
    });

    it('should return top tools', () => {
      const stats = auditLogger.getStats();
      expect(stats.topTools[0].tool).toBe('tool1');
      expect(stats.topTools[0].count).toBe(2);
    });

    it('should return top roles', () => {
      const stats = auditLogger.getStats();
      expect(stats.topRoles[0].role).toBe('admin');
      expect(stats.topRoles[0].count).toBe(3);
    });

    it('should calculate denial rate', () => {
      const stats = auditLogger.getStats();
      expect(stats.denialRate).toBe(0.25); // 1 denied out of 4
    });

    it('should calculate average execution time', () => {
      const stats = auditLogger.getStats();
      expect(stats.avgExecutionTimeMs).toBe(150); // (100 + 200) / 2
    });
  });

  describe('getRecentDenials', () => {
    it('should return recent denials', () => {
      auditLogger.logAllowed('s1', 'admin', 'tool', 'server', {});
      auditLogger.logDenied('s1', 'guest', 'tool1', 'server', {}, 'denied1');
      auditLogger.logDenied('s1', 'guest', 'tool2', 'server', {}, 'denied2');

      const denials = auditLogger.getRecentDenials(10);
      expect(denials.length).toBe(2);
      expect(denials.every(d => d.result === 'denied')).toBe(true);
    });
  });

  describe('exportJson', () => {
    it('should export logs as JSON', () => {
      auditLogger.logAllowed('s1', 'admin', 'tool', 'server', { key: 'value' });

      const json = auditLogger.exportJson();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].role).toBe('admin');
    });
  });

  describe('exportCsv', () => {
    it('should export logs as CSV', () => {
      auditLogger.logAllowed('s1', 'admin', 'tool', 'server', {}, 100);

      const csv = auditLogger.exportCsv();
      const lines = csv.split('\n');

      expect(lines[0]).toBe('id,timestamp,sessionId,role,tool,sourceServer,result,reason,durationMs');
      expect(lines[1]).toContain('"admin"');
      expect(lines[1]).toContain('"tool"');
      expect(lines[1]).toContain('"allowed"');
    });
  });

  describe('clear', () => {
    it('should clear all logs', () => {
      auditLogger.logAllowed('s1', 'admin', 'tool', 'server', {});
      auditLogger.logAllowed('s2', 'admin', 'tool', 'server', {});

      expect(auditLogger.getStats().totalEntries).toBe(2);

      auditLogger.clear();

      expect(auditLogger.getStats().totalEntries).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit logged event on log', () => {
      const handler = vi.fn();
      auditLogger.on('logged', handler);

      auditLogger.logAllowed('s1', 'admin', 'tool', 'server', {});

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].result).toBe('allowed');
    });
  });
});
