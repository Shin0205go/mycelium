/**
 * Unit tests for mcp/tool-discovery.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolDiscoveryService, type ToolSource, type DiscoveredTool } from '../src/mcp/tool-discovery.js';
import type { Logger } from '@aegis/shared';

// Silent test logger
const createTestLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('ToolDiscoveryService', () => {
  let logger: Logger;
  let service: ToolDiscoveryService;

  beforeEach(() => {
    logger = createTestLogger();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      service = new ToolDiscoveryService({}, logger);
      expect(service).toBeInstanceOf(ToolDiscoveryService);
    });

    it('should register native tools by default', () => {
      service = new ToolDiscoveryService({}, logger);
      const tools = service.getAllTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should not register native tools when disabled', () => {
      service = new ToolDiscoveryService({ includeNativeTools: false }, logger);
      const tools = service.getAllTools();
      expect(tools.length).toBe(0);
    });

    it('should apply custom policy control config', () => {
      service = new ToolDiscoveryService({
        policyControl: {
          defaultEnabled: false,
          exceptions: ['TestTool']
        }
      }, logger);
      expect(service).toBeInstanceOf(ToolDiscoveryService);
    });
  });

  describe('native tools', () => {
    beforeEach(() => {
      service = new ToolDiscoveryService({}, logger);
    });

    it('should register all Claude Code native tools', () => {
      const tools = service.getAllTools();
      const nativeTools = tools.filter(t => t.source.type === 'native');

      expect(nativeTools.length).toBeGreaterThan(0);
    });

    it('should prefix native tools with native__', () => {
      const tool = service.getTool('native__Bash');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('native__Bash');
    });

    it('should set high risk tools as policy controlled', () => {
      const bash = service.getTool('native__Bash');
      expect(bash?.source.policyControlled).toBe(true);
    });

    it('should include tool descriptions', () => {
      const bash = service.getTool('native__Bash');
      expect(bash?.description).toBe('Executes shell commands');
    });

    it('should include risk metadata', () => {
      const bash = service.getTool('native__Bash');
      expect(bash?.metadata?.risk).toBe('high');

      const read = service.getTool('native__Read');
      expect(read?.metadata?.risk).toBe('low');
    });
  });

  describe('registerToolFromClient', () => {
    beforeEach(() => {
      service = new ToolDiscoveryService({ includeNativeTools: false }, logger);
    });

    it('should register tool from MCP client', () => {
      service.registerToolFromClient(
        { name: 'test_tool', description: 'A test tool' },
        'test-server'
      );

      const tool = service.getTool('test_tool');
      expect(tool).toBeDefined();
      expect(tool?.description).toBe('A test tool');
    });

    it('should set source as discovered', () => {
      service.registerToolFromClient(
        { name: 'test_tool' },
        'test-server'
      );

      const tool = service.getTool('test_tool');
      expect(tool?.source.type).toBe('discovered');
      expect(tool?.source.name).toBe('test-server');
    });

    it('should include discoveredAt metadata', () => {
      service.registerToolFromClient(
        { name: 'test_tool' },
        'test-server'
      );

      const tool = service.getTool('test_tool');
      expect(tool?.metadata?.discoveredAt).toBeDefined();
    });

    it('should not register when includeDiscoveredTools is false', () => {
      service = new ToolDiscoveryService({
        includeNativeTools: false,
        includeDiscoveredTools: false
      }, logger);

      service.registerToolFromClient(
        { name: 'test_tool' },
        'test-server'
      );

      expect(service.getTool('test_tool')).toBeUndefined();
    });
  });

  describe('registerConfiguredTool', () => {
    beforeEach(() => {
      service = new ToolDiscoveryService({ includeNativeTools: false }, logger);
    });

    it('should register configured tool with server prefix', () => {
      service.registerConfiguredTool(
        { name: 'read_file', description: 'Reads a file' },
        'filesystem'
      );

      const tool = service.getTool('filesystem__read_file');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('filesystem__read_file');
    });

    it('should set source as configured', () => {
      service.registerConfiguredTool(
        { name: 'read_file' },
        'filesystem'
      );

      const tool = service.getTool('filesystem__read_file');
      expect(tool?.source.type).toBe('configured');
    });

    it('should store original name in metadata', () => {
      service.registerConfiguredTool(
        { name: 'read_file' },
        'filesystem'
      );

      const tool = service.getTool('filesystem__read_file');
      expect(tool?.metadata?.originalName).toBe('read_file');
      expect(tool?.metadata?.serverName).toBe('filesystem');
    });
  });

  describe('getTool', () => {
    beforeEach(() => {
      service = new ToolDiscoveryService({}, logger);
    });

    it('should return tool by name', () => {
      const tool = service.getTool('native__Bash');
      expect(tool).toBeDefined();
    });

    it('should return undefined for unknown tool', () => {
      const tool = service.getTool('unknown_tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('getAllTools', () => {
    it('should return all registered tools', () => {
      service = new ToolDiscoveryService({}, logger);
      const tools = service.getAllTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should return empty array when no tools', () => {
      service = new ToolDiscoveryService({ includeNativeTools: false }, logger);
      const tools = service.getAllTools();
      expect(tools).toEqual([]);
    });
  });

  describe('getPolicyControlledTools', () => {
    beforeEach(() => {
      service = new ToolDiscoveryService({}, logger);
    });

    it('should return only policy controlled tools', () => {
      const controlled = service.getPolicyControlledTools();
      expect(controlled.every(t => t.source.policyControlled)).toBe(true);
    });

    it('should include high risk native tools', () => {
      const controlled = service.getPolicyControlledTools();
      const bashTool = controlled.find(t => t.name === 'native__Bash');
      expect(bashTool).toBeDefined();
    });
  });

  describe('assessToolRisk', () => {
    beforeEach(() => {
      service = new ToolDiscoveryService({ includeNativeTools: false }, logger);
    });

    it('should return risk from metadata if available', () => {
      service.registerConfiguredTool(
        { name: 'custom_tool' },
        'test'
      );
      // Override metadata
      const tool = service.getTool('test__custom_tool');
      if (tool) {
        tool.metadata = { ...tool.metadata, risk: 'high' };
      }

      expect(service.assessToolRisk('test__custom_tool')).toBe('high');
    });

    it('should detect high risk from tool name patterns', () => {
      service.registerConfiguredTool({ name: 'bash_exec' }, 'server');
      expect(service.assessToolRisk('server__bash_exec')).toBe('high');

      service.registerConfiguredTool({ name: 'web_fetch' }, 'server');
      expect(service.assessToolRisk('server__web_fetch')).toBe('high');
    });

    it('should detect medium risk from tool name patterns', () => {
      service.registerConfiguredTool({ name: 'file_write' }, 'server');
      expect(service.assessToolRisk('server__file_write')).toBe('medium');

      service.registerConfiguredTool({ name: 'delete_record' }, 'server');
      expect(service.assessToolRisk('server__delete_record')).toBe('medium');
    });

    it('should default to low risk', () => {
      service.registerConfiguredTool({ name: 'list_items' }, 'server');
      expect(service.assessToolRisk('server__list_items')).toBe('low');
    });

    it('should return medium for unknown tools', () => {
      expect(service.assessToolRisk('nonexistent_tool')).toBe('medium');
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      service = new ToolDiscoveryService({}, logger);
    });

    it('should return total tool count', () => {
      const stats = service.getStats();
      expect(stats.totalTools).toBeGreaterThan(0);
    });

    it('should return tools by source type', () => {
      const stats = service.getStats();
      expect(stats.bySource).toBeDefined();
      expect(stats.bySource.native).toBeGreaterThan(0);
    });

    it('should return policy controlled count', () => {
      const stats = service.getStats();
      expect(stats.policyControlled).toBeGreaterThanOrEqual(0);
    });

    it('should return risk distribution', () => {
      const stats = service.getStats();
      expect(stats.riskDistribution).toBeDefined();
      expect(stats.riskDistribution.low).toBeGreaterThanOrEqual(0);
      expect(stats.riskDistribution.medium).toBeGreaterThanOrEqual(0);
      expect(stats.riskDistribution.high).toBeGreaterThanOrEqual(0);
    });
  });

  describe('policy control', () => {
    it('should respect exceptions list', () => {
      service = new ToolDiscoveryService({
        policyControl: {
          defaultEnabled: true,
          exceptions: ['TodoRead', 'TodoWrite']
        }
      }, logger);

      const todoRead = service.getTool('native__TodoRead');
      expect(todoRead?.source.policyControlled).toBe(false);
    });

    it('should respect toolPolicies config', () => {
      service = new ToolDiscoveryService({
        includeNativeTools: false,
        policyControl: {
          defaultEnabled: false,
          exceptions: [],
          toolPolicies: {
            'special_tool': { enabled: true }
          }
        }
      }, logger);

      service.registerConfiguredTool({ name: 'special_tool' }, 'server');
      const tool = service.getTool('server__special_tool');
      expect(tool?.source.policyControlled).toBe(true);
    });

    it('should respect pattern matching', () => {
      service = new ToolDiscoveryService({
        includeNativeTools: false,
        policyControl: {
          defaultEnabled: false,
          exceptions: [],
          patterns: [
            { pattern: '^admin_', enabled: true }
          ]
        }
      }, logger);

      service.registerConfiguredTool({ name: 'admin_delete' }, 'server');
      const tool = service.getTool('server__admin_delete');
      expect(tool?.source.policyControlled).toBe(true);
    });
  });
});
