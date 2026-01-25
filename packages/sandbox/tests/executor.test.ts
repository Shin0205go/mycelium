/**
 * Base Executor Tests
 */

import { describe, it, expect } from 'vitest';
import { SandboxExecutor, UnsandboxedExecutor } from '../src/executor.js';
import type { SandboxConfig, SandboxRequest, SandboxResult } from '../src/types.js';

// Helper to create a minimal config
function createConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
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
    ...overrides,
  };
}

describe('UnsandboxedExecutor', () => {
  describe('isAvailable', () => {
    it('should always be available', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const available = await executor.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getPlatform', () => {
    it('should return current platform', () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const platform = executor.getPlatform();
      expect(['darwin', 'linux', 'win32']).toContain(platform);
    });
  });

  describe('execute', () => {
    it('should execute simple commands', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'echo',
        args: ['hello world'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.exitCode).toBe(0);
    });

    it('should handle failing commands', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'exit 1'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should capture stdout', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'echo',
        args: ['test output'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stdout.trim()).toBe('test output');
    });

    it('should capture stderr', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'echo error message >&2'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stderr.trim()).toBe('error message');
    });

    it('should handle stdin', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'cat',
        args: [],
        stdin: 'input data',
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stdout).toBe('input data');
    });

    it('should respect timeout', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'sleep',
        args: ['10'],
        config: createConfig({
          process: {
            timeoutSeconds: 1,
            maxMemoryMB: 512,
            maxProcesses: 10,
            allowFork: true,
            allowExec: true,
            maxOpenFiles: 100,
          },
        }),
      };

      const result = await executor.execute(request);

      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
    }, 10000);

    it('should measure duration', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'sleep',
        args: ['0.1'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.durationMs).toBeGreaterThan(50);
      expect(result.durationMs).toBeLessThan(5000);
    });

    it('should handle command not found', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'nonexistent_command_xyz_123',
        args: [],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
    });

    it('should pass environment variables', async () => {
      const executor = new UnsandboxedExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'echo $MY_TEST_VAR'],
        config: createConfig({
          environment: {
            MY_TEST_VAR: 'test_value_123',
          },
        }),
      };

      const result = await executor.execute(request);

      expect(result.stdout.trim()).toBe('test_value_123');
    });
  });
});

describe('SandboxExecutor abstract class', () => {
  // Create a minimal concrete implementation for testing
  class TestExecutor extends SandboxExecutor {
    async isAvailable(): Promise<boolean> {
      return true;
    }

    getPlatform() {
      return 'darwin' as const;
    }

    protected getSandboxCommand(command: string, args: string[]): { command: string; args: string[] } {
      return { command, args };
    }

    async execute(request: SandboxRequest): Promise<SandboxResult> {
      return this.runWithLimits(request.command, request.args || [], request.stdin);
    }
  }

  it('should initialize with config', () => {
    const config = createConfig();
    const executor = new TestExecutor(config);
    expect(executor).toBeDefined();
  });

  it('should have abstract methods', () => {
    const config = createConfig();
    const executor = new TestExecutor(config);

    expect(typeof executor.isAvailable).toBe('function');
    expect(typeof executor.getPlatform).toBe('function');
    expect(typeof executor.execute).toBe('function');
  });

  it('should use runWithLimits for execution', async () => {
    const config = createConfig();
    const executor = new TestExecutor(config);

    const request: SandboxRequest = {
      command: 'echo',
      args: ['test'],
      config,
    };

    const result = await executor.execute(request);

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe('test');
  });
});
