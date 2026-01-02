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
import type { IdentityConfig, AgentIdentity, SkillDefinition } from '../src/types/router-types.js';

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

describe('Skill-Based Identity Loading', () => {
  describe('loadFromSkills', () => {
    it('should load identity patterns from skills', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'admin-skill',
          displayName: 'Admin Skill',
          description: 'Admin tools',
          allowedRoles: ['admin'],
          allowedTools: ['*'],
          identity: {
            mappings: [
              { pattern: 'claude-code', role: 'admin', priority: 100 },
              { pattern: 'aegis-admin-*', role: 'admin', priority: 100 }
            ],
            trustedPrefixes: ['claude-', 'aegis-']
          }
        }
      ];

      resolver.loadFromSkills(skills);

      // Test pattern matching
      const claudeResult = resolver.resolve({ name: 'claude-code' });
      expect(claudeResult.roleId).toBe('admin');
      expect(claudeResult.matchedPattern).toBe('claude-code');

      const adminAgentResult = resolver.resolve({ name: 'aegis-admin-main' });
      expect(adminAgentResult.roleId).toBe('admin');
    });

    it('should load patterns from multiple skills', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'frontend-skill',
          displayName: 'Frontend Development',
          description: 'Frontend tools',
          allowedRoles: ['frontend'],
          allowedTools: ['filesystem__*'],
          identity: {
            mappings: [
              { pattern: 'aegis-frontend-*', role: 'frontend', priority: 50 }
            ]
          }
        },
        {
          id: 'backend-skill',
          displayName: 'Backend Development',
          description: 'Backend tools',
          allowedRoles: ['backend'],
          allowedTools: ['database__*'],
          identity: {
            mappings: [
              { pattern: 'aegis-backend-*', role: 'backend', priority: 50 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const frontendResult = resolver.resolve({ name: 'aegis-frontend-ui-builder' });
      expect(frontendResult.roleId).toBe('frontend');

      const backendResult = resolver.resolve({ name: 'aegis-backend-api-service' });
      expect(backendResult.roleId).toBe('backend');
    });

    it('should respect priority ordering across skills', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'low-priority-skill',
          displayName: 'Low Priority',
          description: 'Low priority skill',
          allowedRoles: ['guest'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'aegis-*', role: 'guest', priority: 10 }
            ]
          }
        },
        {
          id: 'high-priority-skill',
          displayName: 'High Priority',
          description: 'High priority skill',
          allowedRoles: ['admin'],
          allowedTools: ['*'],
          identity: {
            mappings: [
              { pattern: 'aegis-admin-*', role: 'admin', priority: 100 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      // Higher priority should win
      const adminResult = resolver.resolve({ name: 'aegis-admin-main' });
      expect(adminResult.roleId).toBe('admin');

      // Lower priority pattern should match other aegis agents
      const guestResult = resolver.resolve({ name: 'aegis-guest-viewer' });
      expect(guestResult.roleId).toBe('guest');
    });

    it('should aggregate trusted prefixes from all skills', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'skill-a',
          displayName: 'Skill A',
          description: 'Skill A',
          allowedRoles: ['a'],
          allowedTools: [],
          identity: {
            mappings: [],
            trustedPrefixes: ['trusted-a-']
          }
        },
        {
          id: 'skill-b',
          displayName: 'Skill B',
          description: 'Skill B',
          allowedRoles: ['b'],
          allowedTools: [],
          identity: {
            mappings: [],
            trustedPrefixes: ['trusted-b-']
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.trustedPrefixes).toContain('trusted-a-');
      expect(stats.trustedPrefixes).toContain('trusted-b-');

      // Check trust detection
      const trustedA = resolver.resolve({ name: 'trusted-a-agent' });
      expect(trustedA.isTrusted).toBe(true);

      const trustedB = resolver.resolve({ name: 'trusted-b-agent' });
      expect(trustedB.isTrusted).toBe(true);
    });

    it('should skip skills without identity config', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'skill-with-identity',
          displayName: 'With Identity',
          description: 'Has identity config',
          allowedRoles: ['developer'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'dev-*', role: 'developer' }
            ]
          }
        },
        {
          id: 'skill-without-identity',
          displayName: 'Without Identity',
          description: 'No identity config',
          allowedRoles: ['tester'],
          allowedTools: []
          // No identity field
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.totalPatterns).toBe(1);
      expect(stats.patternsByRole).toEqual({ developer: 1 });
    });

    it('should avoid duplicate patterns', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'skill-1',
          displayName: 'Skill 1',
          description: 'First skill',
          allowedRoles: ['admin'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'claude-code', role: 'admin', priority: 100 }
            ]
          }
        },
        {
          id: 'skill-2',
          displayName: 'Skill 2',
          description: 'Second skill with same pattern',
          allowedRoles: ['admin'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'claude-code', role: 'admin', priority: 100 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.totalPatterns).toBe(1); // Should only have one pattern
    });

    it('should allow same pattern with different roles', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'skill-1',
          displayName: 'Skill 1',
          description: 'First skill',
          allowedRoles: ['admin'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'multi-role-agent', role: 'admin', priority: 100 }
            ]
          }
        },
        {
          id: 'skill-2',
          displayName: 'Skill 2',
          description: 'Second skill with same pattern but different role',
          allowedRoles: ['developer'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'multi-role-agent', role: 'developer', priority: 50 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.totalPatterns).toBe(2); // Should have both patterns

      // Higher priority wins
      const result = resolver.resolve({ name: 'multi-role-agent' });
      expect(result.roleId).toBe('admin');
    });
  });

  describe('clearPatterns', () => {
    it('should clear all patterns', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addPattern({ pattern: 'test-*', role: 'test' });

      expect(resolver.getStats().totalPatterns).toBe(1);

      resolver.clearPatterns();

      expect(resolver.getStats().totalPatterns).toBe(0);
      expect(resolver.getPatterns()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');

      const skills: SkillDefinition[] = [
        {
          id: 'admin-skill',
          displayName: 'Admin',
          description: 'Admin skill',
          allowedRoles: ['admin'],
          allowedTools: ['*'],
          identity: {
            mappings: [
              { pattern: 'claude-*', role: 'admin', priority: 100 },
              { pattern: 'aegis-admin-*', role: 'admin', priority: 100 }
            ],
            trustedPrefixes: ['claude-', 'aegis-']
          }
        },
        {
          id: 'frontend-skill',
          displayName: 'Frontend',
          description: 'Frontend skill',
          allowedRoles: ['frontend'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'aegis-frontend-*', role: 'frontend', priority: 50 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.totalPatterns).toBe(3);
      expect(stats.patternsByRole).toEqual({
        admin: 2,
        frontend: 1
      });
      expect(stats.trustedPrefixes).toContain('claude-');
      expect(stats.trustedPrefixes).toContain('aegis-');
      expect(stats.defaultRole).toBe('guest');
    });
  });

  describe('Integration with Default Config', () => {
    it('should merge skill patterns with existing config', () => {
      const config: IdentityConfig = {
        version: '1.0.0',
        defaultRole: 'guest',
        trustedPrefixes: ['internal-'],
        patterns: [
          { pattern: 'internal-*', role: 'internal', priority: 50 }
        ]
      };

      const resolver = createIdentityResolver(testLogger, config);

      const skills: SkillDefinition[] = [
        {
          id: 'external-skill',
          displayName: 'External',
          description: 'External skill',
          allowedRoles: ['external'],
          allowedTools: [],
          identity: {
            mappings: [
              { pattern: 'external-*', role: 'external', priority: 50 }
            ],
            trustedPrefixes: ['external-']
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.totalPatterns).toBe(2);
      expect(stats.trustedPrefixes).toContain('internal-');
      expect(stats.trustedPrefixes).toContain('external-');

      // Both patterns should work
      const internalResult = resolver.resolve({ name: 'internal-service' });
      expect(internalResult.roleId).toBe('internal');
      expect(internalResult.isTrusted).toBe(true);

      const externalResult = resolver.resolve({ name: 'external-api' });
      expect(externalResult.roleId).toBe('external');
      expect(externalResult.isTrusted).toBe(true);
    });
  });

  describe('Real-world Skill Example', () => {
    it('should handle a complete skill-based A2A configuration', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');

      // Simulating skills as they would be defined in SKILL.yaml files
      const skills: SkillDefinition[] = [
        {
          id: 'admin-access',
          displayName: 'Admin Access',
          description: 'Full administrative access for trusted agents',
          allowedRoles: ['admin'],
          allowedTools: ['*'],
          grants: { memory: 'all' },
          identity: {
            mappings: [
              { pattern: 'claude-code', role: 'admin', priority: 100, description: 'Claude Code gets admin' },
              { pattern: 'aegis-admin-*', role: 'admin', priority: 100, description: 'Admin agents' }
            ],
            trustedPrefixes: ['claude-', 'aegis-']
          }
        },
        {
          id: 'frontend-dev',
          displayName: 'Frontend Development',
          description: 'Frontend component development tools',
          allowedRoles: ['frontend'],
          allowedTools: ['filesystem__read_file', 'filesystem__write_file'],
          grants: { memory: 'isolated' },
          identity: {
            mappings: [
              { pattern: 'aegis-frontend-*', role: 'frontend', priority: 50 },
              { pattern: '*-ui-agent', role: 'frontend', priority: 10 }
            ]
          }
        },
        {
          id: 'backend-dev',
          displayName: 'Backend Development',
          description: 'Backend API development tools',
          allowedRoles: ['backend'],
          allowedTools: ['database__*', 'api__*'],
          grants: { memory: 'isolated' },
          identity: {
            mappings: [
              { pattern: 'aegis-backend-*', role: 'backend', priority: 50 },
              { pattern: '*-api-agent', role: 'backend', priority: 10 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      // Test Claude Code → admin
      const claudeResult = resolver.resolve({ name: 'claude-code', version: '1.0.0' });
      expect(claudeResult.roleId).toBe('admin');
      expect(claudeResult.isTrusted).toBe(true);
      expect(claudeResult.matchedPattern).toBe('claude-code');

      // Test frontend agent
      const frontendResult = resolver.resolve({ name: 'aegis-frontend-component-builder' });
      expect(frontendResult.roleId).toBe('frontend');
      expect(frontendResult.isTrusted).toBe(true);

      // Test backend agent
      const backendResult = resolver.resolve({ name: 'aegis-backend-api-gateway' });
      expect(backendResult.roleId).toBe('backend');
      expect(backendResult.isTrusted).toBe(true);

      // Test suffix pattern matching
      const uiAgentResult = resolver.resolve({ name: 'custom-ui-agent' });
      expect(uiAgentResult.roleId).toBe('frontend');
      expect(uiAgentResult.isTrusted).toBe(false); // not in trusted prefixes

      // Test unknown agent → guest
      const unknownResult = resolver.resolve({ name: 'unknown-service' });
      expect(unknownResult.roleId).toBe('guest');
      expect(unknownResult.matchedPattern).toBeNull();
      expect(unknownResult.isTrusted).toBe(false);

      // Verify stats
      const stats = resolver.getStats();
      expect(stats.totalPatterns).toBe(6);
      expect(stats.patternsByRole.admin).toBe(2);
      expect(stats.patternsByRole.frontend).toBe(2);
      expect(stats.patternsByRole.backend).toBe(2);
    });
  });
});
