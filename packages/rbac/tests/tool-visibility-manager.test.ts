// ============================================================================
// Tool Visibility Manager Tests
// Tests for role-based tool visibility filtering
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolVisibilityManager } from '../src/tool-visibility-manager.js';
import { RoleManager } from '../src/role-manager.js';
import type { Logger, SkillManifest, BaseSkillDefinition } from '@aegis/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('ToolVisibilityManager', () => {
  let roleManager: RoleManager;
  let toolVisibility: ToolVisibilityManager;

  beforeEach(async () => {
    roleManager = new RoleManager(testLogger);
    await roleManager.initialize();
    toolVisibility = new ToolVisibilityManager(testLogger, roleManager);
  });

  describe('Tool Registration', () => {
    it('should register tools from a list', () => {
      const tools: Tool[] = [
        { name: 'server1__tool1', description: 'Tool 1', inputSchema: { type: 'object' } },
        { name: 'server1__tool2', description: 'Tool 2', inputSchema: { type: 'object' } },
        { name: 'server2__tool3', description: 'Tool 3', inputSchema: { type: 'object' } },
      ];

      toolVisibility.registerToolsFromList(tools);

      expect(toolVisibility.getTotalCount()).toBe(3);
    });

    it('should parse tool names correctly', () => {
      const result1 = toolVisibility.parseToolName('server__toolname');
      expect(result1.serverName).toBe('server');
      expect(result1.originalName).toBe('toolname');

      // mcp__ prefix is now normalized before parsing
      // mcp__server__tool__action has 4 parts ['mcp', 'server', 'tool', 'action']
      // After normalization: parts.slice(2) = ['tool', 'action'] -> 'tool__action'
      // Then parseToolName: serverName = 'tool', originalName = 'action'
      const result2 = toolVisibility.parseToolName('mcp__server__tool__action');
      expect(result2.serverName).toBe('tool');
      expect(result2.originalName).toBe('action');

      // Three-part mcp tool name (mcp__server__tool) normalizes to just 'tool'
      const result3 = toolVisibility.parseToolName('mcp__plugin_fs_filesystem__read_file');
      expect(result3.serverName).toBe('unknown');
      expect(result3.originalName).toBe('read_file');

      const result4 = toolVisibility.parseToolName('standalone');
      expect(result4.serverName).toBe('unknown');
      expect(result4.originalName).toBe('standalone');
    });

    it('should clear all tools', () => {
      const tools: Tool[] = [
        { name: 'server__tool1', description: 'Tool 1', inputSchema: { type: 'object' } },
      ];

      toolVisibility.registerToolsFromList(tools);
      expect(toolVisibility.getTotalCount()).toBe(1);

      toolVisibility.clearTools();
      expect(toolVisibility.getTotalCount()).toBe(0);
      expect(toolVisibility.getVisibleCount()).toBe(0);
    });
  });

  describe('Role-based Visibility', () => {
    const mockSkillManifest: SkillManifest<BaseSkillDefinition> = {
      skills: [
        {
          id: 'skill1',
          displayName: 'Skill 1',
          description: 'Test skill 1',
          allowedRoles: ['developer'],
          allowedTools: ['filesystem__read_file', 'filesystem__write_file']
        },
        {
          id: 'skill2',
          displayName: 'Skill 2',
          description: 'Test skill 2',
          allowedRoles: ['admin'],
          allowedTools: ['database__query', 'database__execute']
        }
      ],
      version: '1.0.0',
      generatedAt: new Date()
    };

    beforeEach(async () => {
      await roleManager.loadFromSkillManifest(mockSkillManifest);

      const tools: Tool[] = [
        { name: 'filesystem__read_file', description: 'Read file', inputSchema: { type: 'object' } },
        { name: 'filesystem__write_file', description: 'Write file', inputSchema: { type: 'object' } },
        { name: 'database__query', description: 'Query DB', inputSchema: { type: 'object' } },
        { name: 'database__execute', description: 'Execute SQL', inputSchema: { type: 'object' } },
      ];

      toolVisibility.registerToolsFromList(tools);
    });

    it('should show all tools when no role is set', () => {
      toolVisibility.setCurrentRole(null);
      // 4 tools + set_role system tool
      expect(toolVisibility.getVisibleCount()).toBe(5);
    });

    it('should filter tools based on role', () => {
      const developerRole = roleManager.getRole('developer');
      expect(developerRole).toBeDefined();

      toolVisibility.setCurrentRole(developerRole!);

      // Only filesystem tools + set_role
      expect(toolVisibility.getVisibleCount()).toBe(3);
      expect(toolVisibility.isVisible('filesystem__read_file')).toBe(true);
      expect(toolVisibility.isVisible('filesystem__write_file')).toBe(true);
      expect(toolVisibility.isVisible('database__query')).toBe(false);
      expect(toolVisibility.isVisible('set_role')).toBe(true);
    });

    it('should return added/removed tools on role switch', () => {
      const developerRole = roleManager.getRole('developer');
      const adminRole = roleManager.getRole('admin');

      // Set initial role
      toolVisibility.setCurrentRole(developerRole!);

      // Switch to admin
      const changes = toolVisibility.setCurrentRole(adminRole!);

      expect(changes.added).toContain('database__query');
      expect(changes.added).toContain('database__execute');
      expect(changes.removed).toContain('filesystem__read_file');
      expect(changes.removed).toContain('filesystem__write_file');
    });

    it('should always include set_role system tool', () => {
      const developerRole = roleManager.getRole('developer');
      toolVisibility.setCurrentRole(developerRole!);

      expect(toolVisibility.isVisible('set_role')).toBe(true);

      const visibleTools = toolVisibility.getVisibleTools();
      const setRoleTool = visibleTools.find(t => t.name === 'set_role');
      expect(setRoleTool).toBeDefined();
      expect(setRoleTool?.description).toContain('Switch to a specific role');
    });
  });

  describe('Access Control', () => {
    beforeEach(async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [{
          id: 'test-skill',
          displayName: 'Test',
          description: 'Test skill',
          allowedRoles: ['user'],
          allowedTools: ['allowed__tool']
        }],
        version: '1.0.0',
        generatedAt: new Date()
      };
      await roleManager.loadFromSkillManifest(manifest);

      const tools: Tool[] = [
        { name: 'allowed__tool', description: 'Allowed', inputSchema: { type: 'object' } },
        { name: 'denied__tool', description: 'Denied', inputSchema: { type: 'object' } },
      ];
      toolVisibility.registerToolsFromList(tools);

      const userRole = roleManager.getRole('user');
      toolVisibility.setCurrentRole(userRole!);
    });

    it('should not throw for accessible tools', () => {
      expect(() => toolVisibility.checkAccess('allowed__tool')).not.toThrow();
      expect(() => toolVisibility.checkAccess('set_role')).not.toThrow();
    });

    it('should throw for inaccessible tools', () => {
      expect(() => toolVisibility.checkAccess('denied__tool')).toThrow(
        /not accessible for role/
      );
    });
  });

  describe('Tool Info Retrieval', () => {
    beforeEach(() => {
      const tools: Tool[] = [
        { name: 'server__tool1', description: 'Description 1', inputSchema: { type: 'object' } },
        { name: 'server__tool2', description: 'Description 2', inputSchema: { type: 'object' } },
      ];
      toolVisibility.registerToolsFromList(tools);
      toolVisibility.setCurrentRole(null);
    });

    it('should return visible tools as Tool array', () => {
      const tools = toolVisibility.getVisibleTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(2);
    });

    it('should return visible tools with metadata', () => {
      const toolsInfo = toolVisibility.getVisibleToolsInfo();
      expect(toolsInfo.length).toBeGreaterThanOrEqual(2);

      const tool1 = toolsInfo.find(t => t.prefixedName === 'server__tool1');
      expect(tool1).toBeDefined();
      expect(tool1?.sourceServer).toBe('server');
      expect(tool1?.visible).toBe(true);
    });

    it('should return tool info by name', () => {
      const info = toolVisibility.getToolInfo('server__tool1');
      expect(info).toBeDefined();
      expect(info?.tool.description).toBe('Description 1');
    });
  });

  describe('Claude Agent SDK Prefix Normalization', () => {
    // Claude Agent SDK prefixes all MCP tools with mcp__<server>__
    // This test suite verifies that RBAC correctly handles both formats

    beforeEach(async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [{
          id: 'filesystem-skill',
          displayName: 'Filesystem',
          description: 'Filesystem access',
          allowedRoles: ['meta-developer'],
          allowedTools: ['filesystem__read_file', 'filesystem__search_files']
        }],
        version: '1.0.0',
        generatedAt: new Date()
      };
      await roleManager.loadFromSkillManifest(manifest);

      // Register tools as they appear in aegis-router (without mcp__ prefix)
      const tools: Tool[] = [
        { name: 'filesystem__read_file', description: 'Read file', inputSchema: { type: 'object' } },
        { name: 'filesystem__search_files', description: 'Search files', inputSchema: { type: 'object' } },
        { name: 'database__query', description: 'Query DB', inputSchema: { type: 'object' } },
      ];
      toolVisibility.registerToolsFromList(tools);

      const role = roleManager.getRole('meta-developer');
      toolVisibility.setCurrentRole(role!);
    });

    describe('normalizeToolName', () => {
      it('should strip mcp__aegis-router__ prefix', () => {
        expect(toolVisibility.normalizeToolName('mcp__aegis-router__filesystem__read_file'))
          .toBe('filesystem__read_file');
      });

      it('should strip mcp__ prefix with any server name', () => {
        expect(toolVisibility.normalizeToolName('mcp__some-server__tool__action'))
          .toBe('tool__action');
      });

      it('should preserve tool name if no mcp__ prefix', () => {
        expect(toolVisibility.normalizeToolName('filesystem__read_file'))
          .toBe('filesystem__read_file');
      });

      it('should preserve simple tool names', () => {
        expect(toolVisibility.normalizeToolName('set_role'))
          .toBe('set_role');
      });

      it('should handle edge cases', () => {
        expect(toolVisibility.normalizeToolName('mcp__')).toBe('mcp__');
        expect(toolVisibility.normalizeToolName('mcp__server')).toBe('mcp__server');
        expect(toolVisibility.normalizeToolName('')).toBe('');
      });
    });

    describe('isVisible with SDK prefix', () => {
      it('should recognize tools with mcp__aegis-router__ prefix', () => {
        // Both formats should work
        expect(toolVisibility.isVisible('filesystem__read_file')).toBe(true);
        expect(toolVisibility.isVisible('mcp__aegis-router__filesystem__read_file')).toBe(true);
      });

      it('should deny tools not in allowedTools (with SDK prefix)', () => {
        expect(toolVisibility.isVisible('database__query')).toBe(false);
        expect(toolVisibility.isVisible('mcp__aegis-router__database__query')).toBe(false);
      });

      it('should recognize set_role with SDK prefix', () => {
        expect(toolVisibility.isVisible('set_role')).toBe(true);
        expect(toolVisibility.isVisible('mcp__aegis-router__set_role')).toBe(true);
      });
    });

    describe('checkAccess with SDK prefix', () => {
      it('should not throw for allowed tools with SDK prefix', () => {
        expect(() => toolVisibility.checkAccess('filesystem__read_file')).not.toThrow();
        expect(() => toolVisibility.checkAccess('mcp__aegis-router__filesystem__read_file')).not.toThrow();
      });

      it('should throw for denied tools with SDK prefix', () => {
        expect(() => toolVisibility.checkAccess('database__query'))
          .toThrow(/not accessible for role/);
        expect(() => toolVisibility.checkAccess('mcp__aegis-router__database__query'))
          .toThrow(/not accessible for role/);
      });

      it('should allow set_role with SDK prefix', () => {
        expect(() => toolVisibility.checkAccess('set_role')).not.toThrow();
        expect(() => toolVisibility.checkAccess('mcp__aegis-router__set_role')).not.toThrow();
      });
    });

    describe('getToolInfo with SDK prefix', () => {
      it('should return tool info with SDK prefix', () => {
        const info1 = toolVisibility.getToolInfo('filesystem__read_file');
        const info2 = toolVisibility.getToolInfo('mcp__aegis-router__filesystem__read_file');

        expect(info1).toBeDefined();
        expect(info2).toBeDefined();
        expect(info1?.tool.description).toBe(info2?.tool.description);
      });
    });

    describe('parseToolName with SDK prefix', () => {
      it('should parse tool names after normalization', () => {
        const result = toolVisibility.parseToolName('mcp__aegis-router__filesystem__read_file');
        expect(result.serverName).toBe('filesystem');
        expect(result.originalName).toBe('read_file');
      });
    });
  });
});
