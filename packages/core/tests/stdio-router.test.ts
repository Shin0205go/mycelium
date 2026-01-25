/**
 * Unit tests for StdioRouter (minimal implementation)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioRouter, type UpstreamServerInfo } from '../src/mcp/stdio-router.js';
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
      // Start servers (will timeout on init but spawn should be called)
      router.startServers().catch(() => {}); // Ignore timeout

      // Give it time to spawn
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['server.js'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should handle process error', async () => {
      // Start servers (don't wait for completion)
      router.startServers().catch(() => {});

      // Emit error after spawn
      await new Promise(resolve => setTimeout(resolve, 50));
      mockProcess.emit('error', new Error('spawn failed'));

      // Give time for error handler
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should log error
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
      expect(logger.warn).toHaveBeenCalledWith('Server not found: unknown');
    });
  });

  describe('stopServers', () => {
    it('should kill server processes when stopped', async () => {
      router.addServerFromConfig('test', { command: 'node', args: [] });

      // Start server (don't wait for init)
      router.startServers().catch(() => {});

      // Give it time to spawn
      await new Promise(resolve => setTimeout(resolve, 100));

      // Stop servers
      await router.stopServers();

      expect(mockProcess.kill).toHaveBeenCalled();
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

      // Emit notification through EventEmitter
      router.emit('notification', { from: 'test', message: {} });

      expect(handler).toHaveBeenCalled();
    });
  });
});
