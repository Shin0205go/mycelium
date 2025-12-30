/**
 * Skill Integration Tests
 *
 * Tests for v2 skill-driven dynamic role generation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RoleConfigManager } from '../src/router/role-config.js';
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
      configFile: join(projectRoot, 'roles', 'aegis-roles.json'),
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
        configFile: join(process.cwd(), 'roles', 'aegis-roles.json'),
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
});
