// ============================================================================
// Linux Sandbox Executor
// Uses bubblewrap (bwrap) for filesystem/network isolation
// Falls back to firejail or basic ulimit restrictions
// ============================================================================

import { spawn, execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { SandboxExecutor } from './executor.js';
import type {
  SandboxConfig,
  SandboxResult,
  SandboxRequest,
  SandboxPlatform,
} from './types.js';

/**
 * Available sandboxing tools on Linux
 */
type LinuxSandboxTool = 'bwrap' | 'firejail' | 'none';

/**
 * Linux sandbox executor using bubblewrap or firejail
 *
 * Priority:
 * 1. bubblewrap (bwrap) - Most secure, namespace-based
 * 2. firejail - Feature-rich, widely available
 * 3. none - Fallback with ulimit only
 */
export class LinuxSandboxExecutor extends SandboxExecutor {
  private tool: LinuxSandboxTool = 'none';

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'linux') {
      return false;
    }

    // Check for available sandbox tools
    if (await this.commandExists('bwrap')) {
      this.tool = 'bwrap';
      return true;
    }

    if (await this.commandExists('firejail')) {
      this.tool = 'firejail';
      return true;
    }

    // Fallback mode (less secure)
    this.tool = 'none';
    return true;
  }

  getPlatform(): SandboxPlatform {
    return 'linux';
  }

  protected getSandboxCommand(
    command: string,
    args: string[]
  ): { command: string; args: string[] } {
    switch (this.tool) {
      case 'bwrap':
        return this.getBwrapCommand(command, args);
      case 'firejail':
        return this.getFirejailCommand(command, args);
      default:
        return this.getBasicCommand(command, args);
    }
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    // Ensure the tool is detected
    await this.isAvailable();

    const { command, args } = this.getSandboxCommand(
      request.command,
      request.args || []
    );

    console.error(`[sandbox] Using ${this.tool} for Linux sandboxing`);

    return this.runWithLimits(command, args, request.stdin, request.config.environment);
  }

  /**
   * Build bubblewrap command
   * bwrap provides namespace isolation for filesystem, network, and PID
   */
  private getBwrapCommand(command: string, args: string[]): { command: string; args: string[] } {
    const bwrapArgs: string[] = [];

    // Unshare namespaces
    bwrapArgs.push('--unshare-all');

    // Keep network if allowed
    if (this.config.network.allowOutbound || this.config.network.allowLocalhost) {
      bwrapArgs.push('--share-net');
    }

    // Set up minimal root filesystem
    bwrapArgs.push('--ro-bind', '/usr', '/usr');
    bwrapArgs.push('--ro-bind', '/lib', '/lib');
    if (this.existsSync('/lib64')) {
      bwrapArgs.push('--ro-bind', '/lib64', '/lib64');
    }
    bwrapArgs.push('--ro-bind', '/bin', '/bin');
    bwrapArgs.push('--ro-bind', '/sbin', '/sbin');

    // Symlink /etc basics
    bwrapArgs.push('--ro-bind', '/etc/resolv.conf', '/etc/resolv.conf');
    bwrapArgs.push('--ro-bind', '/etc/hosts', '/etc/hosts');

    // Add read paths
    for (const p of this.config.filesystem.readPaths) {
      const resolved = this.resolvePath(p);
      bwrapArgs.push('--ro-bind', resolved, resolved);
    }

    // Add write paths
    for (const p of this.config.filesystem.writePaths) {
      const resolved = this.resolvePath(p);
      bwrapArgs.push('--bind', resolved, resolved);
    }

    // Working directory
    const workDir = this.config.workingDirectory;
    bwrapArgs.push('--bind', workDir, workDir);
    bwrapArgs.push('--chdir', workDir);

    // /tmp and /dev basics
    bwrapArgs.push('--tmpfs', '/tmp');
    bwrapArgs.push('--dev', '/dev');
    bwrapArgs.push('--proc', '/proc');

    // Die with parent
    bwrapArgs.push('--die-with-parent');

    // Add timeout wrapper
    const timeoutCmd = [
      'timeout',
      '--signal=KILL',
      `${this.config.process.timeoutSeconds}s`,
    ];

    // Memory limit via shell ulimit
    const ulimitPrefix = this.config.process.maxMemoryMB
      ? `ulimit -v ${this.config.process.maxMemoryMB * 1024} && `
      : '';

    // Final command
    bwrapArgs.push('--', 'sh', '-c', `${ulimitPrefix}${command} ${args.map(a => `"${a}"`).join(' ')}`);

    return {
      command: 'bwrap',
      args: bwrapArgs,
    };
  }

  /**
   * Build firejail command
   * firejail is more user-friendly but slightly less secure than bwrap
   */
  private getFirejailCommand(command: string, args: string[]): { command: string; args: string[] } {
    const fjArgs: string[] = [];

    // Quiet mode
    fjArgs.push('--quiet');

    // Network restrictions
    if (!this.config.network.allowOutbound && !this.config.network.allowLocalhost) {
      fjArgs.push('--net=none');
    } else if (!this.config.network.allowOutbound) {
      fjArgs.push('--netfilter');
    }

    // Private /tmp
    fjArgs.push('--private-tmp');

    // No new privileges
    fjArgs.push('--nonewprivs');

    // Seccomp filtering
    fjArgs.push('--seccomp');

    // Memory limit
    if (this.config.process.maxMemoryMB) {
      fjArgs.push(`--rlimit-as=${this.config.process.maxMemoryMB * 1024 * 1024}`);
    }

    // Timeout
    fjArgs.push(`--timeout=${this.config.process.timeoutSeconds}:00:00`);

    // Disable process forking if not allowed
    if (!this.config.process.allowFork) {
      fjArgs.push('--rlimit-nproc=1');
    } else if (this.config.process.maxProcesses) {
      fjArgs.push(`--rlimit-nproc=${this.config.process.maxProcesses}`);
    }

    // File limits
    if (this.config.process.maxOpenFiles) {
      fjArgs.push(`--rlimit-nofile=${this.config.process.maxOpenFiles}`);
    }

    // Whitelist read paths
    for (const p of this.config.filesystem.readPaths) {
      const resolved = this.resolvePath(p);
      fjArgs.push(`--whitelist=${resolved}`);
      fjArgs.push(`--read-only=${resolved}`);
    }

    // Whitelist write paths
    for (const p of this.config.filesystem.writePaths) {
      const resolved = this.resolvePath(p);
      fjArgs.push(`--whitelist=${resolved}`);
    }

    // Working directory
    fjArgs.push(`--whitelist=${this.config.workingDirectory}`);

    // Blacklist sensitive paths
    const denyPaths = this.config.filesystem.denyPaths || [];
    for (const p of denyPaths) {
      const resolved = this.resolvePath(p);
      fjArgs.push(`--blacklist=${resolved}`);
    }

    // Command
    fjArgs.push('--', command, ...args);

    return {
      command: 'firejail',
      args: fjArgs,
    };
  }

  /**
   * Basic command with ulimit restrictions (fallback)
   */
  private getBasicCommand(command: string, args: string[]): { command: string; args: string[] } {
    console.error('[WARN] No sandbox tool available, using basic ulimit restrictions');

    const limits: string[] = [];

    // Virtual memory limit
    if (this.config.process.maxMemoryMB) {
      limits.push(`ulimit -v ${this.config.process.maxMemoryMB * 1024}`);
    }

    // Process limit
    if (this.config.process.maxProcesses) {
      limits.push(`ulimit -u ${this.config.process.maxProcesses}`);
    }

    // File descriptor limit
    if (this.config.process.maxOpenFiles) {
      limits.push(`ulimit -n ${this.config.process.maxOpenFiles}`);
    }

    // CPU time limit (as fallback for timeout)
    limits.push(`ulimit -t ${this.config.process.timeoutSeconds}`);

    const script = [
      ...limits,
      `timeout ${this.config.process.timeoutSeconds}s ${command} ${args.map(a => `"${a}"`).join(' ')}`,
    ].join(' && ');

    return {
      command: 'sh',
      args: ['-c', script],
    };
  }

  /**
   * Check if a command exists
   */
  private async commandExists(cmd: string): Promise<boolean> {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sync version of exists check
   */
  private existsSync(p: string): boolean {
    try {
      require('fs').accessSync(p);
      return true;
    } catch {
      return false;
    }
  }
}
