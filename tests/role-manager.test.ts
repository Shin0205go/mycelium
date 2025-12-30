/**
 * Role Configuration Tests (v2: Skill-Driven)
 *
 * Tests covering RBAC perspectives with dynamic role generation:
 * 1. Role Loading from SkillManifest
 * 2. Server Access Control
 * 3. Skill Control
 * 4. System Tools
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoleManager } from '../src/router/role-manager.js';
import { Logger } from '../src/utils/logger.js';
import { join } from 'path';
import type { SkillManifest } from '../src/types/router-types.js';

// Set LOG_SILENT for tests
process.env.LOG_SILENT = 'true';
const testLogger = new Logger();

describe('RoleManager (Skill-Driven)', () => {
  let roleManager: RoleManager;

  // Standard skill manifest for tests
  const standardManifest: SkillManifest = {
    skills: [
      {
        id: 'docx-handler',
        displayName: 'DOCX Handler',
        description: 'Handle DOCX files',
        allowedRoles: ['formatter', 'admin'],
        allowedTools: ['filesystem__read_file', 'filesystem__write_file', 'docx__parse', 'docx__export']
      },
      {
        id: 'code-review',
        displayName: 'Code Review',
        description: 'Review code quality',
        allowedRoles: ['reviewer', 'admin'],
        allowedTools: ['filesystem__read_file', 'git__diff', 'git__log']
      },
      {
        id: 'teaching',
        displayName: 'Teaching',
        description: 'Teach programming concepts',
        allowedRoles: ['mentor', 'admin'],
        allowedTools: ['filesystem__read_file', 'filesystem__list_directory']
      },
      {
        id: 'frontend-dev',
        displayName: 'Frontend Development',
        description: 'Frontend development tasks',
        allowedRoles: ['frontend', 'fullstack'],
        allowedTools: ['filesystem__read_file', 'filesystem__write_file', 'playwright__navigate']
      },
      {
        id: 'backend-dev',
        displayName: 'Backend Development',
        description: 'Backend development tasks',
        allowedRoles: ['backend', 'fullstack'],
        allowedTools: ['filesystem__read_file', 'filesystem__write_file', 'database__query']
      },
      {
        id: 'security-audit',
        displayName: 'Security Audit',
        description: 'Security auditing (read-only)',
        allowedRoles: ['security'],
        allowedTools: ['filesystem__read_file', 'filesystem__list_directory', 'filesystem__search_files']
      },
      {
        id: 'guest-access',
        displayName: 'Guest Access',
        description: 'Minimal read-only access',
        allowedRoles: ['guest'],
        allowedTools: ['filesystem__read_file', 'filesystem__list_directory']
      },
      {
        id: 'devops-tools',
        displayName: 'DevOps Tools',
        description: 'Full infrastructure access',
        allowedRoles: ['devops'],
        allowedTools: ['filesystem__*', 'docker__*', 'kubernetes__*', 'git__*']
      },
      {
        id: 'orchestration',
        displayName: 'Orchestration',
        description: 'Task delegation only',
        allowedRoles: ['orchestrator'],
        allowedTools: []  // No tools - delegation only
      }
    ],
    version: '2.0.0',
    generatedAt: new Date()
  };

  beforeEach(async () => {
    roleManager = new RoleManager(testLogger, {
      rolesDir: join(process.cwd(), 'roles'),
    });
    await roleManager.initialize();
    await roleManager.loadFromSkillManifest(standardManifest);
  });

  describe('Role Loading from SkillManifest', () => {
    it('should load all roles from skill manifest', () => {
      const roleIds = roleManager.getRoleIds();
      expect(roleIds.length).toBeGreaterThan(0);
    });

    it('should have first role as default', () => {
      const defaultRole = roleManager.getDefaultRole();
      expect(defaultRole).not.toBeNull();
    });

    it('should load expected roles', () => {
      const expectedRoles = ['formatter', 'admin', 'reviewer', 'mentor', 'frontend', 'backend', 'fullstack', 'security', 'guest', 'devops', 'orchestrator'];
      for (const roleId of expectedRoles) {
        expect(roleManager.hasRole(roleId), `Role ${roleId} should exist`).toBe(true);
      }
    });

    it('should mark roles as skill-driven', () => {
      const role = roleManager.getRole('formatter');
      expect(role?.metadata?.tags).toContain('skill-driven');
      expect(role?.metadata?.tags).toContain('dynamic');
    });
  });

  describe('Server Access Control', () => {
    it('orchestrator should have no allowed servers (no tools)', () => {
      const role = roleManager.getRole('orchestrator');
      expect(role?.allowedServers).toEqual([]);
    });

    it('frontend should have filesystem and playwright access', () => {
      expect(roleManager.isServerAllowedForRole('frontend', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('frontend', 'playwright')).toBe(true);
    });

    it('frontend should not have database access', () => {
      expect(roleManager.isServerAllowedForRole('frontend', 'database')).toBe(false);
    });

    it('fullstack should have all frontend and backend servers', () => {
      expect(roleManager.isServerAllowedForRole('fullstack', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('fullstack', 'playwright')).toBe(true);
      expect(roleManager.isServerAllowedForRole('fullstack', 'database')).toBe(true);
    });

    it('guest should only have filesystem access', () => {
      expect(roleManager.isServerAllowedForRole('guest', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('guest', 'playwright')).toBe(false);
    });
  });

  describe('System Tools', () => {
    it('system tool set_role should always be allowed', () => {
      expect(roleManager.isToolAllowedForRole('orchestrator', 'set_role', 'aegis-router')).toBe(true);
      expect(roleManager.isToolAllowedForRole('guest', 'set_role', 'aegis-router')).toBe(true);
    });
  });

  describe('Tool Permissions', () => {
    it('formatter should have docx tools', () => {
      expect(roleManager.isToolAllowedForRole('formatter', 'docx__parse', 'docx')).toBe(true);
      expect(roleManager.isToolAllowedForRole('formatter', 'docx__export', 'docx')).toBe(true);
    });

    it('reviewer should have git tools', () => {
      expect(roleManager.isToolAllowedForRole('reviewer', 'git__diff', 'git')).toBe(true);
      expect(roleManager.isToolAllowedForRole('reviewer', 'git__log', 'git')).toBe(true);
    });

    it('security should only have read tools', () => {
      expect(roleManager.isToolAllowedForRole('security', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('security', 'filesystem__write_file', 'filesystem')).toBe(false);
    });

    it('admin should have all tools from multiple skills', () => {
      // From docx-handler
      expect(roleManager.isToolAllowedForRole('admin', 'docx__parse', 'docx')).toBe(true);
      // From code-review
      expect(roleManager.isToolAllowedForRole('admin', 'git__diff', 'git')).toBe(true);
      // From teaching
      expect(roleManager.isToolAllowedForRole('admin', 'filesystem__list_directory', 'filesystem')).toBe(true);
    });
  });

  describe('Role Metadata', () => {
    it('all roles should be active by default', () => {
      const roles = roleManager.getAllRoles();
      for (const role of roles) {
        expect(role.metadata?.active).not.toBe(false);
      }
    });

    it('roles should have system instruction with skill info', () => {
      const formatter = roleManager.getRole('formatter');
      expect(formatter?.systemInstruction).toContain('formatter');
      expect(formatter?.systemInstruction).toContain('docx-handler');
    });
  });

  describe('List Roles', () => {
    it('should list all active roles', () => {
      const result = roleManager.listRoles();
      expect(result.roles.length).toBeGreaterThan(0);
    });

    it('should mark current role correctly', () => {
      const result = roleManager.listRoles({}, 'frontend');
      const frontendRole = result.roles.find(r => r.id === 'frontend');
      expect(frontendRole?.isCurrent).toBe(true);
    });
  });

  describe('Dynamic Role Generation', () => {
    it('should generate role manifest correctly', () => {
      const manifest = roleManager.generateRoleManifest(standardManifest);

      // Admin should have skills from multiple definitions
      expect(manifest.roles['admin'].skills).toContain('docx-handler');
      expect(manifest.roles['admin'].skills).toContain('code-review');
      expect(manifest.roles['admin'].skills).toContain('teaching');
    });

    it('should deduplicate tools across skills', () => {
      const manifest = roleManager.generateRoleManifest(standardManifest);

      // filesystem__read_file appears in multiple skills but should be unique
      const adminTools = manifest.roles['admin'].tools;
      const readFileCount = adminTools.filter(t => t === 'filesystem__read_file').length;
      expect(readFileCount).toBe(1);
    });
  });
});
