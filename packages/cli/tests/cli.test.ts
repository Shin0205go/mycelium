// ============================================================================
// CLI Command Tests
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
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
      expect(output).toContain('init');
      expect(output).toContain('skill');
      expect(output).toContain('policy');
      expect(output).toContain('mcp');
      expect(output).toContain('server');
      expect(output).toContain('client');
    });

    it('should show version with --version', () => {
      const output = runCli('--version');
      expect(output).toContain('1.0.0');
    });
  });

  describe('mycelium init', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'mycelium-cli-test-'));
    });

    afterAll(() => {
      if (testDir && existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should initialize a project with default skills', () => {
      const output = runCli('init', testDir);
      expect(output).toContain('Initializing mycelium project');
      expect(output).toContain('Created config.json');
      expect(output).toContain('Created skills/ directory');
    });

    it('should create config.json', () => {
      const configPath = join(testDir, 'config.json');
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config).toHaveProperty('mcpServers');
      expect(config.mcpServers).toHaveProperty('mycelium-skills');
    });

    it('should create default skills', () => {
      const skillsDir = join(testDir, 'skills');
      expect(existsSync(skillsDir)).toBe(true);
      expect(existsSync(join(skillsDir, 'guest-access', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(skillsDir, 'developer-tools', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(skillsDir, 'admin-access', 'SKILL.md'))).toBe(true);
    });

    it('should create valid SKILL.md files with frontmatter', () => {
      const skillPath = join(testDir, 'skills', 'developer-tools', 'SKILL.md');
      const content = readFileSync(skillPath, 'utf-8');

      expect(content).toMatch(/^---\n/);
      expect(content).toContain('id: developer-tools');
      expect(content).toContain('allowedRoles:');
      expect(content).toContain('allowedTools:');
    });
  });

  describe('mycelium skill', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'mycelium-cli-skill-test-'));
      runCli('init', testDir);
    });

    afterAll(() => {
      if (testDir && existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should show skill help', () => {
      const output = runCli('skill --help');
      expect(output).toContain('add');
      expect(output).toContain('list');
      expect(output).toContain('templates');
    });

    it('should list available templates', () => {
      const output = runCli('skill templates');
      expect(output).toContain('basic');
      expect(output).toContain('browser-limited');
      expect(output).toContain('code-reviewer');
      expect(output).toContain('data-analyst');
    });

    it('should list skills in a project', () => {
      const output = runCli('skill list', testDir);
      expect(output).toContain('guest-access');
      expect(output).toContain('developer-tools');
      expect(output).toContain('admin-access');
    });

    it('should start interactive skill creation', () => {
      // skill add is an interactive command, so it starts but doesn't complete
      // without user input - we just verify it starts correctly
      const output = runCli('skill add test-skill', testDir);
      expect(output).toContain('Creating skill: test-skill');
    });
  });

  describe('mycelium policy', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'mycelium-cli-policy-test-'));
      runCli('init', testDir);
    });

    afterAll(() => {
      if (testDir && existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should show policy help', () => {
      const output = runCli('policy --help');
      expect(output).toContain('check');
    });
  });

  describe('mycelium mcp', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'mycelium-cli-mcp-test-'));
      runCli('init', testDir);
    });

    afterAll(() => {
      if (testDir && existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should show mcp help', () => {
      const output = runCli('mcp --help');
      expect(output).toContain('start');
      expect(output).toContain('status');
      expect(output).toContain('stop');
    });

    it('should show status when no server is running', () => {
      const output = runCli('mcp status', testDir);
      expect(output).toContain('MCP Server Status');
      expect(output).toContain('No server info found');
    });

    it('should show stop message when no server is running', () => {
      const output = runCli('mcp stop', testDir);
      expect(output).toContain('No server info found');
    });

    it('should detect missing config for start', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'mycelium-cli-mcp-empty-'));
      try {
        const output = runCli('mcp start', emptyDir);
        expect(output).toContain('Config file not found');
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('should detect missing server for start', () => {
      // testDir has config but no built server
      const output = runCli('mcp start', testDir);
      expect(output).toContain('MCP server not found');
    });
  });

  describe('mycelium workflow', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'mycelium-cli-workflow-test-'));
      runCli('init', testDir);
    });

    afterAll(() => {
      if (testDir && existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should show workflow help', () => {
      const output = runCli('workflow --help');
      expect(output).toContain('Run skill-based workflows');
      expect(output).toContain('--model');
      expect(output).toContain('--on-failure');
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
