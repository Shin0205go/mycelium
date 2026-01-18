/**
 * Memory Permission Tests
 *
 * Tests covering skill-granted memory access:
 * 1. Default OFF - roles without memory skill have no memory access
 * 2. Isolated policy - can only access own memories
 * 3. Team policy - can access specified team roles' memories
 * 4. All policy - can access all roles' memories
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoleManager, RoleMemoryPermission } from '../src/role-manager.js';
import type { Logger, SkillManifest, BaseSkillDefinition } from '@mycelium/shared';

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('Memory Permission - Skill Grants', () => {
  let roleManager: RoleManager;

  beforeEach(async () => {
    roleManager = new RoleManager(testLogger);
    await roleManager.initialize();
  });

  describe('Default OFF - No Memory Access', () => {
    it('should deny memory access when no skill grants memory', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'basic-skill',
            displayName: 'Basic Skill',
            description: 'A skill without memory grants',
            allowedRoles: ['viewer'],
            allowedTools: ['read_file'],
            // No grants.memory defined
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      expect(roleManager.hasMemoryAccess('viewer')).toBe(false);
      expect(roleManager.getMemoryPermission('viewer').policy).toBe('none');
    });

    it('should deny memory access for roles with grants.memory = none', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'no-memory-skill',
            displayName: 'No Memory Skill',
            description: 'Explicitly no memory',
            allowedRoles: ['guest'],
            allowedTools: ['view_status'],
            grants: { memory: 'none' },
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      expect(roleManager.hasMemoryAccess('guest')).toBe(false);
    });
  });

  describe('Isolated Policy', () => {
    it('should grant isolated memory access via skill', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'memory-basic',
            displayName: 'Basic Memory',
            description: 'Skill with isolated memory',
            allowedRoles: ['developer'],
            allowedTools: [],
            grants: { memory: 'isolated' },
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      expect(roleManager.hasMemoryAccess('developer')).toBe(true);
      expect(roleManager.getMemoryPermission('developer').policy).toBe('isolated');
    });

    it('should allow access to own memory only with isolated policy', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'memory-isolated',
            displayName: 'Isolated Memory',
            description: 'Isolated memory access',
            allowedRoles: ['frontend', 'backend'],
            allowedTools: [],
            grants: { memory: 'isolated' },
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Frontend can access own memory
      expect(roleManager.canAccessRoleMemory('frontend', 'frontend')).toBe(true);
      // Frontend cannot access backend's memory
      expect(roleManager.canAccessRoleMemory('frontend', 'backend')).toBe(false);
      // Backend can access own memory
      expect(roleManager.canAccessRoleMemory('backend', 'backend')).toBe(true);
      // Backend cannot access frontend's memory
      expect(roleManager.canAccessRoleMemory('backend', 'frontend')).toBe(false);
    });
  });

  describe('Team Policy', () => {
    it('should grant team memory access via skill', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'team-memory',
            displayName: 'Team Memory',
            description: 'Access team memories',
            allowedRoles: ['lead'],
            allowedTools: [],
            grants: {
              memory: 'team',
              memoryTeamRoles: ['frontend', 'backend'],
            },
          },
          {
            id: 'basic-skill',
            displayName: 'Basic',
            description: 'Basic skill',
            allowedRoles: ['frontend', 'backend'],
            allowedTools: ['read'],
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      expect(roleManager.hasMemoryAccess('lead')).toBe(true);
      expect(roleManager.getMemoryPermission('lead').policy).toBe('team');
      expect(roleManager.getMemoryPermission('lead').teamRoles).toContain('frontend');
      expect(roleManager.getMemoryPermission('lead').teamRoles).toContain('backend');
    });

    it('should allow access to team members memories only', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'team-memory',
            displayName: 'Team Memory',
            description: 'Access team memories',
            allowedRoles: ['lead'],
            allowedTools: [],
            grants: {
              memory: 'team',
              memoryTeamRoles: ['frontend', 'backend'],
            },
          },
          {
            id: 'basic-skill',
            displayName: 'Basic',
            description: 'Basic skill',
            allowedRoles: ['frontend', 'backend', 'security'],
            allowedTools: ['read'],
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Lead can access own memory
      expect(roleManager.canAccessRoleMemory('lead', 'lead')).toBe(true);
      // Lead can access frontend's memory
      expect(roleManager.canAccessRoleMemory('lead', 'frontend')).toBe(true);
      // Lead can access backend's memory
      expect(roleManager.canAccessRoleMemory('lead', 'backend')).toBe(true);
      // Lead cannot access security's memory (not in team)
      expect(roleManager.canAccessRoleMemory('lead', 'security')).toBe(false);
    });
  });

  describe('All Policy (Admin Level)', () => {
    it('should grant all memory access via skill', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'admin-memory',
            displayName: 'Admin Memory',
            description: 'Full memory access',
            allowedRoles: ['admin'],
            allowedTools: [],
            grants: { memory: 'all' },
          },
          {
            id: 'basic-skill',
            displayName: 'Basic',
            description: 'Basic skill',
            allowedRoles: ['user1', 'user2'],
            allowedTools: ['read'],
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      expect(roleManager.hasMemoryAccess('admin')).toBe(true);
      expect(roleManager.getMemoryPermission('admin').policy).toBe('all');
      expect(roleManager.canAccessAllMemories('admin')).toBe(true);
    });

    it('should allow access to any role memory with all policy', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'admin-memory',
            displayName: 'Admin Memory',
            description: 'Full memory access',
            allowedRoles: ['admin'],
            allowedTools: [],
            grants: { memory: 'all' },
          },
          {
            id: 'isolated-memory',
            displayName: 'Isolated',
            description: 'Isolated memory',
            allowedRoles: ['dev', 'ops'],
            allowedTools: [],
            grants: { memory: 'isolated' },
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Admin can access any role
      expect(roleManager.canAccessRoleMemory('admin', 'admin')).toBe(true);
      expect(roleManager.canAccessRoleMemory('admin', 'dev')).toBe(true);
      expect(roleManager.canAccessRoleMemory('admin', 'ops')).toBe(true);
      expect(roleManager.canAccessRoleMemory('admin', 'nonexistent')).toBe(true);
    });
  });

  describe('Policy Priority (Higher Wins)', () => {
    it('should use highest memory policy when role has multiple skills', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'isolated-skill',
            displayName: 'Isolated',
            description: 'Isolated memory',
            allowedRoles: ['developer'],
            allowedTools: ['code_read'],
            grants: { memory: 'isolated' },
          },
          {
            id: 'team-skill',
            displayName: 'Team',
            description: 'Team memory',
            allowedRoles: ['developer'],
            allowedTools: ['team_chat'],
            grants: {
              memory: 'team',
              memoryTeamRoles: ['qa'],
            },
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      // team > isolated, so developer should have team access
      expect(roleManager.getMemoryPermission('developer').policy).toBe('team');
    });

    it('should give all policy priority over team', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'team-skill',
            displayName: 'Team',
            description: 'Team memory',
            allowedRoles: ['superuser'],
            allowedTools: [],
            grants: {
              memory: 'team',
              memoryTeamRoles: ['a', 'b'],
            },
          },
          {
            id: 'all-skill',
            displayName: 'All',
            description: 'Full memory',
            allowedRoles: ['superuser'],
            allowedTools: [],
            grants: { memory: 'all' },
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      // all > team
      expect(roleManager.getMemoryPermission('superuser').policy).toBe('all');
      expect(roleManager.canAccessAllMemories('superuser')).toBe(true);
    });

    it('should merge team roles when multiple team skills apply', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'team-a',
            displayName: 'Team A',
            description: 'Access team A',
            allowedRoles: ['coordinator'],
            allowedTools: [],
            grants: {
              memory: 'team',
              memoryTeamRoles: ['dev1', 'dev2'],
            },
          },
          {
            id: 'team-b',
            displayName: 'Team B',
            description: 'Access team B',
            allowedRoles: ['coordinator'],
            allowedTools: [],
            grants: {
              memory: 'team',
              memoryTeamRoles: ['ops1', 'ops2'],
            },
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      const permission = roleManager.getMemoryPermission('coordinator');
      expect(permission.policy).toBe('team');
      expect(permission.teamRoles).toContain('dev1');
      expect(permission.teamRoles).toContain('dev2');
      expect(permission.teamRoles).toContain('ops1');
      expect(permission.teamRoles).toContain('ops2');
    });
  });

  describe('Wildcard Role Memory Grants', () => {
    it('should ignore wildcard memory grants', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'global-memory',
            displayName: 'Global Memory',
            description: 'Wildcard - should be ignored',
            allowedRoles: ['*'],
            allowedTools: [],
            grants: { memory: 'isolated' },
          },
          {
            id: 'basic-skill',
            displayName: 'Basic',
            description: 'Creates roles',
            allowedRoles: ['user', 'editor'],
            allowedTools: ['read'],
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Roles should NOT have memory (wildcard grant is ignored)
      expect(roleManager.hasMemoryAccess('user')).toBe(false);
      expect(roleManager.hasMemoryAccess('editor')).toBe(false);
      expect(roleManager.getMemoryPermission('user').policy).toBe('none');
      expect(roleManager.getMemoryPermission('editor').policy).toBe('none');
    });
  });

  describe('Edge Cases', () => {
    it('should handle role with no skills gracefully', () => {
      expect(roleManager.hasMemoryAccess('nonexistent')).toBe(false);
      expect(roleManager.getMemoryPermission('nonexistent').policy).toBe('none');
    });

    it('should handle empty skill manifest', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      await roleManager.loadFromSkillManifest(manifest);

      expect(roleManager.hasMemoryAccess('any')).toBe(false);
    });
  });
});
