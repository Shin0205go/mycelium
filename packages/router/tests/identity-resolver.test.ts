/**
 * Identity Resolver Tests
 *
 * Tests covering A2A identity resolution:
 * 1. Pattern matching (glob-style)
 * 2. Priority ordering
 * 3. Default role fallback
 * 4. Reject unknown mode
 * 5. Trusted prefix detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityResolver, createIdentityResolver } from '../src/router/identity-resolver.js';
import { Logger } from '../src/utils/logger.js';
import type { IdentityConfig, AgentIdentity } from '../src/types/router-types.js';

// Set LOG_SILENT for tests
process.env.LOG_SILENT = 'true';
const testLogger = new Logger();

describe('IdentityResolver', () => {
  describe('Basic Resolution', () => {
    it('should resolve to default role when no patterns match', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');

      const identity: AgentIdentity = { name: 'unknown-agent' };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('guest');
      expect(result.agentName).toBe('unknown-agent');
      expect(result.matchedPattern).toBeNull();
    });

    it('should resolve exact pattern match', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addPattern({ pattern: 'claude-code', role: 'admin' });

      const identity: AgentIdentity = { name: 'claude-code' };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('admin');
      expect(result.matchedPattern).toBe('claude-code');
    });

    it('should resolve wildcard pattern', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addPattern({ pattern: 'aegis-frontend-*', role: 'frontend' });

      const identity: AgentIdentity = { name: 'aegis-frontend-12345' };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('frontend');
      expect(result.matchedPattern).toBe('aegis-frontend-*');
    });

    it('should resolve suffix wildcard pattern', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addPattern({ pattern: '*-agent', role: 'developer' });

      const identity: AgentIdentity = { name: 'test-agent' };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('developer');
    });

    it('should resolve middle wildcard pattern', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addPattern({ pattern: 'agent-*-dev', role: 'developer' });

      const identity: AgentIdentity = { name: 'agent-frontend-dev' };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('developer');
    });
  });

  describe('Priority Ordering', () => {
    it('should use higher priority patterns first', () => {
      // Use fresh resolver for this test
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.addPattern({ pattern: '*', role: 'guest', priority: 0 });
      freshResolver.addPattern({ pattern: 'aegis-*', role: 'developer', priority: 10 });
      freshResolver.addPattern({ pattern: 'aegis-admin-*', role: 'admin', priority: 100 });

      // Should match highest priority first
      const adminResult = freshResolver.resolve({ name: 'aegis-admin-main' });
      expect(adminResult.roleId).toBe('admin');

      // Should fall through to next match
      const devResult = freshResolver.resolve({ name: 'aegis-frontend-1' });
      expect(devResult.roleId).toBe('developer');

      // Should use lowest priority
      const guestResult = freshResolver.resolve({ name: 'random-agent' });
      expect(guestResult.roleId).toBe('guest');
    });

    it('should use default priority of 0', () => {
      // Use fresh resolver for this test
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.addPattern({ pattern: 'a-*', role: 'role-a' });
      freshResolver.addPattern({ pattern: 'a-*', role: 'role-b', priority: 10 });

      const result = freshResolver.resolve({ name: 'a-test' });
      expect(result.roleId).toBe('role-b');
    });
  });

  describe('Reject Unknown Mode', () => {
    it('should reject unknown agents when configured', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.setRejectUnknown(true);
      freshResolver.addPattern({ pattern: 'allowed-*', role: 'developer' });

      expect(() => {
        freshResolver.resolve({ name: 'not-allowed-agent' });
      }).toThrow(/Unknown agent/);
    });

    it('should not reject when pattern matches', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.setRejectUnknown(true);
      freshResolver.addPattern({ pattern: 'allowed-*', role: 'developer' });

      const result = freshResolver.resolve({ name: 'allowed-agent' });
      expect(result.roleId).toBe('developer');
    });

    it('should use default role when rejectUnknown is false', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.setRejectUnknown(false);
      freshResolver.setDefaultRole('fallback');
      freshResolver.addPattern({ pattern: 'specific-*', role: 'specific' });

      const result = freshResolver.resolve({ name: 'other-agent' });
      expect(result.roleId).toBe('fallback');
    });
  });

  describe('Trusted Prefix Detection', () => {
    it('should detect trusted agents by prefix', () => {
      const freshResolver = createIdentityResolver(testLogger);
      // Default trusted prefixes include 'claude-' and 'aegis-'
      const claudeResult = freshResolver.resolve({ name: 'claude-code' });
      expect(claudeResult.isTrusted).toBe(true);

      const aegisResult = freshResolver.resolve({ name: 'aegis-frontend-1' });
      expect(aegisResult.isTrusted).toBe(true);
    });

    it('should mark untrusted agents', () => {
      const freshResolver = createIdentityResolver(testLogger);
      const result = freshResolver.resolve({ name: 'random-agent' });
      expect(result.isTrusted).toBe(false);
    });

    it('should be case-insensitive for trust detection', () => {
      const freshResolver = createIdentityResolver(testLogger);
      const result = freshResolver.resolve({ name: 'CLAUDE-CODE' });
      expect(result.isTrusted).toBe(true);
    });
  });

  describe('Configuration Management', () => {
    it('should allow adding patterns dynamically', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.addPattern({ pattern: 'new-*', role: 'new-role' });

      const patterns = freshResolver.getPatterns();
      expect(patterns.some(p => p.pattern === 'new-*')).toBe(true);
    });

    it('should return config copy', () => {
      const freshResolver = createIdentityResolver(testLogger);
      const config = freshResolver.getConfig();
      expect(config.version).toBe('1.0.0');
      expect(config.defaultRole).toBe('default');
    });

    it('should check if role pattern exists', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.addPattern({ pattern: 'test-*', role: 'tester' });

      expect(freshResolver.hasRolePattern('tester')).toBe(true);
      expect(freshResolver.hasRolePattern('nonexistent')).toBe(false);
    });

    it('should include default role in hasRolePattern check', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.setDefaultRole('fallback');
      expect(freshResolver.hasRolePattern('fallback')).toBe(true);
    });
  });

  describe('Full Configuration', () => {
    it('should work with complete config', () => {
      const config: IdentityConfig = {
        version: '2.0.0',
        defaultRole: 'guest',
        rejectUnknown: false,
        trustedPrefixes: ['internal-', 'trusted-'],
        patterns: [
          { pattern: 'admin-*', role: 'admin', priority: 100 },
          { pattern: 'dev-*', role: 'developer', priority: 50 },
          { pattern: '*', role: 'viewer', priority: 0 }
        ]
      };

      const resolver = createIdentityResolver(testLogger, config);

      // Test admin
      const adminResult = resolver.resolve({ name: 'admin-main' });
      expect(adminResult.roleId).toBe('admin');

      // Test developer
      const devResult = resolver.resolve({ name: 'dev-frontend' });
      expect(devResult.roleId).toBe('developer');

      // Test trusted detection
      const trustedResult = resolver.resolve({ name: 'internal-service' });
      expect(trustedResult.isTrusted).toBe(true);

      const untrustedResult = resolver.resolve({ name: 'external-service' });
      expect(untrustedResult.isTrusted).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty agent name by using fallback', () => {
      const freshResolver = createIdentityResolver(testLogger);
      const result = freshResolver.resolve({ name: '' });
      // Empty string is treated as 'unknown' for safety
      expect(result.agentName).toBe('unknown');
    });

    it('should handle undefined agent name', () => {
      const freshResolver = createIdentityResolver(testLogger);
      const result = freshResolver.resolve({ name: undefined as any });
      expect(result.agentName).toBe('unknown');
    });

    it('should handle special characters in pattern', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.addPattern({ pattern: 'agent.v1.*', role: 'versioned' });

      const result = freshResolver.resolve({ name: 'agent.v1.beta' });
      expect(result.roleId).toBe('versioned');
    });

    it('should handle multiple wildcards', () => {
      const freshResolver = createIdentityResolver(testLogger);
      freshResolver.addPattern({ pattern: '*-*-*', role: 'triple' });

      const result = freshResolver.resolve({ name: 'a-b-c' });
      expect(result.roleId).toBe('triple');
    });

    it('should include resolution timestamp', () => {
      const freshResolver = createIdentityResolver(testLogger);
      const beforeTime = new Date();
      const result = freshResolver.resolve({ name: 'test' });
      const afterTime = new Date();

      expect(result.resolvedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(result.resolvedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });
});

describe('A2A Mode Integration', () => {
  it('should resolve identity for A2A connection', () => {
    const config: IdentityConfig = {
      version: '1.0.0',
      defaultRole: 'guest',
      trustedPrefixes: ['claude-', 'aegis-'],
      patterns: [
        { pattern: 'claude-*', role: 'admin', priority: 100 },
        { pattern: 'aegis-frontend-*', role: 'frontend', priority: 50 },
        { pattern: 'aegis-backend-*', role: 'backend', priority: 50 }
      ]
    };

    const resolver = createIdentityResolver(testLogger, config);

    // Simulate Claude Code connection
    const claudeResult = resolver.resolve({
      name: 'claude-code',
      version: '1.0.0'
    });
    expect(claudeResult.roleId).toBe('admin');
    expect(claudeResult.isTrusted).toBe(true);

    // Simulate frontend sub-agent
    const frontendResult = resolver.resolve({
      name: 'aegis-frontend-component-builder'
    });
    expect(frontendResult.roleId).toBe('frontend');
    expect(frontendResult.isTrusted).toBe(true);

    // Simulate unknown agent
    const unknownResult = resolver.resolve({
      name: 'external-tool'
    });
    expect(unknownResult.roleId).toBe('guest');
    expect(unknownResult.matchedPattern).toBeNull();
    expect(unknownResult.isTrusted).toBe(false);
  });
});
