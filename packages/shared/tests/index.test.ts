/**
 * Unit tests for @aegis/shared
 * Tests error classes and type exports
 */

import { describe, it, expect } from 'vitest';
import {
  RoleNotFoundError,
  ServerNotAccessibleError,
  ToolNotAccessibleError,
  type Role,
  type ToolPermissions,
  type RoleMetadata,
  type SkillGrants,
  type SkillMetadata,
  type ToolInfo,
  type RemoteInstruction,
  type ListRolesOptions,
  type ListRolesResult,
  type BaseSkillDefinition,
  type SkillManifest,
  type DynamicRole,
  type RoleManifest,
  type MemoryPolicy,
  type Logger,
} from '../src/index.js';

describe('@aegis/shared', () => {
  describe('RoleNotFoundError', () => {
    it('should create error with role ID and available roles', () => {
      const error = new RoleNotFoundError('admin', ['user', 'guest']);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RoleNotFoundError);
      expect(error.name).toBe('RoleNotFoundError');
      expect(error.roleId).toBe('admin');
      expect(error.availableRoles).toEqual(['user', 'guest']);
    });

    it('should format message correctly', () => {
      const error = new RoleNotFoundError('superuser', ['admin', 'editor']);

      expect(error.message).toBe(
        "Role 'superuser' not found. Available roles: admin, editor"
      );
    });

    it('should handle empty available roles', () => {
      const error = new RoleNotFoundError('any', []);

      expect(error.message).toBe("Role 'any' not found. Available roles: ");
      expect(error.availableRoles).toEqual([]);
    });

    it('should handle single available role', () => {
      const error = new RoleNotFoundError('admin', ['guest']);

      expect(error.message).toBe("Role 'admin' not found. Available roles: guest");
    });
  });

  describe('ServerNotAccessibleError', () => {
    it('should create error with server name, role, and allowed servers', () => {
      const error = new ServerNotAccessibleError('database', 'guest', ['web', 'cache']);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ServerNotAccessibleError);
      expect(error.name).toBe('ServerNotAccessibleError');
      expect(error.serverName).toBe('database');
      expect(error.currentRole).toBe('guest');
      expect(error.allowedServers).toEqual(['web', 'cache']);
    });

    it('should format message correctly', () => {
      const error = new ServerNotAccessibleError('production-db', 'viewer', ['cache', 'api']);

      expect(error.message).toBe(
        "Server 'production-db' is not accessible for role 'viewer'. Allowed servers: cache, api"
      );
    });

    it('should handle empty allowed servers', () => {
      const error = new ServerNotAccessibleError('any', 'restricted', []);

      expect(error.message).toContain('Allowed servers: ');
      expect(error.allowedServers).toEqual([]);
    });

    it('should handle wildcard in allowed servers', () => {
      const error = new ServerNotAccessibleError('secret', 'user', ['*']);

      expect(error.allowedServers).toEqual(['*']);
    });
  });

  describe('ToolNotAccessibleError', () => {
    it('should create error with tool name, role, and reason', () => {
      const error = new ToolNotAccessibleError('delete_file', 'viewer', 'denied by policy');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ToolNotAccessibleError);
      expect(error.name).toBe('ToolNotAccessibleError');
      expect(error.toolName).toBe('delete_file');
      expect(error.currentRole).toBe('viewer');
      expect(error.reason).toBe('denied by policy');
    });

    it('should format message correctly', () => {
      const error = new ToolNotAccessibleError('exec_bash', 'guest', 'high risk operation');

      expect(error.message).toBe(
        "Tool 'exec_bash' is not accessible for role 'guest': high risk operation"
      );
    });

    it('should handle prefixed tool names', () => {
      const error = new ToolNotAccessibleError(
        'filesystem__write_file',
        'readonly',
        'write operations blocked'
      );

      expect(error.toolName).toBe('filesystem__write_file');
      expect(error.message).toContain('filesystem__write_file');
    });
  });

  describe('Type exports', () => {
    it('should export Role interface', () => {
      const role: Role = {
        id: 'test',
        name: 'Test Role',
        description: 'A test role',
        allowedServers: ['server1'],
        systemInstruction: 'You are a test agent',
      };

      expect(role.id).toBe('test');
      expect(role.name).toBe('Test Role');
      expect(role.allowedServers).toContain('server1');
    });

    it('should export Role with optional fields', () => {
      const role: Role = {
        id: 'full',
        name: 'Full Role',
        description: 'Complete role',
        allowedServers: ['*'],
        systemInstruction: 'Full access',
        toolPermissions: {
          allow: ['tool1'],
          deny: ['dangerous_tool'],
          allowPatterns: ['read*'],
          denyPatterns: ['delete*'],
        },
        remoteInstruction: {
          backend: 'prompt-server',
          promptName: 'system-prompt',
          arguments: { type: 'admin' },
          cacheTtl: 300,
          fallback: 'Default instruction',
        },
        metadata: {
          version: '1.0.0',
          priority: 10,
          tags: ['admin'],
          active: true,
        },
      };

      expect(role.toolPermissions?.allow).toContain('tool1');
      expect(role.remoteInstruction?.backend).toBe('prompt-server');
      expect(role.metadata?.priority).toBe(10);
    });

    it('should export ToolPermissions interface', () => {
      const perms: ToolPermissions = {
        allow: ['read_file'],
        deny: ['delete_file'],
        allowPatterns: ['read*', 'list*'],
        denyPatterns: ['*_delete', '*_remove'],
      };

      expect(perms.allow).toContain('read_file');
      expect(perms.denyPatterns).toHaveLength(2);
    });

    it('should export RoleMetadata interface', () => {
      const metadata: RoleMetadata = {
        version: '2.0.0',
        createdAt: new Date('2024-01-01'),
        createdBy: 'system',
        lastModified: new Date(),
        priority: 5,
        tags: ['core', 'system'],
        active: true,
        skills: ['basic', 'advanced'],
      };

      expect(metadata.version).toBe('2.0.0');
      expect(metadata.skills).toContain('advanced');
    });

    it('should export SkillGrants interface', () => {
      const grants: SkillGrants = {
        memory: 'team',
        memoryTeamRoles: ['frontend', 'backend'],
      };

      expect(grants.memory).toBe('team');
      expect(grants.memoryTeamRoles).toContain('frontend');
    });

    it('should export MemoryPolicy type', () => {
      const policies: MemoryPolicy[] = ['none', 'isolated', 'team', 'all'];

      expect(policies).toHaveLength(4);
      expect(policies).toContain('isolated');
    });

    it('should export SkillMetadata interface', () => {
      const meta: SkillMetadata = {
        version: '1.0.0',
        category: 'development',
        author: 'test-author',
        tags: ['frontend', 'react'],
      };

      expect(meta.category).toBe('development');
      expect(meta.tags).toContain('react');
    });

    it('should export ToolInfo interface', () => {
      const toolInfo: ToolInfo = {
        tool: {
          name: 'read_file',
          inputSchema: { type: 'object' },
        },
        sourceServer: 'filesystem',
        prefixedName: 'filesystem__read_file',
        visible: true,
        visibilityReason: 'allowed by role',
      };

      expect(toolInfo.prefixedName).toBe('filesystem__read_file');
      expect(toolInfo.visible).toBe(true);
    });

    it('should export RemoteInstruction interface', () => {
      const remote: RemoteInstruction = {
        backend: 'prompt-server',
        promptName: 'agent-system',
        arguments: { mode: 'safe' },
        cacheTtl: 600,
        fallback: 'Default prompt',
      };

      expect(remote.backend).toBe('prompt-server');
      expect(remote.cacheTtl).toBe(600);
    });

    it('should export ListRolesOptions interface', () => {
      const options: ListRolesOptions = {
        includeInactive: true,
        tags: ['admin', 'system'],
      };

      expect(options.includeInactive).toBe(true);
      expect(options.tags).toContain('admin');
    });

    it('should export ListRolesResult interface', () => {
      const result: ListRolesResult = {
        roles: [
          {
            id: 'admin',
            name: 'Administrator',
            description: 'Full access',
            serverCount: 5,
            toolCount: 20,
            skills: ['admin-skill'],
            isActive: true,
            isCurrent: true,
          },
        ],
        currentRole: 'admin',
        defaultRole: 'guest',
      };

      expect(result.roles).toHaveLength(1);
      expect(result.currentRole).toBe('admin');
    });

    it('should export BaseSkillDefinition interface', () => {
      const skill: BaseSkillDefinition = {
        id: 'frontend-dev',
        displayName: 'Frontend Development',
        description: 'Tools for frontend work',
        allowedRoles: ['frontend', 'fullstack'],
        allowedTools: ['filesystem__read', 'web__fetch'],
        grants: { memory: 'isolated' },
        metadata: { category: 'development' },
      };

      expect(skill.id).toBe('frontend-dev');
      expect(skill.allowedRoles).toContain('fullstack');
    });

    it('should export SkillManifest interface', () => {
      const manifest: SkillManifest = {
        skills: [
          {
            id: 'skill1',
            displayName: 'Skill 1',
            description: 'Test',
            allowedRoles: ['*'],
            allowedTools: [],
          },
        ],
        version: '1.0.0',
        generatedAt: new Date(),
      };

      expect(manifest.skills).toHaveLength(1);
      expect(manifest.version).toBe('1.0.0');
    });

    it('should export DynamicRole interface', () => {
      const dynRole: DynamicRole = {
        id: 'dynamic-admin',
        skills: ['admin-skill', 'user-skill'],
        tools: ['tool1', 'tool2'],
      };

      expect(dynRole.id).toBe('dynamic-admin');
      expect(dynRole.skills).toHaveLength(2);
    });

    it('should export RoleManifest interface', () => {
      const manifest: RoleManifest = {
        roles: {
          admin: {
            id: 'admin',
            skills: ['admin-skill'],
            tools: ['all_tools'],
          },
        },
        sourceVersion: '1.0.0',
        generatedAt: new Date(),
      };

      expect(manifest.roles.admin.id).toBe('admin');
      expect(manifest.sourceVersion).toBe('1.0.0');
    });

    it('should export Logger interface', () => {
      const logger: Logger = {
        debug: (msg, meta) => {},
        info: (msg, meta) => {},
        warn: (msg, meta) => {},
        error: (msg, meta) => {},
      };

      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.error).toBe('function');
    });
  });

  describe('Error inheritance', () => {
    it('RoleNotFoundError should be catchable as Error', () => {
      const caught: Error[] = [];

      try {
        throw new RoleNotFoundError('test', []);
      } catch (e) {
        if (e instanceof Error) {
          caught.push(e);
        }
      }

      expect(caught).toHaveLength(1);
      expect(caught[0]).toBeInstanceOf(RoleNotFoundError);
    });

    it('ServerNotAccessibleError should be catchable as Error', () => {
      const caught: Error[] = [];

      try {
        throw new ServerNotAccessibleError('server', 'role', []);
      } catch (e) {
        if (e instanceof Error) {
          caught.push(e);
        }
      }

      expect(caught).toHaveLength(1);
      expect(caught[0]).toBeInstanceOf(ServerNotAccessibleError);
    });

    it('ToolNotAccessibleError should be catchable as Error', () => {
      const caught: Error[] = [];

      try {
        throw new ToolNotAccessibleError('tool', 'role', 'reason');
      } catch (e) {
        if (e instanceof Error) {
          caught.push(e);
        }
      }

      expect(caught).toHaveLength(1);
      expect(caught[0]).toBeInstanceOf(ToolNotAccessibleError);
    });
  });
});
