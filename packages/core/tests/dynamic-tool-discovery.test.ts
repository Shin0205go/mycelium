/**
 * Unit tests for mcp/dynamic-tool-discovery.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DynamicToolDiscoveryService, type ToolDiscoveryConfig } from '../src/mcp/dynamic-tool-discovery.js';
import type { Logger } from '@mycelium/shared';

// Silent test logger
const createTestLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createDefaultConfig = (): ToolDiscoveryConfig => ({
  discovery: {
    enableAutoDiscovery: true,
    enableToolIntrospection: true,
  },
  policyControl: {
    defaultMode: 'allowlist',
  },
});

describe('DynamicToolDiscoveryService', () => {
  let logger: Logger;
  let service: DynamicToolDiscoveryService;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createTestLogger();
    service = new DynamicToolDiscoveryService(createDefaultConfig(), logger);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create service with config', () => {
      expect(service).toBeInstanceOf(DynamicToolDiscoveryService);
    });

    it('should set up refresh interval when configured', () => {
      const config = {
        ...createDefaultConfig(),
        discovery: {
          enableAutoDiscovery: true,
          enableToolIntrospection: true,
          refreshInterval: 5000,
        },
      };

      const svc = new DynamicToolDiscoveryService(config, logger);
      expect(svc).toBeInstanceOf(DynamicToolDiscoveryService);
    });
  });

  describe('discoverToolsFromHandshake', () => {
    it('should discover tools from handshake data', async () => {
      await service.discoverToolsFromHandshake({
        capabilities: {},
        tools: [
          { name: 'test_tool', description: 'A test tool' },
        ],
      });

      const tool = service.getTool('test_tool');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('test_tool');
    });

    it('should not discover when auto discovery is disabled', async () => {
      const config = {
        ...createDefaultConfig(),
        discovery: {
          enableAutoDiscovery: false,
          enableToolIntrospection: false,
        },
      };
      service = new DynamicToolDiscoveryService(config, logger);

      await service.discoverToolsFromHandshake({
        tools: [{ name: 'test_tool' }],
      });

      expect(service.getTool('test_tool')).toBeUndefined();
    });
  });

  describe('discoverToolsFromListResponse', () => {
    it('should discover tools from list response', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'list_tool', description: 'From list' }] },
        'test-server'
      );

      const tool = service.getTool('list_tool');
      expect(tool).toBeDefined();
      expect(tool?.source.origin).toBe('test-server');
    });

    it('should handle empty response', async () => {
      await service.discoverToolsFromListResponse({}, 'test-server');
      // Should not throw
    });
  });

  describe('discoverToolFromExecution', () => {
    it('should discover tool from execution', async () => {
      await service.discoverToolFromExecution(
        { name: 'exec_tool' },
        'runtime'
      );

      const tool = service.getTool('exec_tool');
      expect(tool).toBeDefined();
    });

    it('should not rediscover existing tools', async () => {
      await service.discoverToolFromExecution({ name: 'tool1' }, 'source1');
      await service.discoverToolFromExecution({ name: 'tool1' }, 'source2');

      const tool = service.getTool('tool1');
      expect(tool?.source.origin).toBe('source1');
    });

    it('should support tool property instead of name', async () => {
      await service.discoverToolFromExecution({ tool: 'alt_tool' }, 'runtime');

      const tool = service.getTool('alt_tool');
      expect(tool).toBeDefined();
    });
  });

  describe('risk assessment', () => {
    it('should assess high risk for bash/shell tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'bash_exec' }] },
        'test'
      );

      const tool = service.getTool('bash_exec');
      expect(tool?.metadata?.riskAssessment).toBe('high');
    });

    it('should assess high risk for web/fetch tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'web_request' }] },
        'test'
      );

      const tool = service.getTool('web_request');
      expect(tool?.metadata?.riskAssessment).toBe('high');
    });

    it('should assess medium risk for write tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'file_write' }] },
        'test'
      );

      const tool = service.getTool('file_write');
      expect(tool?.metadata?.riskAssessment).toBe('medium');
    });

    it('should assess low risk for read tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'read_file' }] },
        'test'
      );

      const tool = service.getTool('read_file');
      expect(tool?.metadata?.riskAssessment).toBe('low');
    });

    it('should consider description in risk assessment', async () => {
      // The risk pattern /(delete|remove|destroy|drop)/i matches anywhere in text
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'safe_tool', description: 'will delete all files' }] },
        'test'
      );

      const tool = service.getTool('safe_tool');
      expect(tool?.metadata?.riskAssessment).toBe('high');
    });

    it('should use custom high risk patterns', async () => {
      const config: ToolDiscoveryConfig = {
        discovery: { enableAutoDiscovery: true, enableToolIntrospection: true },
        policyControl: {
          defaultMode: 'smart',
          smartRules: {
            highRiskPatterns: ['dangerous'],
            lowRiskPatterns: [],
            trustedOrigins: [],
          },
        },
      };
      service = new DynamicToolDiscoveryService(config, logger);

      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'dangerous_operation' }] },
        'test'
      );

      const tool = service.getTool('dangerous_operation');
      expect(tool?.metadata?.riskAssessment).toBe('high');
    });
  });

  describe('categorization', () => {
    it('should categorize filesystem tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'read_file' }] },
        'test'
      );

      const tool = service.getTool('read_file');
      expect(tool?.metadata?.category).toBe('filesystem');
    });

    it('should categorize execution tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'run_shell' }] },
        'test'
      );

      const tool = service.getTool('run_shell');
      expect(tool?.metadata?.category).toBe('execution');
    });

    it('should categorize network tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'http_get' }] },
        'test'
      );

      const tool = service.getTool('http_get');
      expect(tool?.metadata?.category).toBe('network');
    });

    it('should categorize vcs tools', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'git_commit' }] },
        'test'
      );

      const tool = service.getTool('git_commit');
      expect(tool?.metadata?.category).toBe('vcs');
    });

    it('should default to general category', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'unknown_tool' }] },
        'test'
      );

      const tool = service.getTool('unknown_tool');
      expect(tool?.metadata?.category).toBe('general');
    });
  });

  describe('source type classification', () => {
    it('should classify proxy sources', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'tool' }] },
        'proxy-server'
      );

      const tool = service.getTool('tool');
      expect(tool?.source.type).toBe('proxy');
    });

    it('should classify client sources', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'tool' }] },
        'claude-code'
      );

      const tool = service.getTool('tool');
      expect(tool?.source.type).toBe('client');
    });

    it('should default to builtin', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'tool' }] },
        'internal'
      );

      const tool = service.getTool('tool');
      expect(tool?.source.type).toBe('builtin');
    });
  });

  describe('policy configuration', () => {
    it('should apply policy overrides', async () => {
      const config: ToolDiscoveryConfig = {
        discovery: { enableAutoDiscovery: true, enableToolIntrospection: true },
        policyControl: {
          defaultMode: 'allowlist',
          overrides: {
            'special_.*': { enforced: false, policy: 'custom' },
          },
        },
      };
      service = new DynamicToolDiscoveryService(config, logger);

      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'special_tool' }] },
        'test'
      );

      const tool = service.getTool('special_tool');
      expect(tool?.policyConfig?.enforced).toBe(false);
      expect(tool?.policyConfig?.customPolicy).toBe('custom');
    });

    it('should use smart mode for high risk untrusted tools', async () => {
      const config: ToolDiscoveryConfig = {
        discovery: { enableAutoDiscovery: true, enableToolIntrospection: true },
        policyControl: {
          defaultMode: 'smart',
          smartRules: {
            highRiskPatterns: [],
            lowRiskPatterns: [],
            trustedOrigins: ['trusted-server'],
          },
        },
      };
      service = new DynamicToolDiscoveryService(config, logger);

      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'bash_exec' }] },
        'untrusted-server'
      );

      const tool = service.getTool('bash_exec');
      expect(tool?.policyConfig?.enforced).toBe(true);
    });

    it('should use denylist mode default', async () => {
      const config: ToolDiscoveryConfig = {
        discovery: { enableAutoDiscovery: true, enableToolIntrospection: true },
        policyControl: {
          defaultMode: 'denylist',
        },
      };
      service = new DynamicToolDiscoveryService(config, logger);

      await service.discoverToolsFromListResponse(
        { tools: [{ name: 'some_tool' }] },
        'test'
      );

      const tool = service.getTool('some_tool');
      expect(tool?.policyConfig?.enforced).toBe(false);
    });
  });

  describe('getTool', () => {
    it('should return undefined for unknown tool', () => {
      expect(service.getTool('nonexistent')).toBeUndefined();
    });
  });

  describe('getToolsByCategory', () => {
    it('should return tools by category', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [
          { name: 'read_file' },
          { name: 'write_directory' },
        ] },
        'test'
      );

      const fsTools = service.getToolsByCategory('filesystem');
      expect(fsTools).toContain('read_file');
      expect(fsTools).toContain('write_directory');
    });

    it('should return empty array for unknown category', () => {
      const tools = service.getToolsByCategory('unknown');
      expect(tools).toEqual([]);
    });
  });

  describe('getToolsByRiskLevel', () => {
    it('should return tools by risk level', async () => {
      await service.discoverToolsFromListResponse(
        { tools: [
          { name: 'bash_exec' },
          { name: 'read_file' },
        ] },
        'test'
      );

      const highRisk = service.getToolsByRiskLevel('high');
      const lowRisk = service.getToolsByRiskLevel('low');

      expect(highRisk.some(t => t.name === 'bash_exec')).toBe(true);
      expect(lowRisk.some(t => t.name === 'read_file')).toBe(true);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await service.discoverToolsFromListResponse(
        { tools: [
          { name: 'bash_exec' },
          { name: 'file_write' },
          { name: 'read_file' },
        ] },
        'test-server'
      );
    });

    it('should return total discovered count', () => {
      const stats = service.getStats();
      expect(stats.totalDiscovered).toBe(3);
    });

    it('should return by source counts', () => {
      const stats = service.getStats();
      expect(stats.bySource['test-server']).toBe(3);
    });

    it('should return by category counts', () => {
      const stats = service.getStats();
      expect(stats.byCategory).toBeDefined();
    });

    it('should return by risk level counts', () => {
      const stats = service.getStats();
      expect(stats.byRiskLevel.high).toBeGreaterThan(0);
      expect(stats.byRiskLevel.low).toBeGreaterThan(0);
    });

    it('should return policy enforced count', () => {
      const stats = service.getStats();
      expect(stats.policyEnforced).toBeGreaterThanOrEqual(0);
    });

    it('should return last discovery time', () => {
      const stats = service.getStats();
      expect(stats.lastDiscovery).toBeInstanceOf(Date);
    });
  });
});
