/**
 * Sandbox Manager Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createSandboxManager, SandboxManager } from '../src/sandbox-manager.js';
import type { SandboxConfig } from '../src/types.js';
import { SANDBOX_PROFILES } from '../src/types.js';

describe('SandboxManager', () => {
  let manager: SandboxManager;

  beforeAll(async () => {
    manager = createSandboxManager();
    await manager.initialize();
  });

  describe('initialize', () => {
    it('should initialize without errors', async () => {
      const newManager = createSandboxManager();
      await expect(newManager.initialize()).resolves.not.toThrow();
    });

    it('should detect platform capabilities', async () => {
      const newManager = createSandboxManager();
      await newManager.initialize();
      const caps = newManager.getCapabilities();

      expect(caps).toHaveProperty('platform');
      expect(caps).toHaveProperty('available');
      expect(caps).toHaveProperty('features');
      expect(caps).toHaveProperty('tool');
    });
  });

  describe('getCapabilities', () => {
    it('should return valid platform info', () => {
      const caps = manager.getCapabilities();

      expect(['darwin', 'linux', 'win32', 'unknown']).toContain(caps.platform);
      expect(typeof caps.available).toBe('boolean');
      expect(typeof caps.features).toBe('object');
    });

    it('should return feature flags', () => {
      const caps = manager.getCapabilities();

      expect(typeof caps.features.filesystem).toBe('boolean');
      expect(typeof caps.features.network).toBe('boolean');
      expect(typeof caps.features.process).toBe('boolean');
      expect(typeof caps.features.memory).toBe('boolean');
    });

    it('should report executor tool name', () => {
      const caps = manager.getCapabilities();
      expect(typeof caps.tool).toBe('string');
    });
  });

  describe('execute', () => {
    it('should execute a simple echo command', async () => {
      const config: SandboxConfig = {
        workingDirectory: process.cwd(),
        filesystem: {
          readPaths: [],
          writePaths: [],
        },
        network: {
          allowOutbound: false,
          allowLocalhost: false,
          allowDns: false,
        },
        process: {
          timeoutSeconds: 30,
          maxMemoryMB: 512,
          maxProcesses: 10,
          allowFork: true,
          allowExec: true,
          maxOpenFiles: 100,
        },
      };

      const result = await manager.execute('echo', ['hello'], config);

      expect(result.stdout.trim()).toBe('hello');
      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should handle non-zero exit codes', async () => {
      const config: SandboxConfig = {
        workingDirectory: process.cwd(),
        filesystem: {
          readPaths: [],
          writePaths: [],
        },
        network: {
          allowOutbound: false,
          allowLocalhost: false,
          allowDns: false,
        },
        process: {
          timeoutSeconds: 30,
          maxMemoryMB: 512,
          maxProcesses: 10,
          allowFork: true,
          allowExec: true,
          maxOpenFiles: 100,
        },
      };

      const result = await manager.execute('false', [], config);

      // Sandbox may modify exit codes, but it should indicate failure
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    it('should handle command not found', async () => {
      const config: SandboxConfig = {
        workingDirectory: process.cwd(),
        filesystem: {
          readPaths: [],
          writePaths: [],
        },
        network: {
          allowOutbound: false,
          allowLocalhost: false,
          allowDns: false,
        },
        process: {
          timeoutSeconds: 30,
          maxMemoryMB: 512,
          maxProcesses: 10,
          allowFork: true,
          allowExec: true,
          maxOpenFiles: 100,
        },
      };

      const result = await manager.execute('nonexistent_command_xyz', [], config);

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('executeWithProfile', () => {
    it('should execute with strict profile', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['strict test'],
        'strict'
      );

      expect(result.stdout.trim()).toBe('strict test');
      expect(result.success).toBe(true);
    });

    it('should execute with standard profile', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['standard test'],
        'standard'
      );

      expect(result.stdout.trim()).toBe('standard test');
      expect(result.success).toBe(true);
    });

    it('should execute with permissive profile', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['permissive test'],
        'permissive'
      );

      expect(result.stdout.trim()).toBe('permissive test');
      expect(result.success).toBe(true);
    });

    it('should execute pwd command', async () => {
      const result = await manager.executeWithProfile(
        'pwd',
        [],
        'standard'
      );

      // The command should execute and return some path
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toMatch(/^\//);
    });

    it('should execute date command', async () => {
      const result = await manager.executeWithProfile(
        'date',
        ['+%Y'],
        'standard'
      );

      expect(result.success).toBe(true);
      // Should return a year
      expect(result.stdout.trim()).toMatch(/^\d{4}$/);
    });
  });

  describe('result properties', () => {
    it('should return all expected properties', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['test'],
        'standard'
      );

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('timedOut');
      expect(result).toHaveProperty('memoryExceeded');
    });

    it('should record duration', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['test'],
        'standard'
      );

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThan(0);
    });
  });

  describe('environment variables', () => {
    it('should not leak ANTHROPIC_API_KEY', async () => {
      // Set a sensitive var temporarily
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'secret-key-123';

      try {
        const result = await manager.executeWithProfile(
          'printenv',
          ['ANTHROPIC_API_KEY'],
          'strict'
        );

        // The key should be blocked (printenv returns empty/error for unset vars)
        expect(result.stdout.trim()).not.toBe('secret-key-123');
      } finally {
        // Restore original value
        if (originalKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });
});

describe('SANDBOX_PROFILES', () => {
  it('should have all required profiles', () => {
    expect(SANDBOX_PROFILES).toHaveProperty('strict');
    expect(SANDBOX_PROFILES).toHaveProperty('standard');
    expect(SANDBOX_PROFILES).toHaveProperty('permissive');
  });

  it('strict profile should have most restrictive settings', () => {
    const strict = SANDBOX_PROFILES.strict;

    expect(strict.network?.allowOutbound).toBe(false);
    expect(strict.network?.allowLocalhost).toBe(false);
    expect(strict.process?.timeoutSeconds).toBeLessThanOrEqual(60);
  });

  it('permissive profile should have relaxed settings', () => {
    const permissive = SANDBOX_PROFILES.permissive;

    expect(permissive.network?.allowOutbound).toBe(true);
    expect(permissive.process?.timeoutSeconds).toBeGreaterThan(60);
  });
});
