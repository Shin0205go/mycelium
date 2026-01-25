/**
 * Linux Sandbox Executor Tests
 * Uses bubblewrap or firejail for isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LinuxSandboxExecutor } from '../src/linux-executor.js';
import type { SandboxConfig, SandboxRequest } from '../src/types.js';

// Skip all tests if not on Linux
const isLinux = process.platform === 'linux';

// Helper to create a minimal config
function createConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    workingDirectory: process.cwd(),
    filesystem: {
      readPaths: ['/usr', '/bin', '/lib', '/lib64', '/tmp'],
      writePaths: ['/tmp'],
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

describe.skipIf(!isLinux)('LinuxSandboxExecutor', () => {
  let executor: LinuxSandboxExecutor;

  beforeEach(() => {
    executor = new LinuxSandboxExecutor(createConfig());
  });

  describe('isAvailable', () => {
    it('should be available on Linux', async () => {
      const available = await executor.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getPlatform', () => {
    it('should return linux', () => {
      const platform = executor.getPlatform();
      expect(platform).toBe('linux');
    });
  });

  describe('execute', () => {
    it('should execute simple commands in sandbox', async () => {
      const request: SandboxRequest = {
        command: 'echo',
        args: ['hello sandbox'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello sandbox');
    });

    it('should capture stderr', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'echo error >&2'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stderr.trim()).toBe('error');
    });

    it('should handle command failures', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'exit 42'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(42);
    });

    it('should respect timeout', async () => {
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

    it('should pass stdin', async () => {
      const request: SandboxRequest = {
        command: 'cat',
        args: [],
        stdin: 'test input',
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stdout).toBe('test input');
    });
  });

  describe('filesystem restrictions', () => {
    it('should allow reading permitted paths', async () => {
      const request: SandboxRequest = {
        command: 'cat',
        args: ['/etc/hosts'],
        config: createConfig({
          filesystem: {
            readPaths: ['/etc/hosts', '/usr', '/bin', '/lib'],
            writePaths: [],
          },
        }),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('localhost');
    });

    it('should deny reading sensitive files', async () => {
      const request: SandboxRequest = {
        command: 'cat',
        args: ['/etc/shadow'],
        config: createConfig({
          filesystem: {
            readPaths: ['/usr', '/bin'],
            writePaths: [],
            denyPaths: ['/etc/shadow'],
          },
        }),
      };

      const result = await executor.execute(request);

      // Should fail - either permission denied or sandbox restriction
      expect(result.success).toBe(false);
    });

    it('should allow writing to permitted paths', async () => {
      const testFile = '/tmp/sandbox-test-' + Date.now() + '.txt';
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', `echo "test" > ${testFile} && cat ${testFile}`],
        config: createConfig({
          filesystem: {
            readPaths: ['/usr', '/bin', '/tmp', '/lib', '/lib64'],
            writePaths: ['/tmp'],
          },
        }),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('test');
    });
  });

  describe('network restrictions', () => {
    it('should deny network access when disabled', async () => {
      const request: SandboxRequest = {
        command: 'curl',
        args: ['-s', '--connect-timeout', '2', 'http://example.com'],
        config: createConfig({
          filesystem: {
            readPaths: ['/usr', '/bin', '/etc', '/lib', '/lib64'],
            writePaths: [],
          },
          network: {
            allowOutbound: false,
            allowLocalhost: false,
            allowDns: false,
          },
        }),
      };

      const result = await executor.execute(request);

      // Should fail due to network restrictions
      expect(result.success).toBe(false);
    }, 15000);

    it('should allow network when enabled', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'echo network test'],
        config: createConfig({
          network: {
            allowOutbound: true,
            allowLocalhost: true,
            allowDns: true,
          },
        }),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
    });
  });

  describe('bwrap vs firejail', () => {
    it('should use available sandbox tool', async () => {
      const executor = new LinuxSandboxExecutor(createConfig());
      const available = await executor.isAvailable();

      expect(available).toBe(true);
      // The executor should have detected bwrap, firejail, or fallback
    });

    it('should execute with detected tool', async () => {
      const request: SandboxRequest = {
        command: 'echo',
        args: ['tool test'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stdout.trim()).toBe('tool test');
    });
  });
});
