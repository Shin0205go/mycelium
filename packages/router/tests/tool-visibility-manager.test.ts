// ============================================================================
// Tool Visibility Manager Tests
// Tests for role-based tool visibility filtering
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolVisibilityManager } from '../src/router/tool-visibility-manager.js';
import { RoleManager } from '../src/router/role-manager.js';
import { Logger } from '../src/utils/logger.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Role, SkillManifest } from '../src/types/router-types.js';

describe('ToolVisibilityManager', () => {
  let logger: Logger;
  let roleManager: RoleManager;
  let toolVisibility: ToolVisibilityManager;

  beforeEach(async () => {
    logger = new Logger({ level: 'error' });
    roleManager = new RoleManager(logger);
    await roleManager.initialize();
    toolVisibility = new ToolVisibilityManager(logger, roleManager);
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

      const result2 = toolVisibility.parseToolName('mcp__plugin_fs_filesystem__read_file');
      expect(result2.serverName).toBe('mcp');
      expect(result2.originalName).toBe('plugin_fs_filesystem__read_file');

      const result3 = toolVisibility.parseToolName('standalone');
      expect(result3.serverName).toBe('unknown');
      expect(result3.originalName).toBe('standalone');
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
    const mockSkillManifest: SkillManifest = {
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
      const manifest: SkillManifest = {
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
});
