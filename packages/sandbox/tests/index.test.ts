/**
 * Basic tests for @mycelium/sandbox
 */

import { describe, it, expect } from 'vitest';
import {
  SANDBOX_VERSION,
  SANDBOX_PROFILES,
  SandboxManager,
  createSandboxManager,
} from '../src/index.js';

describe('@mycelium/sandbox', () => {
  describe('exports', () => {
    it('should export SANDBOX_VERSION', () => {
      expect(SANDBOX_VERSION).toBe('1.0.0');
    });

    it('should export SANDBOX_PROFILES', () => {
      expect(SANDBOX_PROFILES).toBeDefined();
      expect(typeof SANDBOX_PROFILES).toBe('object');
    });

    it('should export SandboxManager class', () => {
      expect(SandboxManager).toBeDefined();
      expect(typeof SandboxManager).toBe('function');
    });

    it('should export createSandboxManager factory', () => {
      expect(createSandboxManager).toBeDefined();
      expect(typeof createSandboxManager).toBe('function');
    });
  });

  describe('SANDBOX_PROFILES', () => {
    it('should have strict profile', () => {
      expect(SANDBOX_PROFILES.strict).toBeDefined();
    });

    it('should have standard profile', () => {
      expect(SANDBOX_PROFILES.standard).toBeDefined();
    });

    it('should have permissive profile', () => {
      expect(SANDBOX_PROFILES.permissive).toBeDefined();
    });
  });

  describe('createSandboxManager', () => {
    it('should create a SandboxManager instance', () => {
      const manager = createSandboxManager();
      expect(manager).toBeInstanceOf(SandboxManager);
    });
  });
});
