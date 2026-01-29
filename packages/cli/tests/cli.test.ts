// ============================================================================
// CLI Command Tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

const CLI_PATH = join(__dirname, '..', 'dist', 'index.js');

function runCli(args: string, cwd?: string): string {
  try {
    return execSync(`node ${CLI_PATH} ${args}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      timeout: 10000
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    // Combine stdout and stderr to capture all output
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
    return output || err.message;
  }
}

describe('MYCELIUM CLI', () => {
  describe('Main', () => {
    it('should show help with --help', () => {
      const output = runCli('--help');
      expect(output).toContain('MYCELIUM CLI');
      expect(output).toContain('server');
      expect(output).toContain('client');
    });

    it('should show version with --version', () => {
      const output = runCli('--version');
      expect(output).toContain('1.0.0');
    });
  });

  describe('mycelium server', () => {
    it('should show server help', () => {
      const output = runCli('server --help');
      expect(output).toContain('Start MYCELIUM as a standalone MCP server');
      expect(output).toContain('--config');
      expect(output).toContain('--role');
      expect(output).toContain('--verbose');
    });
  });

  describe('mycelium client', () => {
    it('should show client help', () => {
      const output = runCli('client --help');
      expect(output).toContain('Connect to a Mycelium MCP server');
      expect(output).toContain('--config');
      expect(output).toContain('--role');
    });
  });
});
