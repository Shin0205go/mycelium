/**
 * Skill Integration Tests
 *
 * Tests for v2 skill-driven dynamic role generation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RoleConfigManager } from '../src/router/role-manager.js';
import { Logger } from '../src/utils/logger.js';
import { join } from 'path';
import type { SkillManifest, SkillDefinition } from '../src/types/router-types.js';

// Set LOG_SILENT for tests
process.env.LOG_SILENT = 'true';
const testLogger = new Logger();

describe('Skill-Driven Role Generation', () => {
  let roleManager: RoleConfigManager;

  beforeAll(async () => {
    const projectRoot = process.cwd();
    roleManager = new RoleConfigManager(testLogger, {
      rolesDir: join(projectRoot, 'roles'),
    });
    await roleManager.initialize();
  });

  describe('generateRoleManifest', () => {
    it('should generate roles from skill definitions', () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'docx-handler',
            displayName: 'DOCX Handler',
            description: 'Handle DOCX files',
            allowedRoles: ['editor', 'admin'],
            allowedTools: ['filesystem__read_file', 'filesystem__write_file']
          },
          {
            id: 'code-reviewer',
            displayName: 'Code Reviewer',
            description: 'Review code',
            allowedRoles: ['developer', 'admin'],
            allowedTools: ['filesystem__read_file', 'git__status']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManifest = roleManager.generateRoleManifest(manifest);

      // Should have 3 roles: editor, developer, admin
      expect(Object.keys(roleManifest.roles)).toHaveLength(3);

      // Editor should have docx-handler skill
      expect(roleManifest.roles['editor'].skills).toContain('docx-handler');
      expect(roleManifest.roles['editor'].skills).not.toContain('code-reviewer');

      // Developer should have code-reviewer skill
      expect(roleManifest.roles['developer'].skills).toContain('code-reviewer');
      expect(roleManifest.roles['developer'].skills).not.toContain('docx-handler');

      // Admin should have both skills
      expect(roleManifest.roles['admin'].skills).toContain('docx-handler');
      expect(roleManifest.roles['admin'].skills).toContain('code-reviewer');
    });

    it('should aggregate tools from all skills for a role', () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'skill1',
            displayName: 'Skill 1',
            description: '',
            allowedRoles: ['dev'],
            allowedTools: ['tool_a', 'tool_b']
          },
          {
            id: 'skill2',
            displayName: 'Skill 2',
            description: '',
            allowedRoles: ['dev'],
            allowedTools: ['tool_b', 'tool_c']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManifest = roleManager.generateRoleManifest(manifest);

      // Dev should have all tools (deduplicated)
      const devTools = roleManifest.roles['dev'].tools;
      expect(devTools).toContain('tool_a');
      expect(devTools).toContain('tool_b');
      expect(devTools).toContain('tool_c');
      expect(devTools).toHaveLength(3); // No duplicates
    });

    it('should handle wildcard role (*)', () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'public-skill',
            displayName: 'Public Skill',
            description: '',
            allowedRoles: ['*'],
            allowedTools: ['public_tool']
          },
          {
            id: 'private-skill',
            displayName: 'Private Skill',
            description: '',
            allowedRoles: ['admin'],
            allowedTools: ['private_tool']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManifest = roleManager.generateRoleManifest(manifest);

      // Admin should have both public and private skills
      expect(roleManifest.roles['admin'].skills).toContain('public-skill');
      expect(roleManifest.roles['admin'].skills).toContain('private-skill');

      // Admin should have both tools
      expect(roleManifest.roles['admin'].tools).toContain('public_tool');
      expect(roleManifest.roles['admin'].tools).toContain('private_tool');
    });
  });

  describe('loadFromSkillManifest', () => {
    it('should create roles from skill manifest', async () => {
      // Create a fresh manager for this test
      const freshManager = new RoleConfigManager(testLogger, {
        rolesDir: join(process.cwd(), 'roles'),
      });

      const manifest: SkillManifest = {
        skills: [
          {
            id: 'test-skill',
            displayName: 'Test Skill',
            description: 'A test skill',
            allowedRoles: ['tester'],
            allowedTools: ['filesystem__read_file']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await freshManager.loadFromSkillManifest(manifest);

      // Should have tester role
      expect(freshManager.hasRole('tester')).toBe(true);

      // Role should be marked as skill-driven
      const role = freshManager.getRole('tester');
      expect(role?.metadata?.tags).toContain('skill-driven');
      expect(role?.metadata?.tags).toContain('dynamic');
    });
  });

  describe('Role Switching with Dynamic Roles', () => {
    it('should switch between dynamically generated roles', async () => {
      const freshManager = new RoleConfigManager(testLogger, {
        rolesDir: join(process.cwd(), 'roles'),
      });

      const manifest: SkillManifest = {
        skills: [
          {
            id: 'frontend-skill',
            displayName: 'Frontend Skill',
            description: 'Frontend development',
            allowedRoles: ['frontend', 'fullstack'],
            allowedTools: ['filesystem__read_file', 'filesystem__write_file']
          },
          {
            id: 'backend-skill',
            displayName: 'Backend Skill',
            description: 'Backend development',
            allowedRoles: ['backend', 'fullstack'],
            allowedTools: ['filesystem__read_file', 'database__query']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await freshManager.loadFromSkillManifest(manifest);

      // Should have 3 roles: frontend, backend, fullstack
      expect(freshManager.hasRole('frontend')).toBe(true);
      expect(freshManager.hasRole('backend')).toBe(true);
      expect(freshManager.hasRole('fullstack')).toBe(true);

      // Frontend role should only have frontend skill tools
      const frontendRole = freshManager.getRole('frontend');
      expect(frontendRole?.toolPermissions?.allowPatterns).toContain('filesystem__read_file');
      expect(frontendRole?.toolPermissions?.allowPatterns).toContain('filesystem__write_file');
      expect(frontendRole?.toolPermissions?.allowPatterns).not.toContain('database__query');

      // Backend role should only have backend skill tools
      const backendRole = freshManager.getRole('backend');
      expect(backendRole?.toolPermissions?.allowPatterns).toContain('filesystem__read_file');
      expect(backendRole?.toolPermissions?.allowPatterns).toContain('database__query');
      expect(backendRole?.toolPermissions?.allowPatterns).not.toContain('filesystem__write_file');

      // Fullstack role should have all tools
      const fullstackRole = freshManager.getRole('fullstack');
      expect(fullstackRole?.toolPermissions?.allowPatterns).toContain('filesystem__read_file');
      expect(fullstackRole?.toolPermissions?.allowPatterns).toContain('filesystem__write_file');
      expect(fullstackRole?.toolPermissions?.allowPatterns).toContain('database__query');
    });

    it('should update default role when switching from skill manifest', async () => {
      const freshManager = new RoleConfigManager(testLogger, {
        rolesDir: join(process.cwd(), 'roles'),
      });

      const manifest: SkillManifest = {
        skills: [
          {
            id: 'admin-skill',
            displayName: 'Admin Skill',
            description: 'Admin operations',
            allowedRoles: ['admin'],
            allowedTools: ['system__execute']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await freshManager.loadFromSkillManifest(manifest);

      // Default role should be set to first available
      const defaultRole = freshManager.getDefaultRole();
      expect(defaultRole).not.toBeNull();
      expect(defaultRole?.id).toBe('admin');
    });

    it('should generate correct system instruction for dynamic roles', async () => {
      const freshManager = new RoleConfigManager(testLogger, {
        rolesDir: join(process.cwd(), 'roles'),
      });

      const manifest: SkillManifest = {
        skills: [
          {
            id: 'data-analysis',
            displayName: 'Data Analysis',
            description: 'Analyze data',
            allowedRoles: ['analyst'],
            allowedTools: ['pandas__read_csv', 'numpy__calculate']
          },
          {
            id: 'visualization',
            displayName: 'Visualization',
            description: 'Create charts',
            allowedRoles: ['analyst'],
            allowedTools: ['matplotlib__plot']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await freshManager.loadFromSkillManifest(manifest);

      const analystRole = freshManager.getRole('analyst');
      expect(analystRole?.systemInstruction).toContain('analyst');
      expect(analystRole?.systemInstruction).toContain('data-analysis');
      expect(analystRole?.systemInstruction).toContain('visualization');
    });

    it('should extract server names from tool patterns', async () => {
      const freshManager = new RoleConfigManager(testLogger, {
        rolesDir: join(process.cwd(), 'roles'),
      });

      const manifest: SkillManifest = {
        skills: [
          {
            id: 'multi-server-skill',
            displayName: 'Multi Server Skill',
            description: 'Uses multiple servers',
            allowedRoles: ['power-user'],
            allowedTools: [
              'filesystem__read_file',
              'filesystem__write_file',
              'git__status',
              'git__commit',
              'playwright__navigate'
            ]
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await freshManager.loadFromSkillManifest(manifest);

      const role = freshManager.getRole('power-user');
      // Should have extracted 3 unique servers: filesystem, git, playwright
      expect(role?.allowedServers).toContain('filesystem');
      expect(role?.allowedServers).toContain('git');
      expect(role?.allowedServers).toContain('playwright');
      expect(role?.allowedServers).toHaveLength(3);
    });
  });
});
