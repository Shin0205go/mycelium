/**
 * Unit tests for router/router-adapter.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouterAdapter, createRouterAdapter } from '../src/router/router-adapter.js';
import type { Logger } from '@mycelium/shared';

// Silent test logger
const createTestLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('RouterAdapter', () => {
  let logger: Logger;
  let adapter: RouterAdapter;

  beforeEach(() => {
    logger = createTestLogger();
    adapter = new RouterAdapter(logger);
  });

  describe('constructor', () => {
    it('should create adapter', () => {
      expect(adapter).toBeInstanceOf(RouterAdapter);
    });

    it('should accept options', () => {
      const adapterWithOptions = new RouterAdapter(logger, {
        rolesDir: '/custom/roles',
        configFile: '/custom/config.json',
      });
      expect(adapterWithOptions).toBeInstanceOf(RouterAdapter);
    });
  });

  describe('createRouterAdapter factory', () => {
    it('should create adapter via factory', () => {
      const adapter = createRouterAdapter(logger);
      expect(adapter).toBeInstanceOf(RouterAdapter);
    });
  });

  describe('initialize', () => {
    it('should initialize without error', async () => {
      await expect(adapter.initialize()).resolves.toBeUndefined();
    });
  });

  describe('enable/disable', () => {
    it('should enable role-based routing', () => {
      expect(adapter.isEnabled()).toBe(false);
      adapter.enable();
      expect(adapter.isEnabled()).toBe(true);
    });

    it('should disable role-based routing', () => {
      adapter.enable();
      adapter.disable();
      expect(adapter.isEnabled()).toBe(false);
    });
  });

  describe('isManifestTool', () => {
    it('should return true for set_role', () => {
      expect(adapter.isManifestTool('set_role')).toBe(true);
    });

    it('should return false for other tools', () => {
      expect(adapter.isManifestTool('other_tool')).toBe(false);
      expect(adapter.isManifestTool('list_roles')).toBe(false);
    });
  });

  describe('getManifestToolDefinition', () => {
    it('should return set_role tool definition', () => {
      const tool = adapter.getManifestToolDefinition();

      expect(tool.name).toBe('set_role');
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.properties).toHaveProperty('role');
    });
  });

  describe('getListRolesToolDefinition', () => {
    it('should return list_roles tool definition', () => {
      const tool = adapter.getListRolesToolDefinition();

      expect(tool.name).toBe('list_roles');
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe('handleSetRole', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return error for invalid role', async () => {
      const result = await adapter.handleSetRole({ role_id: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('handleListRoles', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return roles list', async () => {
      const result = await adapter.handleListRoles({});

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Roles');
    });
  });

  describe('checkToolAccess', () => {
    it('should allow all tools when disabled', () => {
      expect(adapter.checkToolAccess('any_tool')).toBeNull();
    });

    it('should allow set_role when enabled', () => {
      adapter.enable();
      expect(adapter.checkToolAccess('set_role')).toBeNull();
    });

    it('should allow tools when no role set', async () => {
      await adapter.initialize();
      adapter.enable();
      expect(adapter.checkToolAccess('some_tool')).toBeNull();
    });
  });

  describe('filterToolsList', () => {
    it('should add manifest tool when disabled', () => {
      const tools = adapter.filterToolsList([
        { name: 'tool1', inputSchema: { type: 'object' } },
      ]);

      expect(tools.some(t => t.name === 'set_role')).toBe(true);
    });

    it('should include original tools', () => {
      const original = [
        { name: 'tool1', inputSchema: { type: 'object' as const } },
        { name: 'tool2', inputSchema: { type: 'object' as const } },
      ];
      const tools = adapter.filterToolsList(original);

      expect(tools.some(t => t.name === 'tool1')).toBe(true);
      expect(tools.some(t => t.name === 'tool2')).toBe(true);
    });
  });

  describe('server management', () => {
    it('should add server', () => {
      expect(() => {
        adapter.addServer('test-server', {
          command: 'node',
          args: ['server.js'],
        });
      }).not.toThrow();
    });

    it('should load servers from config', () => {
      expect(() => {
        adapter.loadServersFromConfig({
          mcpServers: {
            server1: { command: 'node', args: ['s1.js'] },
          },
        });
      }).not.toThrow();
    });

    it('should start and stop servers', async () => {
      await expect(adapter.startServers()).resolves.toBeUndefined();
      await expect(adapter.stopServers()).resolves.toBeUndefined();
    });
  });

  describe('notification callback', () => {
    it('should accept notification callback', () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      expect(() => adapter.setNotificationCallback(callback)).not.toThrow();
    });
  });

  describe('getCurrentRoleId', () => {
    it('should return null when no role set', async () => {
      await adapter.initialize();
      expect(adapter.getCurrentRoleId()).toBeNull();
    });
  });

  describe('getStateMetadata', () => {
    it('should return state metadata', () => {
      const metadata = adapter.getStateMetadata();
      expect(metadata).toBeDefined();
      expect(metadata.sessionId).toBeDefined();
    });
  });

  describe('getConnectedServers', () => {
    it('should return connected servers array', () => {
      const servers = adapter.getConnectedServers();
      expect(Array.isArray(servers)).toBe(true);
    });
  });

  describe('reloadRoles', () => {
    it('should reload roles without error', async () => {
      await adapter.initialize();
      await expect(adapter.reloadRoles()).resolves.toBeUndefined();
    });
  });

  describe('getRouterCore', () => {
    it('should return router core instance', () => {
      const core = adapter.getRouterCore();
      expect(core).toBeDefined();
    });
  });

  describe('getStdioRouter', () => {
    it('should return stdio router instance', () => {
      const router = adapter.getStdioRouter();
      expect(router).toBeDefined();
    });
  });
});
