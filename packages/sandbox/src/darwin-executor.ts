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

    // On Apple Silicon, use arch -arm64 to force native execution
    // sandbox-exec defaults to x86_64 which requires Rosetta
    // Note: process.arch may show 'x64' if Node.js itself runs under Rosetta,
    // so we detect Apple Silicon by checking the CPU brand string
    const isAppleSilicon = this.isAppleSilicon();

    if (isAppleSilicon) {
      return {
        command: 'arch',
        args: ['-arm64', 'sandbox-exec', '-f', this.profilePath, command, ...args],
      };
    }

    return {
      command: 'sandbox-exec',
      args: ['-f', this.profilePath, command, ...args],
    };
  }

  /**
   * Detect if running on Apple Silicon (even if Node.js uses Rosetta)
   */
  private isAppleSilicon(): boolean {
    try {
      const cpuBrand = execSync('sysctl -n machdep.cpu.brand_string', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return cpuBrand.toLowerCase().includes('apple');
    } catch {
      return false;
    }
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    // Generate sandbox profile
    this.profilePath = await this.generateProfile();

    try {
      const { command, args } = this.getSandboxCommand(
        request.command,
        request.args || []
      );

      // Run sandbox-exec directly - timeout is handled by runWithLimits
      // No need for perl/gtimeout wrapper which can cause Rosetta issues on ARM Macs
      // IMPORTANT: Must await here, otherwise finally block runs before process completes
      const result = await this.runWithLimits(command, args, request.stdin, request.config.environment);
      return result;
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
    lines.push('(allow signal)');  // Allow signaling any process (needed for test runners)
    lines.push('');

    // System calls needed for basic operation
    lines.push('; System operations');
    lines.push('(allow sysctl-read)');
    lines.push('(allow mach-lookup)');
    lines.push('(allow ipc-posix-shm)');
    lines.push('');

    // File system
    lines.push('; File system');

    // Allow reading all files - security comes from write/network restrictions
    // Attempting to restrict reads to specific paths breaks many common commands
    // (bash, node, python, etc. need to read from various system locations)
    lines.push('(allow file-read*)');
    lines.push('');

    // Write paths - always include working directory for common operations
    lines.push('; Allowed write paths');
    lines.push('(allow file-write*');
    lines.push(`  (subpath "${this.escapePath(this.config.workingDirectory)}")`);
    for (const p of this.config.filesystem.writePaths) {
      const resolved = this.resolvePath(p);
      if (resolved !== this.config.workingDirectory) {
        lines.push(`  (subpath "${this.escapePath(resolved)}")`);
      }
    }
    lines.push(')');
    lines.push('');

    // Temp directory - include both symlink and real paths
    // /var -> private/var, so /var/folders is really /private/var/folders
    const tmpDir = os.tmpdir();
    const realTmpDir = tmpDir.replace(/^\/var\//, '/private/var/');
    lines.push('; Temp directory');
    lines.push('(allow file-read* file-write*');
    lines.push('  (subpath "/private/tmp")');
    lines.push(`  (subpath "${this.escapePath(tmpDir)}")`);
    if (tmpDir !== realTmpDir) {
      lines.push(`  (subpath "${this.escapePath(realTmpDir)}")`);
    }
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

}
