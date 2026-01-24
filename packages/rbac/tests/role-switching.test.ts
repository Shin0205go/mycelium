/**
 * Role Switching Tests
 *
 * Tests for AegisRouterCore role switching functionality
 * Verifies that tools and skills change correctly when switching roles
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoleManager } from '../src/role-manager.js';
import type { Logger, SkillManifest, BaseSkillDefinition } from '@mycelium/shared';

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('Role Switching - Tool and Skill Changes', () => {
  let roleManager: RoleManager;

  beforeEach(async () => {
    roleManager = new RoleManager(testLogger);
  });

  describe('Tool visibility changes on role switch', () => {
    it('should have different tools for different roles', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'file-editor',
            displayName: 'File Editor',
            description: 'Edit files',
            allowedRoles: ['editor'],
            allowedTools: ['filesystem__read_file', 'filesystem__write_file', 'filesystem__delete_file']
          },
          {
            id: 'file-viewer',
            displayName: 'File Viewer',
            description: 'View files only',
            allowedRoles: ['viewer'],
            allowedTools: ['filesystem__read_file', 'filesystem__list_directory']
          },
          {
            id: 'admin-tools',
            displayName: 'Admin Tools',
            description: 'Admin operations',
            allowedRoles: ['admin'],
            allowedTools: ['filesystem__read_file', 'filesystem__write_file', 'system__execute', 'system__shutdown']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Get roles
      const editorRole = roleManager.getRole('editor');
      const viewerRole = roleManager.getRole('viewer');
      const adminRole = roleManager.getRole('admin');

      // Editor can edit files
      expect(editorRole?.toolPermissions?.allowPatterns).toContain('filesystem__write_file');
      expect(editorRole?.toolPermissions?.allowPatterns).toContain('filesystem__delete_file');
      expect(editorRole?.toolPermissions?.allowPatterns).not.toContain('system__execute');

      // Viewer can only read
      expect(viewerRole?.toolPermissions?.allowPatterns).toContain('filesystem__read_file');
      expect(viewerRole?.toolPermissions?.allowPatterns).toContain('filesystem__list_directory');
      expect(viewerRole?.toolPermissions?.allowPatterns).not.toContain('filesystem__write_file');
      expect(viewerRole?.toolPermissions?.allowPatterns).not.toContain('filesystem__delete_file');

      // Admin can do everything including system operations
      expect(adminRole?.toolPermissions?.allowPatterns).toContain('filesystem__write_file');
      expect(adminRole?.toolPermissions?.allowPatterns).toContain('system__execute');
      expect(adminRole?.toolPermissions?.allowPatterns).toContain('system__shutdown');
    });

    it('should correctly filter tools using isToolAllowedForRole', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'read-skill',
            displayName: 'Read Skill',
            description: 'Read only',
            allowedRoles: ['reader'],
            allowedTools: ['filesystem__read_file']
          },
          {
            id: 'write-skill',
            displayName: 'Write Skill',
            description: 'Write files',
            allowedRoles: ['writer'],
            allowedTools: ['filesystem__write_file']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Reader can only read
      expect(roleManager.isToolAllowedForRole('reader', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('reader', 'filesystem__write_file', 'filesystem')).toBe(false);

      // Writer can only write
      expect(roleManager.isToolAllowedForRole('writer', 'filesystem__write_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('writer', 'filesystem__read_file', 'filesystem')).toBe(false);
    });
  });

  describe('Skill assignment changes on role switch', () => {
    it('should assign correct skills to each role', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'docx-handler',
            displayName: 'DOCX Handler',
            description: 'Handle DOCX files',
            allowedRoles: ['document-editor', 'admin'],
            allowedTools: ['docx__read', 'docx__write']
          },
          {
            id: 'pdf-handler',
            displayName: 'PDF Handler',
            description: 'Handle PDF files',
            allowedRoles: ['document-editor', 'admin'],
            allowedTools: ['pdf__read', 'pdf__export']
          },
          {
            id: 'code-formatter',
            displayName: 'Code Formatter',
            description: 'Format code',
            allowedRoles: ['developer', 'admin'],
            allowedTools: ['prettier__format', 'eslint__fix']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      // Generate role manifest to check skill assignments
      const roleManifest = roleManager.generateRoleManifest(manifest);

      // Document editor should have document skills only
      expect(roleManifest.roles['document-editor'].skills).toContain('docx-handler');
      expect(roleManifest.roles['document-editor'].skills).toContain('pdf-handler');
      expect(roleManifest.roles['document-editor'].skills).not.toContain('code-formatter');

      // Developer should have code skill only
      expect(roleManifest.roles['developer'].skills).toContain('code-formatter');
      expect(roleManifest.roles['developer'].skills).not.toContain('docx-handler');

      // Admin should have all skills
      expect(roleManifest.roles['admin'].skills).toContain('docx-handler');
      expect(roleManifest.roles['admin'].skills).toContain('pdf-handler');
      expect(roleManifest.roles['admin'].skills).toContain('code-formatter');
    });

    it('should aggregate tools from multiple skills for same role', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'skill-a',
            displayName: 'Skill A',
            description: '',
            allowedRoles: ['multi-skill-user'],
            allowedTools: ['server1__tool1', 'server1__tool2']
          },
          {
            id: 'skill-b',
            displayName: 'Skill B',
            description: '',
            allowedRoles: ['multi-skill-user'],
            allowedTools: ['server2__tool1', 'server2__tool2']
          },
          {
            id: 'skill-c',
            displayName: 'Skill C',
            description: '',
            allowedRoles: ['multi-skill-user'],
            allowedTools: ['server1__tool1', 'server3__tool1'] // Overlapping tool
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const roleManifest = roleManager.generateRoleManifest(manifest);
      const userRole = roleManifest.roles['multi-skill-user'];

      // Should have all 3 skills
      expect(userRole.skills).toHaveLength(3);
      expect(userRole.skills).toContain('skill-a');
      expect(userRole.skills).toContain('skill-b');
      expect(userRole.skills).toContain('skill-c');

      // Should have 5 unique tools (server1__tool1 appears twice but deduplicated)
      expect(userRole.tools).toContain('server1__tool1');
      expect(userRole.tools).toContain('server1__tool2');
      expect(userRole.tools).toContain('server2__tool1');
      expect(userRole.tools).toContain('server2__tool2');
      expect(userRole.tools).toContain('server3__tool1');
      expect(userRole.tools).toHaveLength(5);
    });
  });

  describe('Server access changes on role switch', () => {
    it('should update allowed servers based on tools', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'local-skill',
            displayName: 'Local Skill',
            description: 'Local operations',
            allowedRoles: ['local-user'],
            allowedTools: ['filesystem__read', 'filesystem__write']
          },
          {
            id: 'web-skill',
            displayName: 'Web Skill',
            description: 'Web operations',
            allowedRoles: ['web-user'],
            allowedTools: ['playwright__navigate', 'playwright__screenshot', 'fetch__get']
          },
          {
            id: 'full-access',
            displayName: 'Full Access',
            description: 'All operations',
            allowedRoles: ['super-user'],
            allowedTools: ['filesystem__read', 'playwright__navigate', 'fetch__get', 'git__commit']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const localRole = roleManager.getRole('local-user');
      const webRole = roleManager.getRole('web-user');
      const superRole = roleManager.getRole('super-user');

      // Local user only has filesystem access
      expect(localRole?.allowedServers).toContain('filesystem');
      expect(localRole?.allowedServers).not.toContain('playwright');
      expect(localRole?.allowedServers).not.toContain('fetch');

      // Web user has playwright and fetch access
      expect(webRole?.allowedServers).toContain('playwright');
      expect(webRole?.allowedServers).toContain('fetch');
      expect(webRole?.allowedServers).not.toContain('filesystem');

      // Super user has all servers
      expect(superRole?.allowedServers).toContain('filesystem');
      expect(superRole?.allowedServers).toContain('playwright');
      expect(superRole?.allowedServers).toContain('fetch');
      expect(superRole?.allowedServers).toContain('git');
    });
  });

  describe('Role metadata on switch', () => {
    it('should track skill-driven roles with proper metadata', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'test-skill',
            displayName: 'Test Skill',
            description: 'For testing',
            allowedRoles: ['test-role'],
            allowedTools: ['test__tool']
          }
        ],
        version: '2.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const role = roleManager.getRole('test-role');

      // Should have skill-driven metadata
      expect(role?.metadata?.tags).toContain('skill-driven');
      expect(role?.metadata?.tags).toContain('dynamic');

      // System instruction should mention the skills
      expect(role?.systemInstruction).toContain('test-role');
      expect(role?.systemInstruction).toContain('test-skill');
    });

    it('should have different system instructions per role', async () => {
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: [
          {
            id: 'analyst-skill',
            displayName: 'Analyst Skill',
            description: 'Data analysis',
            allowedRoles: ['analyst'],
            allowedTools: ['data__analyze']
          },
          {
            id: 'reporter-skill',
            displayName: 'Reporter Skill',
            description: 'Report generation',
            allowedRoles: ['reporter'],
            allowedTools: ['report__generate']
          }
        ],
        version: '1.0.0',
        generatedAt: new Date()
      };

      await roleManager.loadFromSkillManifest(manifest);

      const analystRole = roleManager.getRole('analyst');
      const reporterRole = roleManager.getRole('reporter');

      // Each role should have unique instruction
      expect(analystRole?.systemInstruction).toContain('analyst');
      expect(analystRole?.systemInstruction).toContain('analyst-skill');
      expect(analystRole?.systemInstruction).not.toContain('reporter-skill');

      expect(reporterRole?.systemInstruction).toContain('reporter');
      expect(reporterRole?.systemInstruction).toContain('reporter-skill');
      expect(reporterRole?.systemInstruction).not.toContain('analyst-skill');
    });
  });
});
