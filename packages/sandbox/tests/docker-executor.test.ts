/**
 * Docker Sandbox Executor Tests
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { DockerSandboxExecutor, DOCKER_IMAGES, createDockerSandboxExecutor } from '../src/docker-executor.js';
import type { SandboxConfig, SandboxRequest } from '../src/types.js';

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

describe('DockerSandboxExecutor', () => {
  let executor: DockerSandboxExecutor;
  let dockerAvailable = false;

  beforeAll(async () => {
    executor = new DockerSandboxExecutor(createConfig());
    dockerAvailable = await executor.isAvailable();
  });

  beforeEach(() => {
    executor = new DockerSandboxExecutor(createConfig());
  });

  describe('isAvailable', () => {
    it('should check for Docker installation', async () => {
      const available = await executor.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('getPlatform', () => {
    it('should return current platform', () => {
      const platform = executor.getPlatform();
      expect(['darwin', 'linux', 'win32']).toContain(platform);
    });
  });

  describe('DOCKER_IMAGES', () => {
    it('should have preset images', () => {
      expect(DOCKER_IMAGES.minimal).toBe('alpine:latest');
      expect(DOCKER_IMAGES.python).toBe('python:3.12-slim');
      expect(DOCKER_IMAGES.node).toBe('node:20-slim');
      expect(DOCKER_IMAGES.shell).toBe('bash:latest');
    });
  });

  describe('createDockerSandboxExecutor', () => {
    it('should create executor with factory function', () => {
      const exec = createDockerSandboxExecutor(createConfig());
      expect(exec).toBeInstanceOf(DockerSandboxExecutor);
    });

    it('should accept docker config', () => {
      const exec = createDockerSandboxExecutor(createConfig(), {
        defaultImage: 'alpine:3.18',
        pullTimeout: 30000,
        usePodman: false,
      });
      expect(exec).toBeInstanceOf(DockerSandboxExecutor);
    });
  });

  describe.skipIf(!dockerAvailable)('execute', () => {
    it('should execute simple commands in container', async () => {
      const request: SandboxRequest = {
        command: 'echo',
        args: ['hello docker'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello docker');
    }, 60000);

    it('should capture stderr', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'echo error >&2'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stderr.trim()).toBe('error');
    }, 60000);

    it('should handle command failures', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'exit 42'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(42);
    }, 60000);

    it('should respect timeout', async () => {
      const request: SandboxRequest = {
        command: 'sleep',
        args: ['30'],
        config: createConfig({
          process: {
            timeoutSeconds: 2,
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
    }, 30000);

    it('should pass stdin', async () => {
      const request: SandboxRequest = {
        command: 'cat',
        args: [],
        stdin: 'docker input',
        config: createConfig(),
      };

      const result = await executor.execute(request);

      expect(result.stdout).toBe('docker input');
    }, 60000);

    it('should deny network by default', async () => {
      const request: SandboxRequest = {
        command: 'sh',
        args: ['-c', 'ping -c 1 8.8.8.8 || echo "network blocked"'],
        config: createConfig({
          network: {
            allowOutbound: false,
            allowLocalhost: false,
            allowDns: false,
          },
        }),
      };

      const result = await executor.execute(request);

      // Either ping fails or we see "network blocked"
      expect(result.stdout + result.stderr).toMatch(/network blocked|Network is unreachable|100% packet loss/);
    }, 60000);

    it('should run as non-root user', async () => {
      const request: SandboxRequest = {
        command: 'id',
        args: ['-u'],
        config: createConfig(),
      };

      const result = await executor.execute(request);

      // Should run as UID 1000
      expect(result.stdout.trim()).toBe('1000');
    }, 60000);
  });

  describe.skipIf(!dockerAvailable)('image selection', () => {
    it('should select python image for python commands', async () => {
      const exec = new DockerSandboxExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'python3',
        args: ['-c', 'print("hello python")'],
        config: createConfig(),
      };

      const result = await exec.execute(request);

      expect(result.stdout.trim()).toBe('hello python');
    }, 120000);

    it('should select node image for node commands', async () => {
      const exec = new DockerSandboxExecutor(createConfig());
      const request: SandboxRequest = {
        command: 'node',
        args: ['-e', 'console.log("hello node")'],
        config: createConfig(),
      };

      const result = await exec.execute(request);

      expect(result.stdout.trim()).toBe('hello node');
    }, 120000);
  });

  describe('imageExists', () => {
    it('should check if image exists', async () => {
      // This just tests the method doesn't crash
      const exists = await executor.imageExists('alpine:latest');
      expect(typeof exists).toBe('boolean');
    });
  });

  describe('pullImage', () => {
    it('should attempt to pull image', async () => {
      // This just tests the method doesn't crash on non-existent image
      const pulled = await executor.pullImage('nonexistent-image-xyz:latest');
      expect(pulled).toBe(false);
    }, 10000);
  });
});

describe('DockerSandboxExecutor with Podman', () => {
  it('should support podman configuration', () => {
    const exec = new DockerSandboxExecutor(createConfig(), {
      usePodman: true,
    });
    expect(exec).toBeInstanceOf(DockerSandboxExecutor);
  });
});
