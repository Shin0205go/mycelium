// ============================================================================
// macOS Sandbox Executor
// Uses sandbox-exec (Seatbelt) for isolation
// ============================================================================

import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SandboxExecutor } from './executor.js';
import type {
  SandboxConfig,
  SandboxResult,
  SandboxRequest,
  SandboxPlatform,
} from './types.js';

/**
 * macOS sandbox executor using sandbox-exec (Seatbelt)
 *
 * sandbox-exec uses Scheme-like profiles to define restrictions.
 * This is the same technology used by macOS App Sandbox.
 */
export class DarwinSandboxExecutor extends SandboxExecutor {
  private profilePath: string | null = null;

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return false;
    }

    // Check if sandbox-exec is available
    try {
      execSync('which sandbox-exec', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  getPlatform(): SandboxPlatform {
    return 'darwin';
  }

  protected getSandboxCommand(
    command: string,
    args: string[]
  ): { command: string; args: string[] } {
    if (!this.profilePath) {
      throw new Error('Sandbox profile not generated');
    }

    return {
      command: 'sandbox-exec',
      args: ['-f', this.profilePath, command, ...args],
    };
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    // Generate sandbox profile
    this.profilePath = await this.generateProfile();

    try {
      const { command, args } = this.getSandboxCommand(
        request.command,
        request.args || []
      );

      console.error(`[sandbox] Using sandbox-exec (Seatbelt) for macOS sandboxing`);

      // Wrap with timeout
      const timeoutCmd = 'gtimeout';
      const hasGtimeout = await this.commandExists(timeoutCmd);

      let finalCommand: string;
      let finalArgs: string[];

      if (hasGtimeout) {
        // Use GNU timeout if available (from coreutils)
        finalCommand = timeoutCmd;
        finalArgs = [
          '--signal=KILL',
          `${this.config.process.timeoutSeconds}s`,
          command,
          ...args,
        ];
      } else {
        // macOS doesn't have timeout by default, use perl workaround
        finalCommand = 'perl';
        finalArgs = [
          '-e',
          `alarm ${this.config.process.timeoutSeconds}; exec @ARGV`,
          command,
          ...args,
        ];
      }

      return this.runWithLimits(finalCommand, finalArgs, request.stdin, request.config.environment);
    } finally {
      // Clean up profile
      if (this.profilePath) {
        try {
          await fs.unlink(this.profilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Generate a Seatbelt profile based on config
   */
  private async generateProfile(): Promise<string> {
    const lines: string[] = [];

    // Profile version
    lines.push('(version 1)');
    lines.push('');

    // Default deny
    lines.push('(deny default)');
    lines.push('');

    // Allow basic process operations
    lines.push('; Basic process operations');
    lines.push('(allow process-fork)');
    lines.push('(allow process-exec)');
    lines.push('(allow signal (target self))');
    lines.push('');

    // System calls needed for basic operation
    lines.push('; System operations');
    lines.push('(allow sysctl-read)');
    lines.push('(allow mach-lookup)');
    lines.push('(allow ipc-posix-shm)');
    lines.push('');

    // File system
    lines.push('; File system');

    // Always allow reading system libraries
    lines.push('(allow file-read*');
    lines.push('  (subpath "/usr/lib")');
    lines.push('  (subpath "/System/Library")');
    lines.push('  (subpath "/Library/Frameworks")');
    lines.push('  (subpath "/usr/share")');
    lines.push('  (literal "/dev/null")');
    lines.push('  (literal "/dev/random")');
    lines.push('  (literal "/dev/urandom")');
    lines.push('  (literal "/dev/zero")');
    lines.push(')');
    lines.push('');

    // User-specified read paths
    if (this.config.filesystem.readPaths.length > 0) {
      lines.push('; Allowed read paths');
      lines.push('(allow file-read*');
      for (const p of this.config.filesystem.readPaths) {
        const resolved = this.resolvePath(p);
        lines.push(`  (subpath "${this.escapePath(resolved)}")`);
      }
      lines.push(')');
      lines.push('');
    }

    // Working directory - read access
    lines.push('; Working directory read');
    lines.push('(allow file-read*');
    lines.push(`  (subpath "${this.escapePath(this.config.workingDirectory)}")`);
    lines.push(')');
    lines.push('');

    // Write paths
    if (this.config.filesystem.writePaths.length > 0) {
      lines.push('; Allowed write paths');
      lines.push('(allow file-write*');
      for (const p of this.config.filesystem.writePaths) {
        const resolved = this.resolvePath(p);
        lines.push(`  (subpath "${this.escapePath(resolved)}")`);
      }
      lines.push(')');
      lines.push('');
    }

    // Temp directory
    lines.push('; Temp directory');
    lines.push('(allow file-read* file-write*');
    lines.push('  (subpath "/private/tmp")');
    lines.push(`  (subpath "${this.escapePath(os.tmpdir())}")`);
    lines.push(')');
    lines.push('');

    // Network
    lines.push('; Network');
    if (this.config.network.allowOutbound) {
      lines.push('(allow network-outbound)');
      lines.push('(allow network-bind)');
    } else if (this.config.network.allowLocalhost) {
      lines.push('(allow network-outbound (local ip "localhost:*"))');
      lines.push('(allow network-bind (local ip "localhost:*"))');
    }

    if (this.config.network.allowDns) {
      lines.push('(allow network-outbound (remote unix-socket (path-literal "/var/run/mDNSResponder")))');
    }
    lines.push('');

    // Deny sensitive paths
    if (this.config.filesystem.denyPaths && this.config.filesystem.denyPaths.length > 0) {
      lines.push('; Denied paths (override allows)');
      lines.push('(deny file-read* file-write*');
      for (const p of this.config.filesystem.denyPaths) {
        const resolved = this.resolvePath(p);
        lines.push(`  (subpath "${this.escapePath(resolved)}")`);
      }
      lines.push(')');
    }

    // Write profile to temp file
    const profileContent = lines.join('\n');
    const profilePath = path.join(os.tmpdir(), `mycelium-sandbox-${Date.now()}.sb`);

    await fs.writeFile(profilePath, profileContent, 'utf-8');

    return profilePath;
  }

  /**
   * Escape path for Seatbelt profile
   */
  private escapePath(p: string): string {
    return p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
}
