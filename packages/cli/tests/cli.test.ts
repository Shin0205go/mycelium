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
    return err.stdout || err.stderr || err.message;
  }
}

describe('AEGIS CLI', () => {
  describe('Main', () => {
    it('should show help with --help', () => {
      const output = runCli('--help');
      expect(output).toContain('AEGIS CLI');
      expect(output).toContain('init');
      expect(output).toContain('skill');
      expect(output).toContain('policy');
      expect(output).toContain('mcp');
    });

    it('should show version with --version', () => {
      const output = runCli('--version');
      expect(output).toContain('1.0.0');
    });
  });

  describe('aegis init', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'aegis-cli-test-'));
    });

    afterAll(() => {
      if (testDir && existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should initialize a project with default skills', () => {
      const output = runCli('init', testDir);
      expect(output).toContain('Initializing AEGIS project');
      expect(output).toContain('Created config.json');
      expect(output).toContain('Created skills/ directory');
    });

    it('should create config.json', () => {
      const configPath = join(testDir, 'config.json');
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config).toHaveProperty('mcpServers');
      expect(config.mcpServers).toHaveProperty('aegis-skills');
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

  describe('aegis skill', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'aegis-cli-skill-test-'));
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

    it('should add a skill from template', () => {
      const output = runCli('skill add test-skill --template basic', testDir);
      expect(output).toContain('Adding skill: test-skill');
      expect(output).toContain('SKILL.yaml');
      expect(output).toContain('SKILL.md');

      const skillPath = join(testDir, 'skills', 'test-skill', 'SKILL.md');
      const yamlPath = join(testDir, 'skills', 'test-skill', 'SKILL.yaml');
      expect(existsSync(skillPath)).toBe(true);
      expect(existsSync(yamlPath)).toBe(true);
    });
  });

  describe('aegis policy', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), 'aegis-cli-policy-test-'));
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
      expect(output).toContain('test');
      expect(output).toContain('roles');
    });

    it('should list roles from skills', () => {
      const output = runCli('policy roles', testDir);
      expect(output).toContain('admin');
      expect(output).toContain('developer');
      expect(output).toContain('guest');
    });
  });
});
