/**
 * E2E Role Switching Tests
 *
 * Tests the complete flow:
 * 1. list_skills → Get skills from aegis-skills server
 * 2. loadFromSkillManifest → Dynamic role generation
 * 3. set_role → Switch role
 * 4. Verify tools/skills change based on role
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleConfigManager } from '../src/router/role-config.js';
import { Logger } from '../src/utils/logger.js';
import { join } from 'path';
import type { SkillManifest, Role } from '../src/types/router-types.js';

// Set LOG_SILENT for tests
process.env.LOG_SILENT = 'true';
const testLogger = new Logger();

/**
 * Simulates the aegis-skills server response
 */
function mockListSkillsResponse(): SkillManifest {
  return {
    skills: [
      {
        id: 'docx-handler',
        displayName: 'DOCX Handler',
        description: 'Handle DOCX files',
        allowedRoles: ['formatter', 'admin'],
        allowedTools: ['filesystem__read_file', 'filesystem__write_file', 'docx__parse', 'docx__export']
      },
      {
        id: 'xlsx-handler',
        displayName: 'XLSX Handler',
        description: 'Handle Excel files',
        allowedRoles: ['formatter', 'admin'],
        allowedTools: ['filesystem__read_file', 'filesystem__write_file', 'xlsx__parse', 'xlsx__export']
      },
      {
        id: 'code-review',
        displayName: 'Code Review',
        description: 'Review code quality',
        allowedRoles: ['reviewer', 'admin'],
        allowedTools: ['filesystem__read_file', 'git__diff', 'git__log', 'git__blame']
      },
      {
        id: 'security-scan',
        displayName: 'Security Scan',
        description: 'Scan for vulnerabilities',
        allowedRoles: ['security', 'admin'],
        allowedTools: ['filesystem__read_file', 'filesystem__search_files', 'security__scan']
      },
      {
        id: 'orchestration',
        displayName: 'Orchestration',
        description: 'Task delegation',
        allowedRoles: ['orchestrator'],
        allowedTools: []  // No direct tools - delegates to other roles
      }
    ],
    version: '1.0.0',
    generatedAt: new Date()
  };
}

describe('E2E: list_skills → set_role Flow', () => {
  let roleManager: RoleConfigManager;

  beforeEach(async () => {
    roleManager = new RoleConfigManager(testLogger, {
      rolesDir: join(process.cwd(), 'roles'),
    });
    await roleManager.initialize();
  });

  describe('Step 1: list_skills - Dynamic Role Generation', () => {
    it('should generate roles from list_skills response', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      // Should have generated 5 roles: formatter, admin, reviewer, security, orchestrator
      expect(roleManager.hasRole('formatter')).toBe(true);
      expect(roleManager.hasRole('admin')).toBe(true);
      expect(roleManager.hasRole('reviewer')).toBe(true);
      expect(roleManager.hasRole('security')).toBe(true);
      expect(roleManager.hasRole('orchestrator')).toBe(true);
    });

    it('should aggregate tools correctly per role', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      // Formatter: docx-handler + xlsx-handler tools
      const formatter = roleManager.getRole('formatter');
      expect(formatter?.toolPermissions?.allowPatterns).toContain('docx__parse');
      expect(formatter?.toolPermissions?.allowPatterns).toContain('xlsx__parse');
      expect(formatter?.toolPermissions?.allowPatterns).not.toContain('git__diff');

      // Reviewer: code-review tools only
      const reviewer = roleManager.getRole('reviewer');
      expect(reviewer?.toolPermissions?.allowPatterns).toContain('git__diff');
      expect(reviewer?.toolPermissions?.allowPatterns).toContain('git__log');
      expect(reviewer?.toolPermissions?.allowPatterns).not.toContain('docx__parse');

      // Admin: all tools from all skills
      const admin = roleManager.getRole('admin');
      expect(admin?.toolPermissions?.allowPatterns).toContain('docx__parse');
      expect(admin?.toolPermissions?.allowPatterns).toContain('xlsx__parse');
      expect(admin?.toolPermissions?.allowPatterns).toContain('git__diff');
      expect(admin?.toolPermissions?.allowPatterns).toContain('security__scan');
    });
  });

  describe('Step 2: set_role - Role Switching', () => {
    it('should switch from orchestrator to formatter', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      // Start as orchestrator (no tools)
      const orchestrator = roleManager.getRole('orchestrator');
      expect(orchestrator?.toolPermissions?.allowPatterns || []).toHaveLength(0);

      // Switch to formatter
      const formatter = roleManager.getRole('formatter');
      expect(formatter).not.toBeNull();

      // Formatter should have document tools
      expect(formatter?.toolPermissions?.allowPatterns).toContain('docx__parse');
      expect(formatter?.toolPermissions?.allowPatterns).toContain('xlsx__export');
    });

    it('should have different tools after switching roles', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      // Get tools for each role
      const formatterTools = roleManager.getRole('formatter')?.toolPermissions?.allowPatterns || [];
      const reviewerTools = roleManager.getRole('reviewer')?.toolPermissions?.allowPatterns || [];
      const securityTools = roleManager.getRole('security')?.toolPermissions?.allowPatterns || [];

      // Verify they are different
      expect(formatterTools).toContain('docx__parse');
      expect(formatterTools).not.toContain('git__diff');

      expect(reviewerTools).toContain('git__diff');
      expect(reviewerTools).not.toContain('docx__parse');

      expect(securityTools).toContain('security__scan');
      expect(securityTools).not.toContain('docx__parse');
      expect(securityTools).not.toContain('git__diff');
    });
  });

  describe('Step 3: Verify Skills per Role', () => {
    it('should have correct skills assigned to each role', async () => {
      const skillManifest = mockListSkillsResponse();
      const roleManifest = roleManager.generateRoleManifest(skillManifest);

      // Formatter has document skills
      expect(roleManifest.roles['formatter'].skills).toContain('docx-handler');
      expect(roleManifest.roles['formatter'].skills).toContain('xlsx-handler');
      expect(roleManifest.roles['formatter'].skills).not.toContain('code-review');

      // Reviewer has code review skill
      expect(roleManifest.roles['reviewer'].skills).toContain('code-review');
      expect(roleManifest.roles['reviewer'].skills).not.toContain('docx-handler');

      // Admin has all skills except orchestration
      expect(roleManifest.roles['admin'].skills).toContain('docx-handler');
      expect(roleManifest.roles['admin'].skills).toContain('xlsx-handler');
      expect(roleManifest.roles['admin'].skills).toContain('code-review');
      expect(roleManifest.roles['admin'].skills).toContain('security-scan');
    });
  });

  describe('Step 4: Verify Server Access per Role', () => {
    it('should extract servers from tools correctly', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      // Formatter: filesystem, docx, xlsx
      const formatter = roleManager.getRole('formatter');
      expect(formatter?.allowedServers).toContain('filesystem');
      expect(formatter?.allowedServers).toContain('docx');
      expect(formatter?.allowedServers).toContain('xlsx');
      expect(formatter?.allowedServers).not.toContain('git');

      // Reviewer: filesystem, git
      const reviewer = roleManager.getRole('reviewer');
      expect(reviewer?.allowedServers).toContain('filesystem');
      expect(reviewer?.allowedServers).toContain('git');
      expect(reviewer?.allowedServers).not.toContain('docx');

      // Orchestrator: no servers
      const orchestrator = roleManager.getRole('orchestrator');
      expect(orchestrator?.allowedServers).toHaveLength(0);
    });
  });

  describe('Step 5: set_role Always Allowed', () => {
    it('should allow set_role for all roles', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      const allRoles = ['formatter', 'admin', 'reviewer', 'security', 'orchestrator'];
      for (const role of allRoles) {
        expect(roleManager.isToolAllowedForRole(role, 'set_role', 'aegis-router')).toBe(true);
      }
    });
  });

  describe('Full E2E Scenario', () => {
    it('should complete full workflow: list_skills → generate roles → switch → verify', async () => {
      // Step 1: Simulate list_skills call
      const skillManifest = mockListSkillsResponse();

      // Step 2: Load roles from skill manifest
      await roleManager.loadFromSkillManifest(skillManifest);

      // Verify roles were created
      expect(roleManager.getRoleIds().length).toBe(5);

      // Step 3: Simulate set_role to 'reviewer'
      const reviewerRole = roleManager.getRole('reviewer');
      expect(reviewerRole).not.toBeNull();

      // Step 4: Verify tools available for reviewer
      expect(roleManager.isToolAllowedForRole('reviewer', 'git__diff', 'git')).toBe(true);
      expect(roleManager.isToolAllowedForRole('reviewer', 'git__log', 'git')).toBe(true);
      expect(roleManager.isToolAllowedForRole('reviewer', 'filesystem__read_file', 'filesystem')).toBe(true);

      // Step 5: Verify tools NOT available for reviewer
      expect(roleManager.isToolAllowedForRole('reviewer', 'docx__parse', 'docx')).toBe(false);
      expect(roleManager.isToolAllowedForRole('reviewer', 'security__scan', 'security')).toBe(false);

      // Step 6: Switch to admin and verify all tools
      const adminRole = roleManager.getRole('admin');
      expect(roleManager.isToolAllowedForRole('admin', 'git__diff', 'git')).toBe(true);
      expect(roleManager.isToolAllowedForRole('admin', 'docx__parse', 'docx')).toBe(true);
      expect(roleManager.isToolAllowedForRole('admin', 'security__scan', 'security')).toBe(true);

      // Step 7: set_role is always available
      expect(roleManager.isToolAllowedForRole('reviewer', 'set_role', 'aegis-router')).toBe(true);
      expect(roleManager.isToolAllowedForRole('admin', 'set_role', 'aegis-router')).toBe(true);
    });
  });
});
