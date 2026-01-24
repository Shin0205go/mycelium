/**
 * Docker-based sandbox executor
 * Provides strong isolation using Docker containers
 */

import { spawn } from 'child_process';
import { SandboxExecutor } from './executor.js';
import type {
  SandboxConfig,
  SandboxResult,
  SandboxRequest,
  SandboxViolation,
  SandboxPlatform,
} from './types.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Docker executor configuration
 */
export interface DockerExecutorConfig {
  /** Default image to use (default: alpine:latest) */
  defaultImage?: string;
  /** Timeout for docker pull (ms) */
  pullTimeout?: number;
  /** Use podman instead of docker */
  usePodman?: boolean;
}

/**
 * Image presets for different use cases
 */
export const DOCKER_IMAGES = {
  minimal: 'alpine:latest',
  python: 'python:3.12-slim',
  node: 'node:20-slim',
  shell: 'bash:latest',
} as const;

/**
 * Docker-based sandbox executor
 * Uses Docker containers for strong process isolation
 */
export class DockerSandboxExecutor extends SandboxExecutor {
  private dockerConfig: DockerExecutorConfig;
  private dockerCommand: string;
  private available: boolean | null = null;

  constructor(config: SandboxConfig, dockerConfig?: DockerExecutorConfig) {
    super(config);
    this.dockerConfig = {
      defaultImage: 'alpine:latest',
      pullTimeout: 60000,
      usePodman: false,
      ...dockerConfig,
    };
    this.dockerCommand = this.dockerConfig.usePodman ? 'podman' : 'docker';
  }

  /**
   * Check if Docker/Podman is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    return new Promise((resolve) => {
      const proc = spawn(this.dockerCommand, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          this.available = false;
          resolve(false);
        }
      }, 5000);

      proc.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.available = code === 0;
          resolve(code === 0);
        }
      });

      proc.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.available = false;
          resolve(false);
        }
      });
    });
  }

  /**
   * Get platform - Docker works on all platforms
   */
  getPlatform(): SandboxPlatform {
    return process.platform as SandboxPlatform;
  }

  /**
   * Get the sandbox command (Docker run with appropriate flags)
   */
  protected getSandboxCommand(
    command: string,
    args: string[]
  ): { command: string; args: string[] } {
    const image = this.selectImage(command);
    const dockerArgs = this.buildDockerArgs(image);

    // Add the actual command
    dockerArgs.push(command, ...args);

    return {
      command: this.dockerCommand,
      args: dockerArgs,
    };
  }

  /**
   * Execute command in Docker container
   */
  async execute(request: SandboxRequest): Promise<SandboxResult> {
    const startTime = Date.now();
    const violations: SandboxViolation[] = [];

    // Use request config or fall back to instance config
    const config = request.config || this.config;
    const image = this.selectImage(request.command);

    // Build docker run command
    const dockerArgs = this.buildDockerArgs(image, config);

    // Add the actual command
    dockerArgs.push(request.command, ...(request.args || []));

    return new Promise((resolve) => {
      const proc = spawn(this.dockerCommand, dockerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      // Set up timeout
      const timeoutMs = config.process?.timeoutSeconds
        ? config.process.timeoutSeconds * 1000
        : 30000;
      const timeout = setTimeout(() => {
        timedOut = true;
        killed = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      // Handle stdin
      if (request.stdin) {
        proc.stdin?.write(request.stdin);
      }
      proc.stdin?.end();

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        const str = data.toString();
        stderr += str;

        // Detect container violations
        if (
          str.includes('permission denied') ||
          str.includes('operation not permitted')
        ) {
          violations.push({
            type: 'filesystem',
            description: str.trim(),
            timestamp: new Date(),
          });
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;

        resolve({
          success: code === 0 && !timedOut,
          exitCode: code ?? -1,
          stdout,
          stderr,
          durationMs,
          timedOut,
          memoryExceeded: false,
          violations: violations.length > 0 ? violations : undefined,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;

        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: stderr + '\n' + err.message,
          durationMs,
          timedOut: false,
          memoryExceeded: false,
          violations: [
            {
              type: 'process',
              description: `Docker error: ${err.message}`,
              timestamp: new Date(),
            },
          ],
        });
      });
    });
  }

  /**
   * Build Docker run arguments based on sandbox config
   */
  private buildDockerArgs(image: string, config?: SandboxConfig): string[] {
    const cfg = config || this.config;
    const args: string[] = ['run', '--rm'];

    // Network isolation
    if (!cfg.network?.allowOutbound) {
      args.push('--network=none');
    }

    // Resource limits
    if (cfg.process?.maxMemoryMB) {
      args.push(`--memory=${cfg.process.maxMemoryMB}m`);
    }

    if (cfg.process?.maxProcesses) {
      args.push(`--pids-limit=${cfg.process.maxProcesses}`);
    }

    // Determine profile level from config
    const isStrict =
      !cfg.network?.allowOutbound &&
      !cfg.network?.allowLocalhost &&
      cfg.filesystem?.denyPaths?.includes('/');
    const isPermissive =
      cfg.network?.allowOutbound || cfg.filesystem?.writePaths?.includes('/');

    // Security options based on strictness
    if (isStrict) {
      args.push(
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true'
      );
      // Add tmpfs for /tmp in strict mode
      args.push('--tmpfs=/tmp:rw,noexec,nosuid,size=64m');
    } else if (!isPermissive) {
      // standard
      args.push('--cap-drop=ALL', '--security-opt=no-new-privileges:true');
    } else {
      // permissive
      args.push('--cap-drop=ALL');
    }

    // User isolation (run as non-root)
    args.push('--user=1000:1000');

    // Working directory mount
    const workDir = cfg.workingDirectory;
    if (workDir && fs.existsSync(workDir)) {
      args.push(`-v=${workDir}:/workspace:rw`);
      args.push('-w=/workspace');
    }

    // Mount read paths
    if (cfg.filesystem?.readPaths) {
      for (const readPath of cfg.filesystem.readPaths) {
        const resolved = this.resolvePath(readPath);
        if (fs.existsSync(resolved)) {
          args.push(`-v=${resolved}:${resolved}:ro`);
        }
      }
    }

    // Mount write paths
    if (cfg.filesystem?.writePaths) {
      for (const writePath of cfg.filesystem.writePaths) {
        const resolved = this.resolvePath(writePath);
        if (fs.existsSync(resolved)) {
          args.push(`-v=${resolved}:${resolved}:rw`);
        }
      }
    }

    // Environment variables (block sensitive ones)
    const blockedVars = new Set([
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'GITHUB_TOKEN',
      'SSH_AUTH_SOCK',
      ...(cfg.blockedEnvVars || []),
    ]);

    // Pass through safe env vars
    if (cfg.environment) {
      for (const [key, value] of Object.entries(cfg.environment)) {
        if (!blockedVars.has(key)) {
          args.push(`-e=${key}=${value}`);
        }
      }
    }

    // Image
    args.push(image);

    return args;
  }

  /**
   * Select appropriate Docker image based on command
   */
  private selectImage(command: string): string {
    const cmd = path.basename(command).toLowerCase();

    if (cmd === 'python' || cmd === 'python3' || cmd === 'pip') {
      return DOCKER_IMAGES.python;
    }

    if (cmd === 'node' || cmd === 'npm' || cmd === 'npx') {
      return DOCKER_IMAGES.node;
    }

    if (cmd === 'bash' || cmd === 'sh') {
      return DOCKER_IMAGES.shell;
    }

    return this.dockerConfig.defaultImage || DOCKER_IMAGES.minimal;
  }

  /**
   * Pull Docker image if not present
   */
  async pullImage(image: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.dockerCommand, ['pull', image], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve(false);
      }, this.dockerConfig.pullTimeout || 60000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  /**
   * Check if image exists locally
   */
  async imageExists(image: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.dockerCommand, ['image', 'inspect', image], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }
}

/**
 * Factory function
 */
export function createDockerSandboxExecutor(
  config: SandboxConfig,
  dockerConfig?: DockerExecutorConfig
): DockerSandboxExecutor {
  return new DockerSandboxExecutor(config, dockerConfig);
}
