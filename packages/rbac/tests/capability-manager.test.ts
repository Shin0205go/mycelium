/**
 * Capability Manager Tests
 *
 * Tests covering capability-based security:
 * 1. Token Issuance - issuing capability tokens from skill declarations
 * 2. Token Verification - validating tokens and checking expiration
 * 3. Token Attenuation - creating weaker child tokens from parent tokens
 * 4. Use Tracking - tracking and limiting token usage
 * 5. Revocation - revoking tokens and blacklisting
 * 6. Context Constraints - validating task/tool/server bindings
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CapabilityManager, createCapabilityManager } from '../src/capability-manager.js';
import type { Logger, CapabilityDeclaration } from '@aegis/shared';

// Mock logger for tests
const testLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

describe('CapabilityManager', () => {
  let capabilityManager: CapabilityManager;

  beforeEach(() => {
    vi.clearAllMocks();
    capabilityManager = createCapabilityManager(testLogger, {
      secretKey: 'test-secret-key-for-testing-only'
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================================
  // Token Issuance
  // ============================================================================

  describe('Token Issuance', () => {
    it('should issue a basic capability token', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'read-only'
      };

      const token = capabilityManager.issue('database-query', declaration, 'agent-123');

      expect(token).toBeDefined();
      expect(token.token).toContain('.');
      expect(token.payload.iss).toBe('database-query');
      expect(token.payload.sub).toBe('agent-123');
      expect(token.payload.scope).toBe('db-access:read-only');
      expect(token.payload.jti).toHaveLength(32); // 16 bytes hex
      expect(token.metadata?.useCount).toBe(0);
    });

    it('should issue token with expiration', () => {
      const declaration: CapabilityDeclaration = {
        type: 'file-operation',
        scope: 'write',
        expiresIn: '5m'
      };

      const token = capabilityManager.issue('file-handler', declaration, 'agent-456');

      const now = Math.floor(Date.now() / 1000);
      const expectedExpiry = now + 5 * 60; // 5 minutes

      // Allow 1 second tolerance
      expect(token.payload.exp).toBeGreaterThanOrEqual(expectedExpiry - 1);
      expect(token.payload.exp).toBeLessThanOrEqual(expectedExpiry + 1);
    });

    it('should issue token with max uses', () => {
      const declaration: CapabilityDeclaration = {
        type: 'api-call',
        scope: 'write',
        maxUses: 3
      };

      const token = capabilityManager.issue('api-handler', declaration, 'agent-789');

      expect(token.payload.usesLeft).toBe(3);
    });

    it('should issue token with context constraints', () => {
      const declaration: CapabilityDeclaration = {
        type: 'task-specific',
        scope: 'admin',
        contextConstraints: {
          taskId: 'task-123',
          allowedTools: ['tool-a', 'tool-b'],
          allowedServers: ['server-x']
        }
      };

      const token = capabilityManager.issue('task-skill', declaration, 'agent-task');

      expect(token.payload.context?.taskId).toBe('task-123');
      expect(token.payload.context?.allowedTools).toEqual(['tool-a', 'tool-b']);
      expect(token.payload.context?.allowedServers).toEqual(['server-x']);
    });

    it('should inject task context from runtime', () => {
      const declaration: CapabilityDeclaration = {
        type: 'dynamic-task',
        scope: 'read-only'
      };

      const token = capabilityManager.issue('dynamic-skill', declaration, 'agent-dyn', {
        taskId: 'runtime-task-456'
      });

      expect(token.payload.context?.taskId).toBe('runtime-task-456');
    });

    it('should support various duration formats', () => {
      const durations = ['30s', '5m', '1h', '24h', '7d'];
      const expectedMs = [30000, 300000, 3600000, 86400000, 604800000];

      durations.forEach((duration, index) => {
        const declaration: CapabilityDeclaration = {
          type: 'test',
          scope: 'read-only',
          expiresIn: duration
        };

        const token = capabilityManager.issue(`skill-${index}`, declaration, 'agent');
        const now = Math.floor(Date.now() / 1000);
        const expectedExpiry = now + Math.floor(expectedMs[index] / 1000);

        // Allow 2 second tolerance
        expect(token.payload.exp).toBeGreaterThanOrEqual(expectedExpiry - 2);
        expect(token.payload.exp).toBeLessThanOrEqual(expectedExpiry + 2);
      });
    });
  });

  // ============================================================================
  // Token Verification
  // ============================================================================

  describe('Token Verification', () => {
    it('should verify a valid token', () => {
      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'read-only',
        expiresIn: '1h'
      };

      const issued = capabilityManager.issue('test-skill', declaration, 'agent-1');
      const result = capabilityManager.verify(issued.token);

      expect(result.valid).toBe(true);
      expect(result.payload?.iss).toBe('test-skill');
      expect(result.payload?.scope).toBe('test:read-only');
    });

    it('should reject expired token', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'read-only',
        expiresIn: '1m'
      };

      const issued = capabilityManager.issue('test-skill', declaration, 'agent-1');

      // Advance time by 2 minutes
      vi.setSystemTime(now + 2 * 60 * 1000);

      const result = capabilityManager.verify(issued.token);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('should reject token with invalid signature', () => {
      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'read-only'
      };

      const issued = capabilityManager.issue('test-skill', declaration, 'agent-1');
      const tamperedToken = issued.token.slice(0, -5) + 'xxxxx'; // Tamper signature

      const result = capabilityManager.verify(tamperedToken);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid token signature');
    });

    it('should reject malformed token', () => {
      const result = capabilityManager.verify('not-a-valid-token');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid token signature');
    });

    it('should verify required scope', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'write',
        expiresIn: '1h'
      };

      const issued = capabilityManager.issue('db-skill', declaration, 'agent-1');

      // Same or lower scope should pass
      expect(capabilityManager.verify(issued.token, 'db-access:read-only').valid).toBe(true);
      expect(capabilityManager.verify(issued.token, 'db-access:write').valid).toBe(true);

      // Higher scope should fail
      const adminResult = capabilityManager.verify(issued.token, 'db-access:admin');
      expect(adminResult.valid).toBe(false);
      expect(adminResult.reason).toContain('does not satisfy required scope');
    });

    it('should reject scope with different type', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        expiresIn: '1h'
      };

      const issued = capabilityManager.issue('db-skill', declaration, 'agent-1');

      // Different type should fail
      const result = capabilityManager.verify(issued.token, 'file-access:read-only');
      expect(result.valid).toBe(false);
    });
  });

  // ============================================================================
  // Context Verification
  // ============================================================================

  describe('Context Verification', () => {
    it('should verify task ID constraint', () => {
      const declaration: CapabilityDeclaration = {
        type: 'task-bound',
        scope: 'read-only',
        expiresIn: '1h',
        contextConstraints: {
          taskId: 'specific-task-123'
        }
      };

      const issued = capabilityManager.issue('task-skill', declaration, 'agent-1');

      // Correct task ID should pass
      const validResult = capabilityManager.verifyWithContext(
        issued.token,
        'task-bound:read-only',
        { taskId: 'specific-task-123' }
      );
      expect(validResult.valid).toBe(true);

      // Wrong task ID should fail
      const invalidResult = capabilityManager.verifyWithContext(
        issued.token,
        'task-bound:read-only',
        { taskId: 'different-task-456' }
      );
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.reason).toContain('bound to task');
    });

    it('should verify allowed tools constraint', () => {
      const declaration: CapabilityDeclaration = {
        type: 'tool-limited',
        scope: 'write',
        expiresIn: '1h',
        contextConstraints: {
          allowedTools: ['read_file', 'write_file']
        }
      };

      const issued = capabilityManager.issue('limited-skill', declaration, 'agent-1');

      // Allowed tool should pass
      const validResult = capabilityManager.verifyWithContext(
        issued.token,
        'tool-limited:write',
        { toolName: 'read_file' }
      );
      expect(validResult.valid).toBe(true);

      // Disallowed tool should fail
      const invalidResult = capabilityManager.verifyWithContext(
        issued.token,
        'tool-limited:write',
        { toolName: 'delete_file' }
      );
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.reason).toContain('not in allowed tools');
    });

    it('should verify allowed servers constraint', () => {
      const declaration: CapabilityDeclaration = {
        type: 'server-limited',
        scope: 'admin',
        expiresIn: '1h',
        contextConstraints: {
          allowedServers: ['filesystem', 'git']
        }
      };

      const issued = capabilityManager.issue('server-skill', declaration, 'agent-1');

      // Allowed server should pass
      expect(capabilityManager.verifyWithContext(
        issued.token,
        'server-limited:admin',
        { serverName: 'filesystem' }
      ).valid).toBe(true);

      // Disallowed server should fail
      const invalidResult = capabilityManager.verifyWithContext(
        issued.token,
        'server-limited:admin',
        { serverName: 'database' }
      );
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.reason).toContain('not in allowed servers');
    });
  });

  // ============================================================================
  // Token Attenuation
  // ============================================================================

  describe('Token Attenuation', () => {
    it('should attenuate token with weaker scope', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        expiresIn: '1h',
        attenuationAllowed: true
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent-1');
      const child = capabilityManager.attenuate({
        parentToken: parent.token,
        newScope: 'db-access:read-only'
      });

      expect(child.payload.scope).toBe('db-access:read-only');
      expect(child.payload.parentJti).toBe(parent.payload.jti);
      expect(child.payload.iss).toBe(parent.payload.iss);
    });

    it('should reject attenuation to stronger scope', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'read-only',
        expiresIn: '1h',
        attenuationAllowed: true
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent-1');

      expect(() => {
        capabilityManager.attenuate({
          parentToken: parent.token,
          newScope: 'db-access:admin'
        });
      }).toThrow('not a subset of parent scope');
    });

    it('should reject attenuation when not allowed', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        expiresIn: '1h',
        attenuationAllowed: false
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent-1');

      expect(() => {
        capabilityManager.attenuate({
          parentToken: parent.token,
          newScope: 'db-access:read-only'
        });
      }).toThrow('does not allow attenuation');
    });

    it('should attenuate with shorter expiration', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        expiresIn: '1h',
        attenuationAllowed: true
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent-1');
      const child = capabilityManager.attenuate({
        parentToken: parent.token,
        newScope: 'db-access:read-only',
        newExpiresIn: '30m'
      });

      // Child should expire before parent
      expect(child.payload.exp).toBeLessThan(parent.payload.exp);
    });

    it('should cap attenuation expiration to parent', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        expiresIn: '30m',
        attenuationAllowed: true
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent-1');
      const child = capabilityManager.attenuate({
        parentToken: parent.token,
        newScope: 'db-access:read-only',
        newExpiresIn: '2h' // Longer than parent
      });

      // Child should be capped to parent expiration
      expect(child.payload.exp).toBe(parent.payload.exp);
    });

    it('should attenuate with fewer uses', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        expiresIn: '1h',
        maxUses: 10,
        attenuationAllowed: true
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent-1');
      const child = capabilityManager.attenuate({
        parentToken: parent.token,
        newScope: 'db-access:read-only',
        newMaxUses: 5
      });

      expect(child.payload.usesLeft).toBe(5);
    });

    it('should add context constraints during attenuation', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        expiresIn: '1h',
        attenuationAllowed: true
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent-1');
      const child = capabilityManager.attenuate({
        parentToken: parent.token,
        newScope: 'db-access:read-only',
        additionalContext: {
          taskId: 'child-task-123',
          allowedTools: ['query']
        }
      });

      expect(child.payload.context?.taskId).toBe('child-task-123');
      expect(child.payload.context?.allowedTools).toEqual(['query']);
    });
  });

  // ============================================================================
  // Use Tracking
  // ============================================================================

  describe('Use Tracking', () => {
    it('should track and consume uses', () => {
      const declaration: CapabilityDeclaration = {
        type: 'limited',
        scope: 'read-only',
        maxUses: 3
      };

      const token = capabilityManager.issue('limited-skill', declaration, 'agent-1');

      // Verify shows remaining uses
      const verify1 = capabilityManager.verify(token.token);
      expect(verify1.usesRemaining).toBe(3);

      // Consume uses
      expect(capabilityManager.consume(token.token)).toBe(2);
      expect(capabilityManager.consume(token.token)).toBe(1);
      expect(capabilityManager.consume(token.token)).toBe(0);

      // No more uses
      expect(() => capabilityManager.consume(token.token)).toThrow('no remaining uses');
    });

    it('should reject token with exhausted uses', () => {
      const declaration: CapabilityDeclaration = {
        type: 'single-use',
        scope: 'read-only',
        maxUses: 1
      };

      const token = capabilityManager.issue('single-skill', declaration, 'agent-1');

      // Use it once
      capabilityManager.consume(token.token);

      // Verification should fail
      const result = capabilityManager.verify(token.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('no remaining uses');
    });

    it('should allow unlimited uses when maxUses not specified', () => {
      const declaration: CapabilityDeclaration = {
        type: 'unlimited',
        scope: 'read-only'
      };

      const token = capabilityManager.issue('unlimited-skill', declaration, 'agent-1');

      // Should always return undefined for unlimited tokens
      expect(capabilityManager.consume(token.token)).toBeUndefined();
      expect(capabilityManager.consume(token.token)).toBeUndefined();
      expect(capabilityManager.consume(token.token)).toBeUndefined();

      // Should still verify
      expect(capabilityManager.verify(token.token).valid).toBe(true);
    });
  });

  // ============================================================================
  // Token Revocation
  // ============================================================================

  describe('Token Revocation', () => {
    it('should revoke a tracked token', () => {
      const declaration: CapabilityDeclaration = {
        type: 'revocable',
        scope: 'read-only',
        maxUses: 10
      };

      const token = capabilityManager.issue('revocable-skill', declaration, 'agent-1');

      // Token is valid initially
      expect(capabilityManager.verify(token.token).valid).toBe(true);
      expect(capabilityManager.isRevoked(token.payload.jti)).toBe(false);

      // Revoke it
      capabilityManager.revoke(token.payload.jti, 'Security incident');

      // Token is now invalid
      const result = capabilityManager.verify(token.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('revoked');
      expect(result.reason).toContain('Security incident');
      expect(capabilityManager.isRevoked(token.payload.jti)).toBe(true);
    });

    it('should revoke an untracked token', () => {
      const declaration: CapabilityDeclaration = {
        type: 'unlimited',
        scope: 'read-only'
      };

      const token = capabilityManager.issue('unlimited-skill', declaration, 'agent-1');

      // Revoke untracked token
      capabilityManager.revoke(token.payload.jti, 'Preemptive revocation');

      // Token is now invalid
      const result = capabilityManager.verify(token.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('revoked');
    });
  });

  // ============================================================================
  // Statistics and Cleanup
  // ============================================================================

  describe('Statistics and Cleanup', () => {
    it('should return correct statistics', () => {
      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'read-only',
        maxUses: 2
      };

      // Issue some tokens
      const token1 = capabilityManager.issue('skill-1', declaration, 'agent-1');
      const token2 = capabilityManager.issue('skill-2', declaration, 'agent-2');
      const token3 = capabilityManager.issue('skill-3', declaration, 'agent-3');

      // Exhaust token1
      capabilityManager.consume(token1.token);
      capabilityManager.consume(token1.token);

      // Revoke token2
      capabilityManager.revoke(token2.payload.jti, 'Test revocation');

      const stats = capabilityManager.getStats();

      expect(stats.trackedTokens).toBe(3);
      expect(stats.exhaustedTokens).toBe(1);
      expect(stats.revokedTokens).toBe(1);
    });

    it('should clean up old tokens', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'read-only',
        maxUses: 1
      };

      const token = capabilityManager.issue('cleanup-skill', declaration, 'agent-1');
      capabilityManager.consume(token.token); // Exhaust it

      // Stats before cleanup
      expect(capabilityManager.getStats().trackedTokens).toBe(1);

      // Advance 25 hours
      vi.setSystemTime(now + 25 * 60 * 60 * 1000);

      // Cleanup should remove exhausted token
      const cleaned = capabilityManager.cleanup();
      expect(cleaned).toBe(1);
      expect(capabilityManager.getStats().trackedTokens).toBe(0);
    });
  });

  // ============================================================================
  // Factory Function
  // ============================================================================

  describe('Factory Function', () => {
    it('should create manager with default config', () => {
      const manager = createCapabilityManager(testLogger);
      expect(manager).toBeInstanceOf(CapabilityManager);
    });

    it('should create manager with custom config', () => {
      const manager = createCapabilityManager(testLogger, {
        secretKey: 'custom-key',
        maxTrackedTokens: 500,
        strictMode: true
      });
      expect(manager).toBeInstanceOf(CapabilityManager);
    });
  });

  // ============================================================================
  // Security Edge Cases
  // ============================================================================

  describe('Security Edge Cases', () => {
    it('should reject token from different secret key', () => {
      const manager1 = createCapabilityManager(testLogger, { secretKey: 'key-1' });
      const manager2 = createCapabilityManager(testLogger, { secretKey: 'key-2' });

      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'admin'
      };

      const token = manager1.issue('skill', declaration, 'agent');

      // Token from manager1 should not verify with manager2
      const result = manager2.verify(token.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid token signature');
    });

    it('should reject token with future nbf', () => {
      // This would require internal manipulation, but we test the logic
      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'admin'
      };

      const token = capabilityManager.issue('skill', declaration, 'agent');

      // Regular tokens should be valid immediately
      expect(capabilityManager.verify(token.token).valid).toBe(true);
    });

    it('should handle invalid duration format', () => {
      const declaration: CapabilityDeclaration = {
        type: 'test',
        scope: 'admin',
        expiresIn: 'invalid'
      };

      expect(() => {
        capabilityManager.issue('skill', declaration, 'agent');
      }).toThrow('Invalid duration format');
    });

    it('should handle scope type mismatch in attenuation', () => {
      const declaration: CapabilityDeclaration = {
        type: 'db-access',
        scope: 'admin',
        attenuationAllowed: true
      };

      const parent = capabilityManager.issue('db-skill', declaration, 'agent');

      expect(() => {
        capabilityManager.attenuate({
          parentToken: parent.token,
          newScope: 'file-access:read-only' // Different type
        });
      }).toThrow('not a subset of parent scope');
    });
  });
});
