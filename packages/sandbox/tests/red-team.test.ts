/**
 * Sandbox Red Team Tests
 * Security verification tests to ensure sandbox cannot be escaped
 *
 * These tests verify that malicious commands cannot:
 * - Leak sensitive environment variables
 * - Execute potentially dangerous commands
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createSandboxManager, SandboxManager } from '../src/sandbox-manager.js';

describe('Sandbox Security (Red Team)', () => {
  let manager: SandboxManager;

  beforeAll(async () => {
    manager = createSandboxManager();
    await manager.initialize();
  });

  describe('environment variable leakage', () => {
    it('should not leak ANTHROPIC_API_KEY', async () => {
      // Temporarily set a test key
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-key';

      try {
        const result = await manager.executeWithProfile(
          'env',
          [],
          'strict'
        );

        expect(result.stdout).not.toContain('sk-ant-test-secret-key');
        expect(result.stdout).not.toContain('ANTHROPIC_API_KEY');
      } finally {
        if (originalKey) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });

    it('should not leak OPENAI_API_KEY', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test-secret-openai-key';

      try {
        const result = await manager.executeWithProfile(
          'env',
          [],
          'strict'
        );

        expect(result.stdout).not.toContain('sk-test-secret-openai-key');
      } finally {
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    it('should not leak AWS credentials', async () => {
      const originalKey = process.env.AWS_SECRET_ACCESS_KEY;
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      try {
        const result = await manager.executeWithProfile(
          'sh',
          ['-c', 'echo $AWS_SECRET_ACCESS_KEY'],
          'strict'
        );

        expect(result.stdout.trim()).not.toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      } finally {
        if (originalKey) {
          process.env.AWS_SECRET_ACCESS_KEY = originalKey;
        } else {
          delete process.env.AWS_SECRET_ACCESS_KEY;
        }
      }
    });

    it('should not leak GITHUB_TOKEN', async () => {
      const originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

      try {
        const result = await manager.executeWithProfile(
          'sh',
          ['-c', 'echo $GITHUB_TOKEN'],
          'strict'
        );

        expect(result.stdout.trim()).not.toBe('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      } finally {
        if (originalToken) {
          process.env.GITHUB_TOKEN = originalToken;
        } else {
          delete process.env.GITHUB_TOKEN;
        }
      }
    });
  });

  describe('command injection protection', () => {
    it('should not allow command injection via arguments', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['hello; cat /etc/passwd'],
        'strict'
      );

      // The semicolon should be treated as literal text
      expect(result.stdout).not.toContain('root:');
      expect(result.stdout.trim()).toBe('hello; cat /etc/passwd');
    });

    it('should not allow command injection via backticks', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['`cat /etc/passwd`'],
        'strict'
      );

      // Backticks should be treated as literal
      expect(result.stdout).not.toContain('root:');
    });

    it('should not allow command injection via $()', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['$(cat /etc/passwd)'],
        'strict'
      );

      // $() should be treated as literal
      expect(result.stdout).not.toContain('root:');
    });
  });

  describe('basic security checks', () => {
    it('should block reading /etc/shadow', async () => {
      const result = await manager.executeWithProfile(
        'cat',
        ['/etc/shadow'],
        'strict'
      );

      // Should fail - permission denied or sandbox blocked
      expect(result.success).toBe(false);
      expect(result.stdout).not.toMatch(/^root:/m);
    });

    it('should not allow sudo', async () => {
      const result = await manager.executeWithProfile(
        'sudo',
        ['whoami'],
        'strict'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('result validation', () => {
    it('should include all expected fields in result', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['test'],
        'strict'
      );

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('timedOut');
      expect(result).toHaveProperty('memoryExceeded');
    });

    it('should record duration accurately', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['test'],
        'standard'
      );

      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.durationMs).toBeLessThan(30000);
    });
  });
});
