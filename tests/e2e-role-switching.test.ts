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

  // ============================================================================
  // Error Cases (異常系)
  // ============================================================================

  describe('Error Cases: Invalid Role', () => {
    it('should return undefined for non-existent role', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      const invalidRole = roleManager.getRole('non-existent-role');
      expect(invalidRole).toBeUndefined();
    });

    it('should return false for hasRole with invalid role', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      expect(roleManager.hasRole('invalid-role')).toBe(false);
      expect(roleManager.hasRole('')).toBe(false);
    });

    it('should deny tool access for non-existent role', async () => {
      const skillManifest = mockListSkillsResponse();
      await roleManager.loadFromSkillManifest(skillManifest);

      // Non-existent role should deny all tools
      expect(roleManager.isToolAllowedForRole('fake-role', 'filesystem__read_file', 'filesystem')).toBe(false);
    });
  });

  describe('Error Cases: Empty/Invalid Skill Manifest', () => {
    it('should handle empty skills array', async () => {
      const emptyManifest: SkillManifest = {
        skills: [],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(emptyManifest);

      // No roles should be created
      expect(roleManager.getRoleIds()).toHaveLength(0);
    });

    it('should handle skill with empty allowedRoles', async () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'orphan-skill',
            displayName: 'Orphan Skill',
            description: 'No roles can use this',
            allowedRoles: [],  // Empty!
            allowedTools: ['some__tool']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // No roles should be created from empty allowedRoles
      expect(roleManager.getRoleIds()).toHaveLength(0);
    });

    it('should handle skill with empty allowedTools', async () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'no-tools-skill',
            displayName: 'No Tools Skill',
            description: 'Has no tools',
            allowedRoles: ['empty-role'],
            allowedTools: []  // Empty!
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Role should exist but have no tools
      expect(roleManager.hasRole('empty-role')).toBe(true);
      const role = roleManager.getRole('empty-role');
      expect(role?.toolPermissions?.allowPatterns || []).toHaveLength(0);
      expect(role?.allowedServers).toHaveLength(0);
    });
  });

  describe('Error Cases: Invalid Tool Format', () => {
    it('should handle tools without server prefix', async () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'bad-tools-skill',
            displayName: 'Bad Tools',
            description: 'Tools without proper format',
            allowedRoles: ['test-role'],
            allowedTools: ['no_prefix_tool', 'another_bad_tool']  // No __ separator
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const role = roleManager.getRole('test-role');
      // Should still create the role, tools are stored as-is
      expect(role).not.toBeUndefined();
    });

    it('should handle mixed valid and invalid tools', async () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'mixed-tools',
            displayName: 'Mixed Tools',
            description: 'Some valid, some invalid',
            allowedRoles: ['mixed-role'],
            allowedTools: [
              'filesystem__read_file',  // Valid
              'invalid_tool',            // Invalid (no __)
              'git__status'              // Valid
            ]
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const role = roleManager.getRole('mixed-role');
      // Valid servers should be extracted
      expect(role?.allowedServers).toContain('filesystem');
      expect(role?.allowedServers).toContain('git');
    });
  });

  describe('Error Cases: Server Access', () => {
    it('should deny access to server not in allowedServers', async () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'limited-skill',
            displayName: 'Limited Skill',
            description: 'Only filesystem access',
            allowedRoles: ['limited'],
            allowedTools: ['filesystem__read_file']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Should have filesystem access
      expect(roleManager.isServerAllowedForRole('limited', 'filesystem')).toBe(true);

      // Should NOT have other server access
      expect(roleManager.isServerAllowedForRole('limited', 'git')).toBe(false);
      expect(roleManager.isServerAllowedForRole('limited', 'docker')).toBe(false);
      expect(roleManager.isServerAllowedForRole('limited', 'random-server')).toBe(false);
    });
  });

  describe('Error Cases: Tool Access Boundary', () => {
    it('should deny tool from wrong server', async () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'git-only',
            displayName: 'Git Only',
            description: 'Only git tools',
            allowedRoles: ['git-user'],
            allowedTools: ['git__status', 'git__commit']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Should allow git tools
      expect(roleManager.isToolAllowedForRole('git-user', 'git__status', 'git')).toBe(true);

      // Should deny filesystem tools (not in skill)
      expect(roleManager.isToolAllowedForRole('git-user', 'filesystem__read_file', 'filesystem')).toBe(false);

      // Should deny even git-prefixed tools that weren't specified
      expect(roleManager.isToolAllowedForRole('git-user', 'git__push', 'git')).toBe(false);
    });

    it('should deny tool access after role has no matching skill', async () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'skill-a',
            displayName: 'Skill A',
            description: 'For role A',
            allowedRoles: ['role-a'],
            allowedTools: ['server__tool_a']
          },
          {
            id: 'skill-b',
            displayName: 'Skill B',
            description: 'For role B',
            allowedRoles: ['role-b'],
            allowedTools: ['server__tool_b']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Role A cannot use Role B's tools
      expect(roleManager.isToolAllowedForRole('role-a', 'server__tool_b', 'server')).toBe(false);

      // Role B cannot use Role A's tools
      expect(roleManager.isToolAllowedForRole('role-b', 'server__tool_a', 'server')).toBe(false);
    });
  });

  describe('Error Cases: Reload/Override', () => {
    it('should clear previous roles when loading new manifest', async () => {
      // First load
      const manifest1: SkillManifest = {
        skills: [
          {
            id: 'skill-v1',
            displayName: 'Skill V1',
            description: 'Version 1',
            allowedRoles: ['old-role'],
            allowedTools: ['old__tool']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest1);
      expect(roleManager.hasRole('old-role')).toBe(true);

      // Second load with different roles
      const manifest2: SkillManifest = {
        skills: [
          {
            id: 'skill-v2',
            displayName: 'Skill V2',
            description: 'Version 2',
            allowedRoles: ['new-role'],
            allowedTools: ['new__tool']
          }
        ],
        version: '2.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest2);

      // Old role should be gone
      expect(roleManager.hasRole('old-role')).toBe(false);

      // New role should exist
      expect(roleManager.hasRole('new-role')).toBe(true);
    });
  });
});
