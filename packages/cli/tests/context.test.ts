/**
 * Tests for context file handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  writeContext,
  readContext,
  contextExists,
  deleteContext,
  formatContextForDisplay,
  getDefaultContextPath,
  type WorkflowContext,
} from '../src/lib/context.js';

describe('Context file handling', () => {
  let tempDir: string;
  let testContextPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-context-test-'));
    testContextPath = path.join(tempDir, 'test-context.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const sampleContext: WorkflowContext = {
    skillId: 'code-review',
    scriptPath: 'scripts/review.py',
    args: ['--verbose', './src'],
    error: {
      message: 'Script failed with exit code 1',
      exitCode: 1,
      stdout: 'Reviewing files...',
      stderr: 'Error: No files found in ./src',
    },
    timestamp: '2026-01-23T10:00:00.000Z',
  };

  describe('writeContext', () => {
    it('should write context to specified path', async () => {
      const savedPath = await writeContext(sampleContext, testContextPath);

      expect(savedPath).toBe(testContextPath);

      const content = await fs.readFile(testContextPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.skillId).toBe('code-review');
      expect(parsed.scriptPath).toBe('scripts/review.py');
      expect(parsed.error.exitCode).toBe(1);
    });

    it('should add timestamp if not provided', async () => {
      const contextWithoutTimestamp = {
        ...sampleContext,
        timestamp: undefined as any,
      };

      await writeContext(contextWithoutTimestamp, testContextPath);

      const content = await fs.readFile(testContextPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.timestamp).toBeDefined();
      expect(new Date(parsed.timestamp).getTime()).not.toBeNaN();
    });

    it('should preserve optional metadata', async () => {
      const contextWithMetadata: WorkflowContext = {
        ...sampleContext,
        metadata: {
          userId: 'user-123',
          environment: 'development',
        },
      };

      await writeContext(contextWithMetadata, testContextPath);

      const content = await fs.readFile(testContextPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.metadata.userId).toBe('user-123');
      expect(parsed.metadata.environment).toBe('development');
    });
  });

  describe('readContext', () => {
    it('should read context from file', async () => {
      await fs.writeFile(testContextPath, JSON.stringify(sampleContext), 'utf-8');

      const context = await readContext(testContextPath);

      expect(context.skillId).toBe('code-review');
      expect(context.scriptPath).toBe('scripts/review.py');
      expect(context.args).toEqual(['--verbose', './src']);
      expect(context.error.exitCode).toBe(1);
    });

    it('should throw on missing file', async () => {
      await expect(readContext('/nonexistent/path.json')).rejects.toThrow();
    });

    it('should throw on invalid JSON', async () => {
      await fs.writeFile(testContextPath, 'not valid json', 'utf-8');

      await expect(readContext(testContextPath)).rejects.toThrow();
    });

    it('should throw on missing required fields', async () => {
      const invalidContext = { skillId: 'test' }; // missing scriptPath and error
      await fs.writeFile(testContextPath, JSON.stringify(invalidContext), 'utf-8');

      await expect(readContext(testContextPath)).rejects.toThrow('missing required fields');
    });
  });

  describe('contextExists', () => {
    it('should return true for existing file', async () => {
      await fs.writeFile(testContextPath, '{}', 'utf-8');

      expect(await contextExists(testContextPath)).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      expect(await contextExists('/nonexistent/path.json')).toBe(false);
    });
  });

  describe('deleteContext', () => {
    it('should delete existing context file', async () => {
      await fs.writeFile(testContextPath, '{}', 'utf-8');
      expect(await contextExists(testContextPath)).toBe(true);

      await deleteContext(testContextPath);

      expect(await contextExists(testContextPath)).toBe(false);
    });

    it('should not throw for non-existing file', async () => {
      await expect(deleteContext('/nonexistent/path.json')).resolves.not.toThrow();
    });
  });

  describe('formatContextForDisplay', () => {
    it('should format context with all fields', () => {
      const formatted = formatContextForDisplay(sampleContext);

      expect(formatted).toContain('Skill: code-review');
      expect(formatted).toContain('Script: scripts/review.py');
      expect(formatted).toContain('Args: --verbose ./src');
      expect(formatted).toContain('exit code 1');
      expect(formatted).toContain('Error: No files found');
      expect(formatted).toContain('Reviewing files...');
    });

    it('should format context without optional args', () => {
      const contextWithoutArgs: WorkflowContext = {
        ...sampleContext,
        args: undefined,
      };

      const formatted = formatContextForDisplay(contextWithoutArgs);

      expect(formatted).toContain('Skill: code-review');
      expect(formatted).not.toContain('Args:');
    });

    it('should include conversation summary if present', () => {
      const contextWithSummary: WorkflowContext = {
        ...sampleContext,
        conversationSummary: 'User asked to review code in src directory.',
      };

      const formatted = formatContextForDisplay(contextWithSummary);

      expect(formatted).toContain('Conversation Summary:');
      expect(formatted).toContain('User asked to review code');
    });
  });

  describe('getDefaultContextPath', () => {
    it('should return path in current working directory', () => {
      const defaultPath = getDefaultContextPath();

      expect(defaultPath).toContain('workflow-context.json');
      expect(path.dirname(defaultPath)).toBe(process.cwd());
    });
  });
});
