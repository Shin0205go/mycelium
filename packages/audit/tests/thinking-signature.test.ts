/**
 * Unit tests for Thinking Signature capture in audit logs
 * Tests the capture of extended thinking from Claude Opus 4.5 and similar models
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAuditLogger, AuditLogger, AuditLogEntry } from '../src/audit-logger.js';
import type { ThinkingSignature } from '@mycelium/shared';

// Mock logger for testing
const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('Thinking Signature in Audit Logs', () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    auditLogger = createAuditLogger(mockLogger);
  });

  describe('logAllowed with thinking', () => {
    it('should capture thinking signature in allowed tool calls', () => {
      const thinking: ThinkingSignature = {
        thinking: 'I need to read this file to understand the code structure before making changes.',
        type: 'extended_thinking',
        modelId: 'claude-opus-4-5-20251101',
        thinkingTokens: 150,
        capturedAt: new Date('2025-01-08T12:00:00Z'),
      };

      const entry = auditLogger.logAllowed(
        'session-123',
        'developer',
        'filesystem__read_file',
        'filesystem',
        { path: '/src/index.ts' },
        45,
        undefined,
        thinking
      );

      expect(entry.thinking).toBeDefined();
      expect(entry.thinking?.thinking).toBe(thinking.thinking);
      expect(entry.thinking?.type).toBe('extended_thinking');
      expect(entry.thinking?.modelId).toBe('claude-opus-4-5-20251101');
      expect(entry.thinking?.thinkingTokens).toBe(150);
    });

    it('should work without thinking signature', () => {
      const entry = auditLogger.logAllowed(
        'session-123',
        'developer',
        'filesystem__read_file',
        'filesystem',
        { path: '/src/index.ts' },
        45
      );

      expect(entry.thinking).toBeUndefined();
    });
  });

  describe('logDenied with thinking', () => {
    it('should capture thinking even on denied access', () => {
      const thinking: ThinkingSignature = {
        thinking: 'Attempting to delete the database as requested, but this should be blocked.',
        type: 'extended_thinking',
        modelId: 'claude-opus-4-5-20251101',
        capturedAt: new Date(),
      };

      const entry = auditLogger.logDenied(
        'session-123',
        'guest',
        'database__delete',
        'database',
        {},
        'Tool not accessible for role guest',
        undefined,
        thinking
      );

      expect(entry.result).toBe('denied');
      expect(entry.thinking).toBeDefined();
      expect(entry.thinking?.thinking).toContain('delete the database');
    });
  });

  describe('logError with thinking', () => {
    it('should capture thinking even on error', () => {
      const thinking: ThinkingSignature = {
        thinking: 'Executing write operation to update the configuration file.',
        type: 'chain_of_thought',
        capturedAt: new Date(),
      };

      const entry = auditLogger.logError(
        'session-123',
        'developer',
        'filesystem__write_file',
        'filesystem',
        { path: '/etc/config.json' },
        'Permission denied: cannot write to system directory',
        undefined,
        thinking
      );

      expect(entry.result).toBe('error');
      expect(entry.thinking).toBeDefined();
      expect(entry.thinking?.type).toBe('chain_of_thought');
    });
  });

  describe('query with thinking filter', () => {
    beforeEach(() => {
      // Add entries with and without thinking
      auditLogger.logAllowed(
        'session-1',
        'admin',
        'tool1',
        'server1',
        {},
        10,
        undefined,
        {
          thinking: 'Thinking 1',
          type: 'extended_thinking',
          modelId: 'opus',
          capturedAt: new Date(),
        }
      );

      auditLogger.logAllowed(
        'session-2',
        'guest',
        'tool2',
        'server2',
        {},
        20
      );

      auditLogger.logAllowed(
        'session-3',
        'developer',
        'tool3',
        'server3',
        {},
        15,
        undefined,
        {
          thinking: 'Thinking 3',
          type: 'chain_of_thought',
          capturedAt: new Date(),
        }
      );
    });

    it('should filter entries with thinking', () => {
      const withThinking = auditLogger.query({ hasThinking: true });
      expect(withThinking.length).toBe(2);
      expect(withThinking.every((e) => e.thinking !== undefined)).toBe(true);
    });

    it('should filter entries without thinking', () => {
      const withoutThinking = auditLogger.query({ hasThinking: false });
      expect(withoutThinking.length).toBe(1);
      expect(withoutThinking.every((e) => e.thinking === undefined)).toBe(true);
    });

    it('should filter by thinking type', () => {
      const extendedThinking = auditLogger.query({
        thinkingType: 'extended_thinking',
      });
      expect(extendedThinking.length).toBe(1);
      expect(extendedThinking[0].thinking?.type).toBe('extended_thinking');

      const chainOfThought = auditLogger.query({
        thinkingType: 'chain_of_thought',
      });
      expect(chainOfThought.length).toBe(1);
      expect(chainOfThought[0].thinking?.type).toBe('chain_of_thought');
    });
  });

  describe('getStats with thinking', () => {
    beforeEach(() => {
      // Add mixed entries
      auditLogger.logAllowed('s1', 'admin', 't1', 'srv1', {}, 10, undefined, {
        thinking: 'T1',
        type: 'extended_thinking',
        thinkingTokens: 100,
        capturedAt: new Date(),
      });
      auditLogger.logAllowed('s2', 'guest', 't2', 'srv2', {}, 20);
      auditLogger.logAllowed('s3', 'dev', 't3', 'srv3', {}, 15, undefined, {
        thinking: 'T3',
        type: 'extended_thinking',
        thinkingTokens: 200,
        capturedAt: new Date(),
      });
      auditLogger.logDenied('s4', 'guest', 't4', 'srv4', {}, 'denied', undefined, {
        thinking: 'T4',
        type: 'chain_of_thought',
        thinkingTokens: 50,
        capturedAt: new Date(),
      });
    });

    it('should count entries with thinking', () => {
      const stats = auditLogger.getStats();
      expect(stats.thinkingStats.entriesWithThinking).toBe(3);
    });

    it('should calculate thinking coverage rate', () => {
      const stats = auditLogger.getStats();
      expect(stats.thinkingStats.thinkingCoverageRate).toBe(0.75); // 3/4
    });

    it('should sum total thinking tokens', () => {
      const stats = auditLogger.getStats();
      expect(stats.thinkingStats.totalThinkingTokens).toBe(350); // 100 + 200 + 50
    });

    it('should calculate average thinking tokens', () => {
      const stats = auditLogger.getStats();
      expect(stats.thinkingStats.avgThinkingTokens).toBeCloseTo(116.67, 1); // 350/3
    });

    it('should count by thinking type', () => {
      const stats = auditLogger.getStats();
      expect(stats.thinkingStats.byType.extended_thinking).toBe(2);
      expect(stats.thinkingStats.byType.chain_of_thought).toBe(1);
      expect(stats.thinkingStats.byType.reasoning).toBe(0);
    });
  });

  describe('getEntriesWithThinking', () => {
    it('should return only entries with thinking', () => {
      auditLogger.logAllowed('s1', 'admin', 't1', 'srv1', {}, 10, undefined, {
        thinking: 'Test thinking',
        type: 'extended_thinking',
        capturedAt: new Date(),
      });
      auditLogger.logAllowed('s2', 'guest', 't2', 'srv2', {}, 20);

      const entries = auditLogger.getEntriesWithThinking();
      expect(entries.length).toBe(1);
      expect(entries[0].thinking?.thinking).toBe('Test thinking');
    });
  });

  describe('exportThinkingReport', () => {
    it('should generate a thinking report', () => {
      auditLogger.logAllowed('s1', 'admin', 't1', 'srv1', {}, 10, undefined, {
        thinking: 'This is a detailed thinking process that explains why this tool was called.',
        type: 'extended_thinking',
        modelId: 'claude-opus-4-5-20251101',
        thinkingTokens: 50,
        capturedAt: new Date(),
        summary: 'Tool selection reasoning',
      });

      const reportJson = auditLogger.exportThinkingReport();
      const report = JSON.parse(reportJson);

      expect(report.generatedAt).toBeDefined();
      expect(report.entriesWithThinking).toBe(1);
      expect(report.thinkingCoverageRate).toBe(1);
      expect(report.entries[0].thinking.type).toBe('extended_thinking');
      expect(report.entries[0].thinking.modelId).toBe('claude-opus-4-5-20251101');
      expect(report.entries[0].thinking.summary).toBe('Tool selection reasoning');
    });

    it('should truncate thinking preview to 500 characters', () => {
      const longThinking = 'A'.repeat(1000);

      auditLogger.logAllowed('s1', 'admin', 't1', 'srv1', {}, 10, undefined, {
        thinking: longThinking,
        type: 'extended_thinking',
        capturedAt: new Date(),
      });

      const reportJson = auditLogger.exportThinkingReport();
      const report = JSON.parse(reportJson);

      expect(report.entries[0].thinking.thinkingPreview.length).toBe(500);
      expect(report.entries[0].thinking.fullThinkingLength).toBe(1000);
    });
  });

  describe('exportCsv with thinking', () => {
    it('should include thinking columns in CSV export', () => {
      auditLogger.logAllowed('s1', 'admin', 't1', 'srv1', {}, 10, undefined, {
        thinking: 'Test thinking',
        type: 'extended_thinking',
        thinkingTokens: 100,
        capturedAt: new Date(),
      });

      const csv = auditLogger.exportCsv();
      const lines = csv.split('\n');

      // Check headers
      expect(lines[0]).toContain('hasThinking');
      expect(lines[0]).toContain('thinkingType');
      expect(lines[0]).toContain('thinkingTokens');

      // Check values
      expect(lines[1]).toContain('"true"');
      expect(lines[1]).toContain('"extended_thinking"');
      expect(lines[1]).toContain('"100"');
    });
  });

  describe('Thinking types', () => {
    it('should support extended_thinking type', () => {
      const entry = auditLogger.logAllowed('s', 'r', 't', 'srv', {}, 10, undefined, {
        thinking: 'T',
        type: 'extended_thinking',
        capturedAt: new Date(),
      });
      expect(entry.thinking?.type).toBe('extended_thinking');
    });

    it('should support chain_of_thought type', () => {
      const entry = auditLogger.logAllowed('s', 'r', 't', 'srv', {}, 10, undefined, {
        thinking: 'T',
        type: 'chain_of_thought',
        capturedAt: new Date(),
      });
      expect(entry.thinking?.type).toBe('chain_of_thought');
    });

    it('should support reasoning type', () => {
      const entry = auditLogger.logAllowed('s', 'r', 't', 'srv', {}, 10, undefined, {
        thinking: 'T',
        type: 'reasoning',
        capturedAt: new Date(),
      });
      expect(entry.thinking?.type).toBe('reasoning');
    });
  });

  describe('Cache metrics in thinking', () => {
    it('should capture cache metrics when provided', () => {
      const entry = auditLogger.logAllowed('s', 'r', 't', 'srv', {}, 10, undefined, {
        thinking: 'T',
        type: 'extended_thinking',
        capturedAt: new Date(),
        cacheMetrics: {
          cacheReadTokens: 1000,
          cacheCreationTokens: 500,
        },
      });

      expect(entry.thinking?.cacheMetrics).toBeDefined();
      expect(entry.thinking?.cacheMetrics?.cacheReadTokens).toBe(1000);
      expect(entry.thinking?.cacheMetrics?.cacheCreationTokens).toBe(500);
    });
  });
});
