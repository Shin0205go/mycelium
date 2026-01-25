/**
 * Sandbox Integration Tests
 * End-to-end tests for sandbox execution
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createSandboxManager, SandboxManager } from '../src/sandbox-manager.js';
import type { SkillSandboxConfig } from '../src/types.js';
import { SANDBOX_PROFILES } from '../src/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Sandbox Integration', () => {
  let manager: SandboxManager;
  let testDir: string;

  beforeAll(async () => {
    manager = createSandboxManager();
    await manager.initialize();

    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), 'sandbox-test-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
  });

  describe('basic execution', () => {
    it('should execute and return results', async () => {
      const result = await manager.executeWithProfile(
        'echo',
        ['integration test'],
        'standard'
      );

      expect(result.stdout.trim()).toBe('integration test');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(typeof result.durationMs).toBe('number');
    });

    it('should execute uname command', async () => {
      const result = await manager.executeWithProfile(
        'uname',
        ['-s'],
        'standard'
      );

      expect(result.success).toBe(true);
      expect(['Darwin', 'Linux']).toContain(result.stdout.trim());
    });

    it('should execute with arguments', async () => {
      const result = await manager.executeWithProfile(
        'printf',
        ['%s %s', 'hello', 'world'],
        'standard'
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello world');
    });
  });

  describe('file operations', () => {
    it('should read files with appropriate permissions', async () => {
      const testFile = path.join(testDir, 'read-test.txt');
      fs.writeFileSync(testFile, 'read me');

      const result = await manager.executeWithProfile(
        'cat',
        [testFile],
        'permissive'
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('read me');

      fs.unlinkSync(testFile);
    });
  });

  describe('skill sandbox configuration', () => {
    it('should execute with skill config enabled', async () => {
      const skillConfig: SkillSandboxConfig = {
        enabled: true,
        profile: 'standard',
      };

      const result = await manager.executeWithSkillConfig(
        'echo',
        ['skill test'],
        skillConfig,
        testDir
      );

      expect(result.stdout.trim()).toBe('skill test');
    });

    it('should execute without sandbox when disabled', async () => {
      const skillConfig: SkillSandboxConfig = {
        enabled: false,
      };

      const result = await manager.executeWithSkillConfig(
        'echo',
        ['no sandbox'],
        skillConfig,
        testDir
      );

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('no sandbox');
    });
  });

  describe('error handling', () => {
    it('should handle missing commands', async () => {
      const result = await manager.executeWithProfile(
        'nonexistent_xyz_123',
        [],
        'standard'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('profile behavior', () => {
    it('strict profile should be most restrictive', () => {
      expect(SANDBOX_PROFILES.strict.network?.allowOutbound).toBe(false);
      expect(SANDBOX_PROFILES.strict.process?.maxMemoryMB).toBeLessThan(512);
      expect(SANDBOX_PROFILES.strict.process?.allowFork).toBe(false);
    });

    it('permissive profile should be least restrictive', () => {
      expect(SANDBOX_PROFILES.permissive.network?.allowOutbound).toBe(true);
      expect(SANDBOX_PROFILES.permissive.process?.maxMemoryMB).toBeGreaterThan(512);
      expect(SANDBOX_PROFILES.permissive.process?.allowFork).toBe(true);
    });

    it('standard profile should be balanced', () => {
      expect(SANDBOX_PROFILES.standard.network?.allowOutbound).toBe(false);
      expect(SANDBOX_PROFILES.standard.network?.allowLocalhost).toBe(true);
      expect(SANDBOX_PROFILES.standard.process?.allowFork).toBe(true);
    });
  });

  describe('concurrent execution', () => {
    it('should handle multiple concurrent executions', async () => {
      const promises = Array.from({ length: 3 }, (_, i) =>
        manager.executeWithProfile(
          'echo',
          [`concurrent${i}`],
          'standard'
        )
      );

      const results = await Promise.all(promises);

      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        expect(result.stdout.trim()).toBe(`concurrent${i}`);
      });
    });
  });
});
