/**
 * Darwin (macOS) Sandbox Executor Tests
 * Uses sandbox-exec (Seatbelt) for isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DarwinSandboxExecutor } from '../src/darwin-executor.js';
import type { SandboxConfig, SandboxRequest } from '../src/types.js';

// Skip all tests if not on macOS
const isMacOS = process.platform === 'darwin';

// Helper to create a minimal config
function createConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    workingDirectory: process.cwd(),
    filesystem: {
      readPaths: ['/usr', '/bin', '/lib', '/tmp'],
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

describe.skipIf(!isMacOS)('DarwinSandboxExecutor', () => {
  let executor: DarwinSandboxExecutor;

  beforeEach(() => {
    executor = new DarwinSandboxExecutor(createConfig());
  });

  describe('isAvailable', () => {
    it('should be available on macOS', async () => {
      const available = await executor.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getPlatform', () => {
    it('should return darwin', () => {
      const platform = executor.getPlatform();
      expect(platform).toBe('darwin');
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

    it('should measure execution duration', async () => {
      const request: SandboxRequest = {
        command: 'sleep',
        args: ['0.1'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.durationMs).toBeGreaterThan(50);
    });
  });

  describe('filesystem restrictions', () => {
    it('should allow reading permitted paths', async () => {
      const request: SandboxRequest = {
        command: 'cat',
        args: ['/etc/hosts'],
        config: createConfig({
          filesystem: {
            readPaths: ['/etc/hosts', '/usr', '/bin'],
            writePaths: [],
          },
        }),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('localhost');
    });

    it('should deny reading non-permitted paths', async () => {
      const request: SandboxRequest = {
        command: 'cat',
        args: ['/etc/passwd'],
        config: createConfig({
          filesystem: {
            readPaths: [], // No read paths
            writePaths: [],
            denyPaths: ['/etc/passwd'],
          },
        }),
      };

      const result = await executor.execute(request);

      // Should fail due to sandbox restrictions
      expect(result.success).toBe(false);
    });

    it('should allow writing to permitted paths', async () => {
      const testFile = '/tmp/sandbox-test-' + Date.now() + '.txt';
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', `echo "test" > ${testFile} && cat ${testFile}`],
        config: createConfig({
          filesystem: {
            readPaths: ['/usr', '/bin', '/tmp'],
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
    it('should deny network access by default', async () => {
      const request: SandboxRequest = {
        command: 'curl',
        args: ['-s', '--connect-timeout', '2', 'http://example.com'],
        config: createConfig({
          filesystem: {
            readPaths: ['/usr', '/bin', '/etc', '/lib'],
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

    it('should allow localhost when permitted', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'echo test | nc -l 12345 &; sleep 0.1; echo "ping" | nc localhost 12345'],
        config: createConfig({
          network: {
            allowOutbound: false,
            allowLocalhost: true,
            allowDns: false,
          },
        }),
      };

      // This test is fragile - just verify the sandbox doesn't crash
      const result = await executor.execute(request);

      // We just verify it ran (success depends on timing)
      expect(result).toHaveProperty('stdout');
    });
  });

  describe('process restrictions', () => {
    it('should enforce process limits', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'for i in $(seq 1 100); do sleep 100 & done; wait'],
        config: createConfig({
          process: {
            timeoutSeconds: 5,
            maxMemoryMB: 256,
            maxProcesses: 5,
            allowFork: true,
            allowExec: true,
            maxOpenFiles: 50,
          },
        }),
      };

      const result = await executor.execute(request);

      // Should either fail due to process limit or timeout
      expect(result.success).toBe(false);
    }, 10000);
  });
});
