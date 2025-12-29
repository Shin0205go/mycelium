/**
 * Tool Filtering Tests
 *
 * Tests for ツール制御 (Tool Control) - the 4th RBAC perspective
 * Validates that each role has appropriate tool access based on:
 * - Allow/deny patterns
 * - Server restrictions
 * - Wildcard matching
 *
 * Other perspectives are tested in role-config.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RoleConfigManager } from '../src/router/role-config.js';
import { Logger } from '../src/utils/logger.js';
import { join } from 'path';

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

describe('Tool Filtering by Role', () => {
  let roleManager: RoleConfigManager;

  beforeAll(async () => {
    const projectRoot = process.cwd();
    roleManager = new RoleConfigManager(testLogger, {
      rolesDir: join(projectRoot, 'roles'),
      configFile: join(projectRoot, 'roles', 'aegis-roles.json'),
    });
    await roleManager.initialize();
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
    it('should deny all tools except system tools', () => {
      const role = roleManager.getRole('orchestrator');
      expect(role?.toolPermissions?.denyPatterns).toContain('*');

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

    it('should deny delete tools', () => {
      const allowed = filterToolsForRole('frontend', filesystemTools);
      expect(allowed).not.toContain('filesystem__delete_file');
    });

    it('should deny execution tools (no server access)', () => {
      const execTools = MOCK_EXECUTION_TOOLS.map(name => ({ name, server: 'execution-server' }));
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

    it('should deny all write/delete/execute operations', () => {
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
      expect(allowed).toEqual(['filesystem__read_file', 'filesystem__list_directory']);
    });

    it('should deny all other filesystem tools', () => {
      const allowed = filterToolsForRole('guest', filesystemTools);
      expect(allowed).not.toContain('filesystem__write_file');
      expect(allowed).not.toContain('filesystem__search_files');
      expect(allowed).not.toContain('filesystem__delete_file');
    });
  });

  describe('DevOps Role', () => {
    it('should have access to all servers', () => {
      expect(roleManager.isServerAllowedForRole('devops', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('devops', 'execution-server')).toBe(true);
      expect(roleManager.isServerAllowedForRole('devops', 'playwright')).toBe(true);
      expect(roleManager.isServerAllowedForRole('devops', 'any-server')).toBe(true);
    });

    it('should allow all tools (no restrictions)', () => {
      // DevOps has no toolPermissions defined, so all tools are allowed
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

      // Verify expected counts (adjust based on actual config)
      expect(summary.orchestrator).toBe(0); // Denies all
      expect(summary.frontend).toBeGreaterThan(0); // Has read/write/list/search
      expect(summary.security).toBeGreaterThan(0); // Has read/list/search
      expect(summary.guest).toBe(2); // Only read_file and list_directory
      expect(summary.devops).toBe(MOCK_FILESYSTEM_TOOLS.length); // All tools
      expect(summary.db_admin).toBeGreaterThan(0); // Has read/list
    });
  });
});

describe('Pattern Matching', () => {
  let roleManager: RoleConfigManager;

  beforeAll(async () => {
    const projectRoot = process.cwd();
    roleManager = new RoleConfigManager(testLogger, {
      rolesDir: join(projectRoot, 'roles'),
      configFile: join(projectRoot, 'roles', 'aegis-roles.json'),
    });
    await roleManager.initialize();
  });

  describe('Wildcard Patterns', () => {
    it('should match * pattern to all tools', () => {
      // Orchestrator has denyPatterns: ["*"]
      expect(roleManager.isToolAllowedForRole('orchestrator', 'any_tool', 'any_server')).toBe(false);
    });

    it('should match prefix patterns like filesystem__read*', () => {
      // Frontend has allowPatterns including filesystem__read*
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__read_directory', 'filesystem')).toBe(true);
    });

    it('should match suffix patterns like *__delete*', () => {
      // Frontend has denyPatterns: ["*__delete*"]
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__delete_file', 'filesystem')).toBe(false);
      expect(roleManager.isToolAllowedForRole('frontend', 'any__delete_stuff', 'filesystem')).toBe(false);
    });
  });

  describe('Server Prefix Patterns', () => {
    it('should match agent-skills__* for agent tools', () => {
      // formatter agent has allowPatterns: ["agent-skills__*"]
      expect(roleManager.isToolAllowedForRole('formatter', 'agent-skills__some_tool', 'agent-skills')).toBe(true);
    });
  });
});
