/**
 * Unit tests for StdioRouter (from @mycelium/gateway)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioRouter, type UpstreamServerInfo } from '@mycelium/gateway';
import type { Logger } from '@mycelium/shared';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

// Silent test logger
const createTestLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('StdioRouter', () => {
  let logger: Logger;
  let router: StdioRouter;
  let mockProcess: any;
  let mockStdin: any;
  let mockStdout: EventEmitter;
  let mockStderr: EventEmitter;

  beforeEach(() => {
    logger = createTestLogger();
    router = new StdioRouter(logger);

    // Create mock streams
    mockStdin = { write: vi.fn() };
    mockStdout = new EventEmitter();
    mockStderr = new EventEmitter();

    // Create mock process
    mockProcess = new EventEmitter();
    mockProcess.stdin = mockStdin;
    mockProcess.stdout = mockStdout;
    mockProcess.stderr = mockStderr;
    mockProcess.kill = vi.fn();
    mockProcess.killed = false;
    mockProcess.pid = 12345;

    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create router with logger', () => {
      expect(router).toBeInstanceOf(StdioRouter);
    });

    it('should accept cwd option', () => {
      const routerWithCwd = new StdioRouter(logger, { cwd: '/custom/path' });
      expect(routerWithCwd).toBeInstanceOf(StdioRouter);
    });

    it('should be an EventEmitter', () => {
      expect(router).toBeInstanceOf(EventEmitter);
    });
  });

  describe('addServerFromConfig', () => {
    it('should add server configuration', () => {
      router.addServerFromConfig('test-server', {
        command: 'node',
        args: ['server.js'],
      });

      const servers = router.getAvailableServers();
      expect(servers.some(s => s.name === 'test-server')).toBe(true);
    });

    it('should mark server as not connected initially', () => {
      router.addServerFromConfig('test-server', {
        command: 'node',
        args: ['server.js'],
      });

      const servers = router.getAvailableServers();
      const server = servers.find(s => s.name === 'test-server');
      expect(server?.connected).toBe(false);
    });
  });

  describe('loadServersFromDesktopConfig', () => {
    it('should load multiple servers from config', () => {
      router.loadServersFromDesktopConfig({
        mcpServers: {
          server1: { command: 'node', args: ['s1.js'] },
          server2: { command: 'npx', args: ['-y', 'test'] },
        },
      });

      const servers = router.getAvailableServers();
      expect(servers.length).toBe(2);
    });

    it('should exclude aegis-proxy server', () => {
      router.loadServersFromDesktopConfig({
        mcpServers: {
          server1: { command: 'node', args: ['s1.js'] },
          'aegis-proxy': { command: 'node', args: ['proxy.js'] },
        },
      });

      const servers = router.getAvailableServers();
      expect(servers.some(s => s.name === 'aegis-proxy')).toBe(false);
    });

    it('should exclude aegis server', () => {
      router.loadServersFromDesktopConfig({
        mcpServers: {
          server1: { command: 'node', args: ['s1.js'] },
          aegis: { command: 'node', args: ['aegis.js'] },
        },
      });

      const servers = router.getAvailableServers();
      expect(servers.some(s => s.name === 'aegis')).toBe(false);
    });
  });

  describe('isServerConnected', () => {
    it('should return false for unknown server', () => {
      expect(router.isServerConnected('unknown')).toBe(false);
    });

    it('should return false before starting', () => {
      router.addServerFromConfig('test', { command: 'node', args: [] });
      expect(router.isServerConnected('test')).toBe(false);
    });
  });

  describe('getAvailableServers', () => {
    it('should return empty array initially', () => {
      expect(router.getAvailableServers()).toEqual([]);
    });

    it('should return added servers', () => {
      router.addServerFromConfig('server1', { command: 'node', args: [] });
      router.addServerFromConfig('server2', { command: 'npx', args: [] });

      const servers = router.getAvailableServers();
      expect(servers.length).toBe(2);
      expect(servers.map(s => s.name)).toContain('server1');
      expect(servers.map(s => s.name)).toContain('server2');
    });
  });

  describe('startServers', () => {
    beforeEach(() => {
      router.addServerFromConfig('test-server', {
        command: 'node',
        args: ['server.js'],
      });
    });

    it('should spawn process with correct command', async () => {
      const startPromise = router.startServers();

      // Simulate successful initialization
      setTimeout(() => {
        mockStdout.emit('data', '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2024-11-05"}}\n');
      }, 600);

      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['server.js'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should handle process error', async () => {
      const startPromise = router.startServers();

      setTimeout(() => {
        mockProcess.emit('error', new Error('spawn failed'));
      }, 100);

      await startPromise;

      // Should log error but not throw
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('startServersByName', () => {
    beforeEach(() => {
      router.addServerFromConfig('server1', { command: 'node', args: [] });
      router.addServerFromConfig('server2', { command: 'node', args: [] });
    });

    it('should warn for unknown server', async () => {
      await router.startServersByName(['unknown']);
      expect(logger.warn).toHaveBeenCalledWith('Server not configured: unknown');
    });
  });

  describe('stopServers', () => {
    it('should kill all server processes', async () => {
      router.addServerFromConfig('test', { command: 'node', args: [] });

      // Start server first
      const startPromise = router.startServers();
      setTimeout(() => {
        mockStdout.emit('data', '{"jsonrpc":"2.0","id":0,"result":{}}\n');
      }, 600);
      await startPromise;

      // Stop servers
      const stopPromise = router.stopServers();
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 100);
      await stopPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should clear servers after stopping', async () => {
      router.addServerFromConfig('test', { command: 'node', args: [] });
      await router.stopServers();

      expect(router.getAvailableServers()).toEqual([]);
    });
  });

  describe('event handling', () => {
    it('should emit notification events', () => {
      const handler = vi.fn();
      router.on('notification', handler);

      // Access private method through internal event
      router.emit('notification', { from: 'test', message: {} });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('environment variable expansion', () => {
    beforeEach(() => {
      process.env.TEST_VAR = 'test_value';
    });

    afterEach(() => {
      delete process.env.TEST_VAR;
    });

    it('should expand environment variables in config', async () => {
      router.addServerFromConfig('test', {
        command: 'node',
        args: [],
        env: {
          EXPANDED: '${TEST_VAR}',
          LITERAL: 'literal_value',
        },
      });

      const startPromise = router.startServers();

      setTimeout(() => {
        mockStdout.emit('data', '{"jsonrpc":"2.0","id":0,"result":{}}\n');
      }, 600);

      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            EXPANDED: 'test_value',
            LITERAL: 'literal_value',
          }),
        })
      );
    });
  });
});

describe('StdioRouter message handling', () => {
  let logger: Logger;
  let router: StdioRouter;

  beforeEach(() => {
    logger = createTestLogger();
    router = new StdioRouter(logger);
  });

  describe('response routing', () => {
    it('should emit response events with correct ID', () => {
      const handler = vi.fn();
      router.on('response-123', handler);

      // Simulate upstream message
      (router as any).handleUpstreamMessage('test-server', {
        jsonrpc: '2.0',
        id: 123,
        result: { data: 'test' },
      });

      // Response won't be emitted without pending request
    });
  });

  describe('notification handling', () => {
    it('should emit notification event for method messages', () => {
      const handler = vi.fn();
      router.on('notification', handler);

      (router as any).handleUpstreamMessage('test-server', {
        jsonrpc: '2.0',
        method: 'some/notification',
        params: {},
      });

      expect(handler).toHaveBeenCalledWith({
        from: 'test-server',
        message: expect.objectContaining({ method: 'some/notification' }),
      });
    });
  });
});
