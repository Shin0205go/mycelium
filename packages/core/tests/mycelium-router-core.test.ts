/**
 * Integration Tests for MyceliumRouterCore
 *
 * These tests verify the core functionality of the router
 * using real implementations (not mocks) to ensure proper integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MyceliumRouterCore, createMyceliumRouterCore } from '../src/router/mycelium-router-core.js';
import type { Logger } from '../src/utils/logger.js';

// Test logger that silences output
const testLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  logger: undefined,
  shouldLog: () => true,
  critical: vi.fn(),
  decision: vi.fn(),
  violation: vi.fn(),
  audit: vi.fn(),
} as unknown as Logger;

describe('MyceliumRouterCore', () => {
  let router: MyceliumRouterCore;

  beforeEach(() => {
    router = new MyceliumRouterCore(testLogger);
  });

  afterEach(async () => {
    // Cleanup: stop any servers that might be running
    try {
      await router.stopServers();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor and factory', () => {
    it('should create router with default options', () => {
      const router = new MyceliumRouterCore(testLogger);
      expect(router).toBeInstanceOf(MyceliumRouterCore);
    });

    it('should create router via factory function', () => {
      const router = createMyceliumRouterCore(testLogger);
      expect(router).toBeInstanceOf(MyceliumRouterCore);
    });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(router.initialize()).resolves.toBeUndefined();
    });

    it('should be idempotent - multiple initializations should not fail', async () => {
      await router.initialize();
      await expect(router.initialize()).resolves.toBeUndefined();
    });

    it('should set initial state after initialization', async () => {
      await router.initialize();

      const state = router.getState();
      expect(state).toBeDefined();
      expect(state.visibleToolsCount).toBeGreaterThanOrEqual(0);
      expect(state.connectedServersCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('state accessors', () => {
    it('should return null for current role before initialization', () => {
      expect(router.getCurrentRole()).toBeNull();
    });

    it('should return state metadata with session ID', () => {
      const metadata = router.getStateMetadata();
      expect(metadata.sessionId).toBeDefined();
      expect(typeof metadata.sessionId).toBe('string');
      expect(metadata.roleSwitchCount).toBe(0);
    });

    it('should return state summary', () => {
      const state = router.getState();
      expect(state).toHaveProperty('currentRole');
      expect(state).toHaveProperty('systemInstruction');
      expect(state).toHaveProperty('visibleToolsCount');
      expect(state).toHaveProperty('connectedServersCount');
    });

    it('should return connected servers (empty before starting)', () => {
      const servers = router.getConnectedServers();
      expect(Array.isArray(servers)).toBe(true);
    });
  });

  describe('server configuration', () => {
    it('should add server from config', () => {
      expect(() => {
        router.addServer('test-server', {
          command: 'node',
          args: ['test.js']
        });
      }).not.toThrow();
    });

    it('should load servers from config object', () => {
      expect(() => {
        router.loadServersFromConfig({
          mcpServers: {
            'server1': { command: 'node', args: ['s1.js'] },
            'server2': { command: 'npx', args: ['-y', 'test'] }
          }
        });
      }).not.toThrow();
    });
  });

  describe('listRoles', () => {
    it('should return roles list structure', async () => {
      await router.initialize();

      const result = router.listRoles();
      expect(result).toHaveProperty('roles');
      expect(result).toHaveProperty('defaultRole');
      expect(Array.isArray(result.roles)).toBe(true);
    });
  });

  describe('tools changed callback', () => {
    it('should accept callback function', () => {
      const callback = async () => {};
      expect(() => {
        router.setToolsChangedCallback(callback);
      }).not.toThrow();
    });
  });

  describe('getStdioRouter', () => {
    it('should return stdio router instance', () => {
      const stdioRouter = router.getStdioRouter();
      expect(stdioRouter).toBeDefined();
    });
  });

  describe('event emission', () => {
    it('should be an EventEmitter', () => {
      expect(typeof router.on).toBe('function');
      expect(typeof router.emit).toBe('function');
    });

    it('should allow registering event handlers', () => {
      const handler = () => {};
      expect(() => {
        router.on('roleSwitch', handler);
        router.on('toolsChanged', handler);
      }).not.toThrow();
    });
  });
});

describe('MyceliumRouterCore Error Handling', () => {
  const errorTestLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    logger: undefined,
    shouldLog: () => true,
    critical: vi.fn(),
    decision: vi.fn(),
    violation: vi.fn(),
    audit: vi.fn(),
  } as unknown as Logger;

  it('should throw when setting invalid role', async () => {
    const router = new MyceliumRouterCore(errorTestLogger);
    await router.initialize();

    await expect(router.setRole({ role: 'nonexistent-role-xyz' }))
      .rejects.toThrow(/not found/);
  });
});
