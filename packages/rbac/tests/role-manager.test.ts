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
import { RoleManager } from '../src/role-manager.js';
import type { Logger, SkillManifest, BaseSkillDefinition } from '@aegis/shared';

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('RoleManager (Skill-Driven)', () => {
  let roleManager: RoleManager;

  // Standard skill manifest for tests
  const standardManifest: SkillManifest<BaseSkillDefinition> = {
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
    roleManager = new RoleManager(testLogger);
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

describe('Role Inheritance', () => {
  let roleManager: RoleManager;

  beforeEach(async () => {
    roleManager = new RoleManager(testLogger);
    await roleManager.initialize();
  });

  describe('Inheritance Chain', () => {
    it('should build inheritance chain correctly', async () => {
      // Manually add roles with inheritance
      const baseManifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'base-skill',
            displayName: 'Base',
            description: 'Base access',
            allowedRoles: ['base'],
            allowedTools: ['filesystem__read_file']
          },
          {
            id: 'developer-skill',
            displayName: 'Developer',
            description: 'Developer access',
            allowedRoles: ['developer'],
            allowedTools: ['filesystem__write_file']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(baseManifest);

      // Manually set inheritance (simulating YAML config with inherits)
      const devRole = roleManager.getRole('developer');
      if (devRole) {
        devRole.inherits = 'base';
      }

      const chain = roleManager.getInheritanceChain('developer');
      expect(chain).toEqual(['developer', 'base']);
    });

    it('should detect circular inheritance', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'a-skill', displayName: 'A', description: 'A', allowedRoles: ['role-a'], allowedTools: [] },
          { id: 'b-skill', displayName: 'B', description: 'B', allowedRoles: ['role-b'], allowedTools: [] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Create circular inheritance: A -> B -> A
      const roleA = roleManager.getRole('role-a');
      const roleB = roleManager.getRole('role-b');
      if (roleA) roleA.inherits = 'role-b';
      if (roleB) roleB.inherits = 'role-a';

      const chain = roleManager.getInheritanceChain('role-a');
      expect(chain).toEqual([]); // Empty chain on circular reference
    });

    it('should handle role without inheritance', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'standalone', displayName: 'Standalone', description: 'No parent', allowedRoles: ['standalone'], allowedTools: ['tool__a'] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const chain = roleManager.getInheritanceChain('standalone');
      expect(chain).toEqual(['standalone']);
    });
  });

  describe('Effective Servers', () => {
    it('should inherit servers from parent role', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'base-skill', displayName: 'Base', description: 'Base', allowedRoles: ['base'], allowedTools: ['filesystem__read_file'] },
          { id: 'child-skill', displayName: 'Child', description: 'Child', allowedRoles: ['child'], allowedTools: ['git__log'] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const childRole = roleManager.getRole('child');
      if (childRole) childRole.inherits = 'base';

      const effectiveServers = roleManager.getEffectiveServers('child');
      expect(effectiveServers).toContain('filesystem');
      expect(effectiveServers).toContain('git');
    });

    it('should merge servers from multiple ancestors', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'grandparent-skill', displayName: 'Grandparent', description: 'GP', allowedRoles: ['grandparent'], allowedTools: ['db__query'] },
          { id: 'parent-skill', displayName: 'Parent', description: 'P', allowedRoles: ['parent'], allowedTools: ['filesystem__read_file'] },
          { id: 'child-skill', displayName: 'Child', description: 'C', allowedRoles: ['child'], allowedTools: ['git__log'] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const parentRole = roleManager.getRole('parent');
      const childRole = roleManager.getRole('child');
      if (parentRole) parentRole.inherits = 'grandparent';
      if (childRole) childRole.inherits = 'parent';

      const effectiveServers = roleManager.getEffectiveServers('child');
      expect(effectiveServers).toContain('db');
      expect(effectiveServers).toContain('filesystem');
      expect(effectiveServers).toContain('git');
    });
  });

  describe('Effective Tool Permissions', () => {
    it('should merge tool permissions from parent', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'base-skill', displayName: 'Base', description: 'Base', allowedRoles: ['base'], allowedTools: ['filesystem__read_file'] },
          { id: 'child-skill', displayName: 'Child', description: 'Child', allowedRoles: ['child'], allowedTools: ['filesystem__write_file'] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const childRole = roleManager.getRole('child');
      if (childRole) childRole.inherits = 'base';

      const effectivePerms = roleManager.getEffectiveToolPermissions('child');
      expect(effectivePerms.allowPatterns).toContain('filesystem__read_file');
      expect(effectivePerms.allowPatterns).toContain('filesystem__write_file');
    });

    it('should check tool access through inheritance', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'base-skill', displayName: 'Base', description: 'Base', allowedRoles: ['base'], allowedTools: ['filesystem__read_file'] },
          { id: 'senior-skill', displayName: 'Senior', description: 'Senior', allowedRoles: ['senior'], allowedTools: ['filesystem__delete'] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const seniorRole = roleManager.getRole('senior');
      if (seniorRole) seniorRole.inherits = 'base';

      // Senior should have access to both own tool and inherited tool
      expect(roleManager.isToolAllowedForRole('senior', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('senior', 'filesystem__delete', 'filesystem')).toBe(true);

      // Base should only have read access
      expect(roleManager.isToolAllowedForRole('base', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('base', 'filesystem__delete', 'filesystem')).toBe(false);
    });

    it('should check server access through inheritance', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'base-skill', displayName: 'Base', description: 'Base', allowedRoles: ['base'], allowedTools: ['filesystem__read_file'] },
          { id: 'db-skill', displayName: 'DB', description: 'DB', allowedRoles: ['db-user'], allowedTools: ['database__query'] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const dbRole = roleManager.getRole('db-user');
      if (dbRole) dbRole.inherits = 'base';

      // DB user should have access to both database and filesystem servers
      expect(roleManager.isServerAllowedForRole('db-user', 'database')).toBe(true);
      expect(roleManager.isServerAllowedForRole('db-user', 'filesystem')).toBe(true);

      // Base should only have filesystem access
      expect(roleManager.isServerAllowedForRole('base', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('base', 'database')).toBe(false);
    });
  });

  describe('Multi-Level Inheritance', () => {
    it('should support 3+ levels of inheritance', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          { id: 'l1-skill', displayName: 'L1', description: 'Level 1', allowedRoles: ['level1'], allowedTools: ['tool__a'] },
          { id: 'l2-skill', displayName: 'L2', description: 'Level 2', allowedRoles: ['level2'], allowedTools: ['tool__b'] },
          { id: 'l3-skill', displayName: 'L3', description: 'Level 3', allowedRoles: ['level3'], allowedTools: ['tool__c'] },
          { id: 'l4-skill', displayName: 'L4', description: 'Level 4', allowedRoles: ['level4'], allowedTools: ['tool__d'] }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const level2 = roleManager.getRole('level2');
      const level3 = roleManager.getRole('level3');
      const level4 = roleManager.getRole('level4');

      if (level2) level2.inherits = 'level1';
      if (level3) level3.inherits = 'level2';
      if (level4) level4.inherits = 'level3';

      // Level 4 should have access to all tools through inheritance
      const chain = roleManager.getInheritanceChain('level4');
      expect(chain).toEqual(['level4', 'level3', 'level2', 'level1']);

      const effectivePerms = roleManager.getEffectiveToolPermissions('level4');
      expect(effectivePerms.allowPatterns).toContain('tool__a');
      expect(effectivePerms.allowPatterns).toContain('tool__b');
      expect(effectivePerms.allowPatterns).toContain('tool__c');
      expect(effectivePerms.allowPatterns).toContain('tool__d');
    });
  });
});
