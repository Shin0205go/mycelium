/**
 * Aegis-Skills Access Control Tests
 *
 * Tests for skill-based tool access control:
 * - list_skills: only orchestrator
 * - get_skill, get_resource, run_script: all roles (via common skill)
 * - list_resources: only orchestrator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoleManager } from '../src/role-manager.js';
import { ToolVisibilityManager } from '../src/tool-visibility-manager.js';
import type { Logger, SkillManifest, BaseSkillDefinition } from '@mycelium/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

// Skill manifest matching actual aegis-skills configuration
const aegisSkillsManifest: SkillManifest<BaseSkillDefinition> = {
  skills: [
    {
      id: 'orchestrator',
      displayName: 'Orchestrator',
      description: 'Task coordination and role delegation',
      allowedRoles: ['orchestrator'],
      allowedTools: [
        'aegis-skills__list_skills',
        'aegis-skills__list_resources'
      ]
    },
    {
      id: 'common',
      displayName: 'Common Tools',
      description: 'Tools available to specified roles',
      allowedRoles: ['orchestrator', 'developer', 'senior-developer', 'admin', 'analyst', 'data-scientist'],
      allowedTools: [
        'aegis-skills__get_skill',
        'aegis-skills__get_resource',
        'aegis-skills__run_script'
      ]
    },
    {
      id: 'code-reviewer',
      displayName: 'Code Reviewer',
      description: 'Code review and best practices',
      allowedRoles: ['developer', 'senior-developer', 'admin'],
      allowedTools: [
        'filesystem__read_file',
        'github__get_pull_request'
      ]
    },
    {
      id: 'data-analyzer',
      displayName: 'Data Analyzer',
      description: 'Data analysis and visualization',
      allowedRoles: ['analyst', 'data-scientist', 'admin'],
      allowedTools: [
        'filesystem__read_file',
        'filesystem__write_file',
        'database__query'
      ]
    }
  ],
  version: '1.0.0',
  generatedAt: new Date()
};

// Mock tools from aegis-skills server
const AEGIS_SKILLS_TOOLS: Tool[] = [
  { name: 'aegis-skills__list_skills', description: 'List all skills', inputSchema: { type: 'object' } },
  { name: 'aegis-skills__get_skill', description: 'Get skill details', inputSchema: { type: 'object' } },
  { name: 'aegis-skills__list_resources', description: 'List skill resources', inputSchema: { type: 'object' } },
  { name: 'aegis-skills__get_resource', description: 'Get resource content', inputSchema: { type: 'object' } },
  { name: 'aegis-skills__run_script', description: 'Run skill script', inputSchema: { type: 'object' } },
];

describe('Aegis-Skills Tool Access Control', () => {
  let roleManager: RoleManager;
  let toolVisibility: ToolVisibilityManager;

  beforeEach(async () => {
    roleManager = new RoleManager(testLogger);
    await roleManager.initialize();
    await roleManager.loadFromSkillManifest(aegisSkillsManifest);

    toolVisibility = new ToolVisibilityManager(testLogger, roleManager);
    toolVisibility.registerToolsFromList(AEGIS_SKILLS_TOOLS);
  });

  describe('list_skills Access', () => {
    it('should allow orchestrator to access list_skills', () => {
      const role = roleManager.getRole('orchestrator');
      expect(role).not.toBeNull();

      toolVisibility.setCurrentRole(role!);
      expect(toolVisibility.isVisible('aegis-skills__list_skills')).toBe(true);
    });

    it('should deny developer access to list_skills', () => {
      const role = roleManager.getRole('developer');
      expect(role).not.toBeNull();

      toolVisibility.setCurrentRole(role!);
      expect(toolVisibility.isVisible('aegis-skills__list_skills')).toBe(false);
    });

    it('should deny data-scientist access to list_skills', () => {
      const role = roleManager.getRole('data-scientist');
      expect(role).not.toBeNull();

      toolVisibility.setCurrentRole(role!);
      expect(toolVisibility.isVisible('aegis-skills__list_skills')).toBe(false);
    });

    it('should deny admin access to list_skills', () => {
      const role = roleManager.getRole('admin');
      expect(role).not.toBeNull();

      toolVisibility.setCurrentRole(role!);
      expect(toolVisibility.isVisible('aegis-skills__list_skills')).toBe(false);
    });
  });

  describe('list_resources Access', () => {
    it('should allow orchestrator to access list_resources', () => {
      const role = roleManager.getRole('orchestrator');
      toolVisibility.setCurrentRole(role!);
      expect(toolVisibility.isVisible('aegis-skills__list_resources')).toBe(true);
    });

    it('should deny non-orchestrator roles access to list_resources', () => {
      const nonOrchestratorRoles = ['developer', 'admin', 'analyst', 'data-scientist'];

      for (const roleId of nonOrchestratorRoles) {
        const role = roleManager.getRole(roleId);
        if (role) {
          toolVisibility.setCurrentRole(role);
          expect(toolVisibility.isVisible('aegis-skills__list_resources')).toBe(false);
        }
      }
    });
  });

  describe('Common Tools Access (get_skill, get_resource, run_script)', () => {
    const commonTools = [
      'aegis-skills__get_skill',
      'aegis-skills__get_resource',
      'aegis-skills__run_script'
    ];

    it('should allow all roles to access common tools', () => {
      const allRoles = roleManager.getAllRoles();

      for (const role of allRoles) {
        toolVisibility.setCurrentRole(role);

        for (const tool of commonTools) {
          expect(toolVisibility.isVisible(tool)).toBe(true);
        }
      }
    });

    it('should allow developer to access get_skill', () => {
      const role = roleManager.getRole('developer');
      toolVisibility.setCurrentRole(role!);
      expect(toolVisibility.isVisible('aegis-skills__get_skill')).toBe(true);
    });

    it('should allow orchestrator to access get_skill', () => {
      const role = roleManager.getRole('orchestrator');
      toolVisibility.setCurrentRole(role!);
      expect(toolVisibility.isVisible('aegis-skills__get_skill')).toBe(true);
    });
  });

  describe('Tool Access Enforcement', () => {
    it('should throw error when accessing denied tool', () => {
      const role = roleManager.getRole('developer');
      toolVisibility.setCurrentRole(role!);

      expect(() => {
        toolVisibility.checkAccess('aegis-skills__list_skills');
      }).toThrow();
    });

    it('should not throw error when accessing allowed tool', () => {
      const role = roleManager.getRole('developer');
      toolVisibility.setCurrentRole(role!);

      expect(() => {
        toolVisibility.checkAccess('aegis-skills__get_skill');
      }).not.toThrow();
    });

    it('should always allow set_role system tool', () => {
      const allRoles = roleManager.getAllRoles();

      for (const role of allRoles) {
        toolVisibility.setCurrentRole(role);
        expect(() => {
          toolVisibility.checkAccess('set_role');
        }).not.toThrow();
      }
    });
  });

  describe('Skill-specific Tool Access', () => {
    it('should allow developer to access code-reviewer tools', () => {
      const role = roleManager.getRole('developer');
      expect(roleManager.isToolAllowedForRole('developer', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('developer', 'github__get_pull_request', 'github')).toBe(true);
    });

    it('should deny developer access to data-analyzer specific tools', () => {
      // developer has code-reviewer but NOT data-analyzer
      // filesystem__write_file is in data-analyzer which doesn't include developer
      expect(roleManager.isToolAllowedForRole('developer', 'filesystem__write_file', 'filesystem')).toBe(false);
    });

    it('should allow analyst to access data-analyzer tools', () => {
      expect(roleManager.isToolAllowedForRole('analyst', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('analyst', 'database__query', 'database')).toBe(true);
    });

    it('should deny analyst access to code-reviewer tools', () => {
      // github__get_pull_request is only in code-reviewer which doesn't include analyst
      expect(roleManager.isToolAllowedForRole('analyst', 'github__get_pull_request', 'github')).toBe(false);
    });
  });

  describe('Wildcard Role (*) Inheritance', () => {
    it('should give all roles access to common skill tools', () => {
      const allRoleIds = roleManager.getRoleIds();

      for (const roleId of allRoleIds) {
        // Common skill tools should be accessible
        expect(roleManager.isToolAllowedForRole(roleId, 'aegis-skills__get_skill', 'aegis-skills')).toBe(true);
        expect(roleManager.isToolAllowedForRole(roleId, 'aegis-skills__get_resource', 'aegis-skills')).toBe(true);
        expect(roleManager.isToolAllowedForRole(roleId, 'aegis-skills__run_script', 'aegis-skills')).toBe(true);
      }
    });

    it('should give data-analyzer roles access to its tools', () => {
      // Only analyst, data-scientist, and admin have data-analyzer skill
      const dataAnalyzerRoles = ['analyst', 'data-scientist', 'admin'];

      for (const roleId of dataAnalyzerRoles) {
        expect(roleManager.isToolAllowedForRole(roleId, 'filesystem__read_file', 'filesystem')).toBe(true);
      }

      // developer should NOT have data-analyzer tools (except via code-reviewer which has read_file)
      // Note: developer has code-reviewer which also has filesystem__read_file
      expect(roleManager.isToolAllowedForRole('developer', 'filesystem__read_file', 'filesystem')).toBe(true);
      // But developer should NOT have database__query
      expect(roleManager.isToolAllowedForRole('developer', 'database__query', 'database')).toBe(false);
    });
  });

  describe('Role Tool Summary', () => {
    it('should have correct tool counts per role', () => {
      const toolCounts: Record<string, number> = {};

      for (const role of roleManager.getAllRoles()) {
        const allowedTools = role.toolPermissions?.allowPatterns || [];
        toolCounts[role.id] = allowedTools.length;
      }

      // Verify orchestrator has list_skills + list_resources + common tools + data-analyzer tools
      expect(toolCounts['orchestrator']).toBeGreaterThanOrEqual(5);

      // Verify developer has code-reviewer + common + data-analyzer tools
      expect(toolCounts['developer']).toBeGreaterThanOrEqual(5);
    });
  });
});
