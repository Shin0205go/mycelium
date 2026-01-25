/**
 * Path Resolution Tests
 *
 * These tests verify that path resolution works correctly regardless of
 * where commands are executed from. This is critical for monorepo setups
 * where the working directory may vary.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { access, stat } from 'fs/promises';
import { constants } from 'fs';

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Calculate paths the same way as production code
// From tests/ -> core/ -> packages/ -> monorepo root
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

describe('Path Resolution', () => {
  describe('PROJECT_ROOT calculation', () => {
    it('should resolve to monorepo root from test file', () => {
      // PROJECT_ROOT should end with the repo name or be a valid monorepo root
      expect(basename(PROJECT_ROOT)).toBe('mycelium');
    });

    it('should contain package.json with workspaces', async () => {
      const packageJsonPath = join(PROJECT_ROOT, 'package.json');
      await expect(access(packageJsonPath, constants.R_OK)).resolves.toBeUndefined();

      const packageJson = await import(packageJsonPath, { with: { type: 'json' } });
      expect(packageJson.default.workspaces).toBeDefined();
      expect(packageJson.default.workspaces).toContain('packages/*');
    });

    it('should contain packages/ directory', async () => {
      const packagesDir = join(PROJECT_ROOT, 'packages');
      const stats = await stat(packagesDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('Config file resolution', () => {
    it('should find config.json at project root', async () => {
      const configPath = join(PROJECT_ROOT, 'config.json');
      await expect(access(configPath, constants.R_OK)).resolves.toBeUndefined();
    });

    it('config.json should have valid mcpServers configuration', async () => {
      const configPath = join(PROJECT_ROOT, 'config.json');
      const config = await import(configPath, { with: { type: 'json' } });

      expect(config.default.mcpServers).toBeDefined();
      expect(typeof config.default.mcpServers).toBe('object');
    });

    it('config.json should not contain absolute paths', async () => {
      const configPath = join(PROJECT_ROOT, 'config.json');
      const { readFile } = await import('fs/promises');
      const content = await readFile(configPath, 'utf-8');

      // Should not contain common absolute path patterns
      expect(content).not.toMatch(/\/Users\//);
      expect(content).not.toMatch(/\/home\/[a-zA-Z]/);
      expect(content).not.toMatch(/C:\\/);
      expect(content).not.toMatch(/D:\\/);
    });
  });

  describe('MCP Server path resolution', () => {
    it('should find mcp-server.js in dist/', async () => {
      const mcpServerPath = join(PROJECT_ROOT, 'packages', 'core', 'dist', 'mcp-server.js');
      await expect(access(mcpServerPath, constants.R_OK)).resolves.toBeUndefined();
    });

    it('should find cli-entry.js in dist/', async () => {
      const cliEntryPath = join(PROJECT_ROOT, 'packages', 'core', 'dist', 'cli-entry.js');
      await expect(access(cliEntryPath, constants.R_OK)).resolves.toBeUndefined();
    });
  });

  describe('Skills package path resolution', () => {
    it('should find @mycelium/skills dist', async () => {
      const skillsPath = join(PROJECT_ROOT, 'packages', 'skills', 'dist', 'index.js');
      await expect(access(skillsPath, constants.R_OK)).resolves.toBeUndefined();
    });

    it('should find skills directory', async () => {
      const skillsDir = join(PROJECT_ROOT, 'packages', 'skills', 'skills');
      const stats = await stat(skillsDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('Relative path consistency', () => {
    it('__dirname should be packages/core/tests', () => {
      const pathParts = __dirname.split('/').slice(-3);
      expect(pathParts).toEqual(['packages', 'core', 'tests']);
    });

    it('path calculations should be consistent across different starting points', () => {
      // From tests/
      const fromTests = join(__dirname, '..', '..', '..');

      // From src/ (simulating production code location)
      const srcDir = join(__dirname, '..', 'src');
      const fromSrc = join(srcDir, '..', '..', '..');

      // From dist/ (simulating compiled code location)
      const distDir = join(__dirname, '..', 'dist');
      const fromDist = join(distDir, '..', '..', '..');

      // All should resolve to the same PROJECT_ROOT
      expect(fromTests).toBe(fromSrc);
      expect(fromTests).toBe(fromDist);
    });
  });
});

describe('Environment Variable Fallbacks', () => {
  it('should use environment variable when set', () => {
    const customPath = '/custom/path/to/router.js';
    const originalEnv = process.env.MYCELIUM_ROUTER_PATH;

    try {
      process.env.MYCELIUM_ROUTER_PATH = customPath;

      // Simulate the path resolution logic
      const resolvedPath = process.env.MYCELIUM_ROUTER_PATH ||
        join(PROJECT_ROOT, 'packages', 'core', 'dist', 'mcp-server.js');

      expect(resolvedPath).toBe(customPath);
    } finally {
      if (originalEnv !== undefined) {
        process.env.MYCELIUM_ROUTER_PATH = originalEnv;
      } else {
        delete process.env.MYCELIUM_ROUTER_PATH;
      }
    }
  });

  it('should fall back to calculated path when env var not set', () => {
    const originalEnv = process.env.MYCELIUM_ROUTER_PATH;

    try {
      delete process.env.MYCELIUM_ROUTER_PATH;

      const resolvedPath = process.env.MYCELIUM_ROUTER_PATH ||
        join(PROJECT_ROOT, 'packages', 'core', 'dist', 'mcp-server.js');

      expect(resolvedPath).toBe(join(PROJECT_ROOT, 'packages', 'core', 'dist', 'mcp-server.js'));
    } finally {
      if (originalEnv !== undefined) {
        process.env.MYCELIUM_ROUTER_PATH = originalEnv;
      }
    }
  });
});
