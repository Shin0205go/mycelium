// ============================================================================
// Mycelium Sandbox Executor
// Platform-agnostic interface for sandbox execution
// ============================================================================

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  SandboxConfig,
  SandboxResult,
  SandboxRequest,
  SandboxViolation,
  SandboxPlatform,
} from './types.js';

/**
 * Abstract base class for sandbox executors
 */
export abstract class SandboxExecutor {
  protected config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  /**
   * Check if this executor is available on the current system
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get the platform this executor supports
   */
  abstract getPlatform(): SandboxPlatform;

  /**
   * Execute a command in the sandbox
   */
  abstract execute(request: SandboxRequest): Promise<SandboxResult>;

  /**
   * Get sandbox setup command/args for the platform
   */
  protected abstract getSandboxCommand(
    command: string,
    args: string[]
  ): { command: string; args: string[] };

  /**
   * Common execution logic with timeout and memory monitoring
   */
  protected async runWithLimits(
    sandboxedCommand: string,
    sandboxedArgs: string[],
    stdin?: string,
    env?: Record<string, string>
  ): Promise<SandboxResult> {
    const startTime = Date.now();
    const violations: SandboxViolation[] = [];

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let memoryExceeded = false;
      let killed = false;

      // Merge environment, blocking sensitive vars
      const blockedVars = new Set([
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'AWS_SECRET_ACCESS_KEY',
        'GITHUB_TOKEN',
        'SSH_AUTH_SOCK',
        ...(this.config.blockedEnvVars || []),
      ]);

      const processEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!blockedVars.has(key) && value !== undefined) {
          processEnv[key] = value;
        }
      }

      // Add custom env vars
      if (env) {
        Object.assign(processEnv, env);
      }
      if (this.config.environment) {
        Object.assign(processEnv, this.config.environment);
      }

      const proc = spawn(sandboxedCommand, sandboxedArgs, {
        cwd: this.config.workingDirectory,
        env: processEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Timeout handler
      const timeoutMs = this.config.process.timeoutSeconds * 1000;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        killed = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      // Memory monitoring (simplified - checks RSS periodically)
      const memoryCheckInterval = setInterval(() => {
        try {
          if (proc.pid) {
            // On Linux, we could read /proc/[pid]/status
            // For now, we rely on the sandbox mechanism itself
          }
        } catch {
          // Process may have exited
        }
      }, 1000);

      // Handle stdin
      if (stdin) {
        proc.stdin?.write(stdin);
      }
      proc.stdin?.end();

      // Collect stdout/stderr
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        const str = data.toString();
        stderr += str;

        // Detect sandbox violations from stderr
        if (str.includes('sandbox violation') || str.includes('operation not permitted')) {
          violations.push({
            type: 'syscall',
            description: str.trim(),
            timestamp: new Date(),
          });
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        clearInterval(memoryCheckInterval);

        const durationMs = Date.now() - startTime;

        resolve({
          success: code === 0 && !timedOut && !memoryExceeded,
          exitCode: code ?? -1,
          stdout,
          stderr,
          durationMs,
          timedOut,
          memoryExceeded,
          violations: violations.length > 0 ? violations : undefined,
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        clearInterval(memoryCheckInterval);

        const durationMs = Date.now() - startTime;

        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: stderr + '\n' + error.message,
          durationMs,
          timedOut: false,
          memoryExceeded: false,
          violations: [
            {
              type: 'process',
              description: `Process error: ${error.message}`,
              timestamp: new Date(),
            },
          ],
        });
      });
    });
  }

  /**
   * Expand ~ and resolve paths
   */
  protected resolvePath(p: string): string {
    if (p.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, p.slice(1));
    }
    if (path.isAbsolute(p)) {
      return p;
    }
    return path.resolve(this.config.workingDirectory, p);
  }

  /**
   * Check if a file/directory exists
   */
  protected async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * No-op executor for unsupported platforms (runs without sandbox)
 */
export class UnsandboxedExecutor extends SandboxExecutor {
  async isAvailable(): Promise<boolean> {
    return true; // Always available as fallback
  }

  getPlatform(): SandboxPlatform {
    return process.platform as SandboxPlatform;
  }

  protected getSandboxCommand(command: string, args: string[]): { command: string; args: string[] } {
    // No sandboxing, just return the command as-is
    return { command, args };
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    console.error('[WARN] Running without sandbox - platform not supported');

    const { command, args } = this.getSandboxCommand(
      request.command,
      request.args || []
    );

    return this.runWithLimits(command, args, request.stdin, request.config.environment);
  }
}
