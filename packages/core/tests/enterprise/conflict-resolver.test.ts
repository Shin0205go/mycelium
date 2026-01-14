// ============================================================================
// AEGIS Enterprise MCP - Conflict Resolver (TSI) Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictResolver,
  createConflictResolver,
} from '../../src/tsi/conflict-resolver.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Logger, ToolSelectionContext } from '@aegis/shared';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Helper to create mock tools
const createMockTool = (name: string, description?: string): Tool => ({
  name,
  description: description || `Description for ${name}`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
});

describe('ConflictResolver', () => {
  let logger: Logger;
  let resolver: ConflictResolver;

  beforeEach(() => {
    logger = createMockLogger();
    resolver = createConflictResolver(logger);
  });

  describe('Tool Registration', () => {
    it('should register tools from a server', () => {
      const tools = [
        createMockTool('read_file'),
        createMockTool('write_file'),
      ];

      resolver.registerTools('filesystem', tools);

      const stats = resolver.getStats();
      // Each tool is stored under both original name and prefixed name
      expect(stats.toolsByServer['filesystem']).toBe(4);
    });

    it('should unregister tools from a server', () => {
      const tools = [createMockTool('read_file')];

      resolver.registerTools('filesystem', tools);
      resolver.unregisterTools('filesystem');

      const stats = resolver.getStats();
      expect(stats.toolsByServer['filesystem']).toBeUndefined();
    });

    it('should clear all tools', () => {
      resolver.registerTools('server1', [createMockTool('tool1')]);
      resolver.registerTools('server2', [createMockTool('tool2')]);

      resolver.clearTools();

      const stats = resolver.getStats();
      expect(stats.totalTools).toBe(0);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect name collision conflicts', () => {
      resolver.registerTools('server1', [createMockTool('search')]);
      resolver.registerTools('server2', [createMockTool('search')]);

      const conflicts = resolver.detectConflicts();

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].toolName).toBe('search');
      expect(conflicts[0].conflictingServers).toContain('server1');
      expect(conflicts[0].conflictingServers).toContain('server2');
    });

    it('should detect multiple conflicts', () => {
      resolver.registerTools('server1', [
        createMockTool('search'),
        createMockTool('read'),
      ]);
      resolver.registerTools('server2', [
        createMockTool('search'),
        createMockTool('read'),
      ]);

      const conflicts = resolver.detectConflicts();

      expect(conflicts.length).toBe(2);
    });

    it('should not report conflicts for unique tools', () => {
      resolver.registerTools('server1', [createMockTool('tool1')]);
      resolver.registerTools('server2', [createMockTool('tool2')]);

      const conflicts = resolver.detectConflicts();

      expect(conflicts.length).toBe(0);
    });

    it('should detect version mismatch when schemas differ', () => {
      const tool1: Tool = {
        name: 'api_call',
        description: 'Make API call',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
        },
      };

      const tool2: Tool = {
        name: 'api_call',
        description: 'Make API call',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            method: { type: 'string' },
          },
        },
      };

      resolver.registerTools('server1', [tool1]);
      resolver.registerTools('server2', [tool2]);

      const conflicts = resolver.detectConflicts();

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflictType).toBe('version-mismatch');
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve conflict with prefix strategy', () => {
      resolver.registerTools('server1', [createMockTool('search')]);
      resolver.registerTools('server2', [createMockTool('search')]);

      const conflicts = resolver.detectConflicts();
      resolver.resolveConflict(conflicts[0], {
        type: 'prefix',
        serverPrefix: 'server1',
      });

      expect(resolver.getResolvedToolName('search', 'server1')).toBe('server1__search');
      expect(resolver.getResolvedToolName('search', 'server2')).toBe('server2__search');
    });

    it('should resolve conflict with priority strategy', () => {
      resolver.registerTools('server1', [createMockTool('search')]);
      resolver.registerTools('server2', [createMockTool('search')]);

      const conflicts = resolver.detectConflicts();
      resolver.resolveConflict(conflicts[0], {
        type: 'priority',
        primaryServer: 'server1',
        fallbackServers: ['server2'],
      });

      // Primary server doesn't need prefix
      expect(resolver.getResolvedToolName('search', 'server1')).toBe('search');
      // Fallback servers get prefix
      expect(resolver.getResolvedToolName('search', 'server2')).toBe('server2__search');
    });

    it('should resolve conflict with hide strategy', () => {
      resolver.registerTools('server1', [createMockTool('search')]);
      resolver.registerTools('server2', [createMockTool('search')]);

      const conflicts = resolver.detectConflicts();
      resolver.resolveConflict(conflicts[0], {
        type: 'hide',
        hiddenServers: ['server2'],
      });

      expect(resolver.getResolvedToolName('search', 'server1')).toBe('server1__search');
      expect(resolver.getResolvedToolName('search', 'server2')).toBe(''); // Hidden
    });

    it('should auto-resolve all conflicts', () => {
      resolver.registerTools('server1', [createMockTool('search')]);
      resolver.registerTools('server2', [createMockTool('search')]);
      resolver.registerTools('server3', [createMockTool('read')]);
      resolver.registerTools('server4', [createMockTool('read')]);

      const resolutions = resolver.autoResolveConflicts();

      expect(resolutions.size).toBe(2);
      expect(resolutions.has('search')).toBe(true);
      expect(resolutions.has('read')).toBe(true);
    });
  });

  describe('Context-Aware Tool Selection (Nexus-MCP)', () => {
    beforeEach(() => {
      // Register many tools to trigger selection
      for (let i = 0; i < 100; i++) {
        resolver.registerTools(`server${i % 5}`, [
          createMockTool(`tool_${i}`, `Tool ${i} for testing`),
        ]);
      }
    });

    it('should limit tools to maxTools', () => {
      const context: ToolSelectionContext = {
        query: '',
        maxTools: 20,
      };

      const result = resolver.selectTools(context);

      expect(result.selectedTools.length).toBeLessThanOrEqual(20);
      expect(result.totalToolsAvailable).toBe(100);
    });

    it('should prioritize recently used tools', () => {
      // Record usage for specific tools
      resolver.recordToolUsage('server0__tool_0');
      resolver.recordToolUsage('server0__tool_0');
      resolver.recordToolUsage('server1__tool_1');

      const context: ToolSelectionContext = {
        query: '',
        recentTools: ['server0__tool_0', 'server1__tool_1'],
        maxTools: 10,
      };

      const result = resolver.selectTools(context);

      // Recent tools should be in the result
      const toolNames = result.selectedTools.map((t) => t.name);
      expect(toolNames).toContain('server0__tool_0');
      expect(toolNames).toContain('server1__tool_1');
    });

    it('should prioritize by server', () => {
      const context: ToolSelectionContext = {
        query: '',
        priorityServers: ['server0'],
        maxTools: 30,
      };

      const result = resolver.selectTools(context);

      // Count tools from server0
      const server0Tools = result.selectedTools.filter((t) =>
        t.name.startsWith('server0__')
      );
      expect(server0Tools.length).toBeGreaterThan(0);
    });

    it('should match by query', () => {
      const context: ToolSelectionContext = {
        query: 'tool_5',
        maxTools: 20,
      };

      const result = resolver.selectTools(context);

      // Should include tools matching the query
      const matchingTools = result.selectedTools.filter((t) =>
        t.name.includes('tool_5')
      );
      expect(matchingTools.length).toBeGreaterThan(0);
    });

    it('should track excluded tools', () => {
      const context: ToolSelectionContext = {
        query: '',
        maxTools: 10,
      };

      const result = resolver.selectTools(context);

      expect(result.excludedTools).toBeDefined();
      expect(result.excludedTools!.length).toBeGreaterThan(0);
    });
  });

  describe('Tool Frequency Tracking', () => {
    it('should track tool usage', () => {
      resolver.registerTools('server1', [createMockTool('popular_tool')]);

      resolver.recordToolUsage('server1__popular_tool', 100, true);
      resolver.recordToolUsage('server1__popular_tool', 150, true);
      resolver.recordToolUsage('server1__popular_tool', 200, false);

      // Usage should be recorded (no direct getter, but affects selection)
      const context: ToolSelectionContext = {
        query: '',
        maxTools: 5,
      };

      const result = resolver.selectTools(context);
      expect(result.selectedTools.length).toBeGreaterThan(0);
    });
  });

  describe('Visibility Overrides', () => {
    it('should hide tools matching pattern', () => {
      resolver.registerTools('server1', [
        createMockTool('admin_delete'),
        createMockTool('admin_create'),
        createMockTool('user_read'),
      ]);

      resolver.addVisibilityOverride({
        pattern: 'admin_*',
        action: 'hide',
      });

      const tools = resolver
        .selectTools({ query: '', maxTools: 10 })
        .selectedTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));

      const filtered = resolver.applyVisibilityOverrides(tools as Tool[], {});

      expect(filtered.find((t) => t.name.includes('admin_delete'))).toBeUndefined();
      expect(filtered.find((t) => t.name.includes('admin_create'))).toBeUndefined();
      expect(filtered.find((t) => t.name.includes('user_read'))).toBeDefined();
    });

    it('should apply role-based visibility', () => {
      resolver.registerTools('server1', [
        createMockTool('admin_tool'),
        createMockTool('user_tool'),
      ]);

      resolver.addVisibilityOverride({
        pattern: 'admin_*',
        action: 'hide',
        condition: {
          roles: ['admin'],
        },
      });

      const tools = resolver
        .selectTools({ query: '', maxTools: 10 })
        .selectedTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));

      // For 'user' role, the condition (roles: ['admin']) doesn't match, so override is skipped
      // This means admin_tool should be VISIBLE for users
      const userFiltered = resolver.applyVisibilityOverrides(tools as Tool[], { role: 'user' });
      expect(userFiltered.find((t) => t.name.includes('admin_tool'))).toBeDefined();

      // For 'admin' role, the condition matches, so the hide override applies
      const adminFiltered = resolver.applyVisibilityOverrides(tools as Tool[], { role: 'admin' });
      expect(adminFiltered.find((t) => t.name.includes('admin_tool'))).toBeUndefined();
    });
  });

  describe('Namespace Management', () => {
    it('should get tools in namespace', () => {
      resolver = createConflictResolver(logger, {
        autoResolve: true,
        defaultStrategy: 'prefix',
        rules: [],
        maxToolsToPresent: 50,
        enableSemanticSelection: false,
        namespaces: {
          namespaces: [
            {
              id: 'backend',
              name: 'Backend',
              description: 'Backend tools',
              prefix: 'be',
              servers: ['database', 'api'],
            },
          ],
          defaultNamespace: 'backend',
        },
      });

      resolver.registerTools('database', [createMockTool('query')]);
      resolver.registerTools('api', [createMockTool('request')]);
      resolver.registerTools('frontend', [createMockTool('render')]);

      const backendTools = resolver.getToolsInNamespace('backend');

      expect(backendTools.length).toBe(2);
      expect(backendTools.some((t) => t.serverName === 'database')).toBe(true);
      expect(backendTools.some((t) => t.serverName === 'api')).toBe(true);
    });

    it('should list namespaces', () => {
      resolver = createConflictResolver(logger, {
        autoResolve: true,
        defaultStrategy: 'prefix',
        rules: [],
        maxToolsToPresent: 50,
        enableSemanticSelection: false,
        namespaces: {
          namespaces: [
            { id: 'ns1', name: 'NS1', description: '', prefix: '', servers: [] },
            { id: 'ns2', name: 'NS2', description: '', prefix: '', servers: [] },
          ],
        },
      });

      const namespaces = resolver.getNamespaces();

      expect(namespaces).toContain('ns1');
      expect(namespaces).toContain('ns2');
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', () => {
      resolver.registerTools('server1', [
        createMockTool('tool1'),
        createMockTool('shared'),
      ]);
      resolver.registerTools('server2', [
        createMockTool('tool2'),
        createMockTool('shared'),
      ]);

      resolver.autoResolveConflicts();

      const stats = resolver.getStats();

      // Tools are stored under both original name and prefixed name
      expect(stats.totalTools).toBe(8); // 4 entries from each server (2 tools x 2 entries)
      expect(stats.conflictCount).toBe(1); // 'shared' conflicts
      expect(stats.resolvedConflicts).toBe(1);
      expect(stats.toolsByServer['server1']).toBe(4);
      expect(stats.toolsByServer['server2']).toBe(4);
    });
  });
});
