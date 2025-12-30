/**
 * Tool Filtering Tests (v2: Skill-Driven)
 *
 * Tests for ツール制御 (Tool Control) - the 4th RBAC perspective
 * Validates that each role has appropriate tool access based on:
 * - Skills assigned to each role
 * - Allow patterns from skills
 * - Wildcard matching
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoleConfigManager } from '../src/router/role-config.js';
import { Logger } from '../src/utils/logger.js';
import { join } from 'path';
import type { SkillManifest } from '../src/types/router-types.js';

// Mock tools from backend servers
const MOCK_FILESYSTEM_TOOLS = [
  'filesystem__read_file',
  'filesystem__write_file',
  'filesystem__list_directory',
  'filesystem__search_files',
  'filesystem__delete_file',
  'filesystem__create_directory',
  'filesystem__move_file',
];

const MOCK_EXECUTION_TOOLS = [
  'execution__run_command',
  'execution__execute_script',
  'execution__kill_process',
];

const MOCK_PLAYWRIGHT_TOOLS = [
  'playwright__navigate',
  'playwright__click',
  'playwright__screenshot',
  'playwright__evaluate',
];

const ALL_TOOLS = [
  ...MOCK_FILESYSTEM_TOOLS,
  ...MOCK_EXECUTION_TOOLS,
  ...MOCK_PLAYWRIGHT_TOOLS,
];

// Set LOG_SILENT for tests
process.env.LOG_SILENT = 'true';
const testLogger = new Logger();

// Standard skill manifest for tool filtering tests
const toolFilteringManifest: SkillManifest = {
  skills: [
    {
      id: 'orchestration',
      displayName: 'Orchestration',
      description: 'Task delegation only',
      allowedRoles: ['orchestrator'],
      allowedTools: []  // No tools - delegation only
    },
    {
      id: 'frontend-dev',
      displayName: 'Frontend Development',
      description: 'Frontend development tasks',
      allowedRoles: ['frontend'],
      allowedTools: [
        'filesystem__read_file',
        'filesystem__write_file',
        'filesystem__list_directory',
        'filesystem__search_files'
      ]
    },
    {
      id: 'security-audit',
      displayName: 'Security Audit',
      description: 'Security auditing (read-only)',
      allowedRoles: ['security'],
      allowedTools: [
        'filesystem__read_file',
        'filesystem__list_directory',
        'filesystem__search_files'
      ]
    },
    {
      id: 'guest-access',
      displayName: 'Guest Access',
      description: 'Minimal read-only access',
      allowedRoles: ['guest'],
      allowedTools: [
        'filesystem__read_file',
        'filesystem__list_directory'
      ]
    },
    {
      id: 'devops-full',
      displayName: 'DevOps Full Access',
      description: 'Full infrastructure access',
      allowedRoles: ['devops'],
      allowedTools: [
        'filesystem__*',
        'execution__*',
        'playwright__*'
      ]
    },
    {
      id: 'db-admin',
      displayName: 'Database Admin',
      description: 'Database admin with read-only filesystem',
      allowedRoles: ['db_admin'],
      allowedTools: [
        'filesystem__read_file',
        'filesystem__list_directory',
        'database__query',
        'database__explain'
      ]
    },
    {
      id: 'agent-formatter',
      displayName: 'Code Formatter',
      description: 'Format code files',
      allowedRoles: ['formatter'],
      allowedTools: [
        'agent-skills__*',
        'filesystem__read_file',
        'filesystem__write_file'
      ]
    }
  ],
  version: '2.0.0',
  generatedAt: new Date()
};

describe('Tool Filtering by Role (Skill-Driven)', () => {
  let roleManager: RoleConfigManager;

  beforeEach(async () => {
    roleManager = new RoleConfigManager(testLogger, {
      rolesDir: join(process.cwd(), 'roles'),
    });
    await roleManager.initialize();
    await roleManager.loadFromSkillManifest(toolFilteringManifest);
  });

  /**
   * Helper function to filter tools for a role
   */
  function filterToolsForRole(roleId: string, tools: { name: string; server: string }[]): string[] {
    return tools
      .filter(tool => roleManager.isToolAllowedForRole(roleId, tool.name, tool.server))
      .map(tool => tool.name);
  }

  describe('Orchestrator Role', () => {
    it('should deny all tools (no tools in skill)', () => {
      // All regular tools should be denied
      for (const tool of MOCK_FILESYSTEM_TOOLS) {
        expect(roleManager.isToolAllowedForRole('orchestrator', tool, 'filesystem')).toBe(false);
      }
    });

    it('should allow get_agent_manifest system tool', () => {
      expect(roleManager.isToolAllowedForRole('orchestrator', 'get_agent_manifest', 'aegis-router')).toBe(true);
    });
  });

  describe('Frontend Role', () => {
    const filesystemTools = MOCK_FILESYSTEM_TOOLS.map(name => ({ name, server: 'filesystem' }));

    it('should allow read/write/list/search tools', () => {
      const allowed = filterToolsForRole('frontend', filesystemTools);
      expect(allowed).toContain('filesystem__read_file');
      expect(allowed).toContain('filesystem__write_file');
      expect(allowed).toContain('filesystem__list_directory');
      expect(allowed).toContain('filesystem__search_files');
    });

    it('should deny delete tools (not in skill)', () => {
      const allowed = filterToolsForRole('frontend', filesystemTools);
      expect(allowed).not.toContain('filesystem__delete_file');
    });

    it('should deny execution tools (no server access)', () => {
      const execTools = MOCK_EXECUTION_TOOLS.map(name => ({ name, server: 'execution' }));
      const allowed = filterToolsForRole('frontend', execTools);
      expect(allowed).toHaveLength(0);
    });
  });

  describe('Security Role', () => {
    const filesystemTools = MOCK_FILESYSTEM_TOOLS.map(name => ({ name, server: 'filesystem' }));

    it('should only allow read-only tools', () => {
      const allowed = filterToolsForRole('security', filesystemTools);
      expect(allowed).toContain('filesystem__read_file');
      expect(allowed).toContain('filesystem__list_directory');
      expect(allowed).toContain('filesystem__search_files');
    });

    it('should deny all write/delete operations', () => {
      const allowed = filterToolsForRole('security', filesystemTools);
      expect(allowed).not.toContain('filesystem__write_file');
      expect(allowed).not.toContain('filesystem__delete_file');
      expect(allowed).not.toContain('filesystem__create_directory');
      expect(allowed).not.toContain('filesystem__move_file');
    });
  });

  describe('Guest Role', () => {
    const filesystemTools = MOCK_FILESYSTEM_TOOLS.map(name => ({ name, server: 'filesystem' }));

    it('should only allow read_file and list_directory', () => {
      const allowed = filterToolsForRole('guest', filesystemTools);
      expect(allowed).toContain('filesystem__read_file');
      expect(allowed).toContain('filesystem__list_directory');
      expect(allowed).toHaveLength(2);
    });

    it('should deny all other filesystem tools', () => {
      const allowed = filterToolsForRole('guest', filesystemTools);
      expect(allowed).not.toContain('filesystem__write_file');
      expect(allowed).not.toContain('filesystem__search_files');
      expect(allowed).not.toContain('filesystem__delete_file');
    });
  });

  describe('DevOps Role', () => {
    it('should have access to all servers via wildcard patterns', () => {
      expect(roleManager.isServerAllowedForRole('devops', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('devops', 'execution')).toBe(true);
      expect(roleManager.isServerAllowedForRole('devops', 'playwright')).toBe(true);
    });

    it('should allow all tools via wildcard patterns', () => {
      // DevOps has wildcard patterns for all servers
      for (const tool of ALL_TOOLS) {
        const server = tool.split('__')[0];
        expect(roleManager.isToolAllowedForRole('devops', tool, server)).toBe(true);
      }
    });
  });

  describe('DB Admin Role', () => {
    const filesystemTools = MOCK_FILESYSTEM_TOOLS.map(name => ({ name, server: 'filesystem' }));

    it('should allow read and list operations', () => {
      const allowed = filterToolsForRole('db_admin', filesystemTools);
      expect(allowed).toContain('filesystem__read_file');
      expect(allowed).toContain('filesystem__list_directory');
    });

    it('should deny write and delete operations', () => {
      const allowed = filterToolsForRole('db_admin', filesystemTools);
      expect(allowed).not.toContain('filesystem__write_file');
      expect(allowed).not.toContain('filesystem__delete_file');
    });

    it('should allow database tools', () => {
      expect(roleManager.isToolAllowedForRole('db_admin', 'database__query', 'database')).toBe(true);
      expect(roleManager.isToolAllowedForRole('db_admin', 'database__explain', 'database')).toBe(true);
    });
  });

  describe('Tool Count Summary', () => {
    it('should produce expected tool counts per role', () => {
      const filesystemTools = MOCK_FILESYSTEM_TOOLS.map(name => ({ name, server: 'filesystem' }));

      const summary: Record<string, number> = {};
      const roleIds = ['orchestrator', 'frontend', 'security', 'guest', 'devops', 'db_admin'];

      for (const roleId of roleIds) {
        const allowed = filterToolsForRole(roleId, filesystemTools);
        summary[roleId] = allowed.length;
      }

      // Verify expected counts
      expect(summary.orchestrator).toBe(0); // No tools
      expect(summary.frontend).toBe(4); // read, write, list, search
      expect(summary.security).toBe(3); // read, list, search
      expect(summary.guest).toBe(2); // read, list
      expect(summary.devops).toBe(MOCK_FILESYSTEM_TOOLS.length); // All via wildcard
      expect(summary.db_admin).toBe(2); // read, list
    });
  });
});

describe('Pattern Matching (Skill-Driven)', () => {
  let roleManager: RoleConfigManager;

  beforeEach(async () => {
    roleManager = new RoleConfigManager(testLogger, {
      rolesDir: join(process.cwd(), 'roles'),
    });
    await roleManager.initialize();
    await roleManager.loadFromSkillManifest(toolFilteringManifest);
  });

  describe('Wildcard Patterns', () => {
    it('should match * suffix pattern (filesystem__*)', () => {
      // DevOps has filesystem__* pattern
      expect(roleManager.isToolAllowedForRole('devops', 'filesystem__any_tool', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('devops', 'filesystem__read_file', 'filesystem')).toBe(true);
    });

    it('should match exact tool names', () => {
      // Frontend has specific tools, not wildcards
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__delete_file', 'filesystem')).toBe(false);
    });
  });

  describe('Server Prefix Patterns', () => {
    it('should match agent-skills__* for agent tools', () => {
      // formatter agent has allowedTools: ["agent-skills__*"]
      expect(roleManager.isToolAllowedForRole('formatter', 'agent-skills__format_code', 'agent-skills')).toBe(true);
      expect(roleManager.isToolAllowedForRole('formatter', 'agent-skills__any_tool', 'agent-skills')).toBe(true);
    });
  });

  describe('System Tools Always Allowed', () => {
    it('should always allow get_agent_manifest regardless of role', () => {
      const allRoles = ['orchestrator', 'frontend', 'security', 'guest', 'devops', 'db_admin', 'formatter'];
      for (const role of allRoles) {
        expect(roleManager.isToolAllowedForRole(role, 'get_agent_manifest', 'aegis-router')).toBe(true);
      }
    });
  });
});
