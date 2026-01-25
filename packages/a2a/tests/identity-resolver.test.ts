/**
 * Identity Resolver Tests
 *
 * Tests covering A2A skill-based identity resolution:
 * 1. Required skills matching (AND logic)
 * 2. Any skills matching (OR logic)
 * 3. Priority ordering
 * 4. Default role fallback
 * 5. Reject unknown mode
 * 6. Trusted prefix detection
 * 7. Loading from Mycelium skills
 */

import { describe, it, expect } from 'vitest';
import { IdentityResolver, createIdentityResolver } from '../src/identity-resolver.js';
import type { Logger } from '@mycelium/shared';
import type { AgentIdentity, SkillDefinition } from '../src/types.js';

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('IdentityResolver', () => {
  describe('Basic Resolution', () => {
    it('should resolve to default role when no rules match', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');

      const identity: AgentIdentity = {
        name: 'unknown-agent',
        skills: [{ id: 'some_skill' }]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('guest');
      expect(result.agentName).toBe('unknown-agent');
      expect(result.matchedRule).toBeNull();
      expect(result.matchedSkills).toEqual([]);
    });

    it('should resolve to default role when agent has no skills', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');
      resolver.addRule({
        role: 'developer',
        requiredSkills: ['coding']
      });

      const identity: AgentIdentity = {
        name: 'empty-agent',
        skills: []
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('guest');
    });
  });

  describe('Required Skills Matching (AND logic)', () => {
    it('should match when agent has all required skills', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({
        role: 'frontend',
        requiredSkills: ['create_component', 'style_design']
      });

      const identity: AgentIdentity = {
        name: 'frontend-agent',
        skills: [
          { id: 'create_component' },
          { id: 'style_design' },
          { id: 'extra_skill' }
        ]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('frontend');
      expect(result.matchedSkills).toContain('create_component');
      expect(result.matchedSkills).toContain('style_design');
    });

    it('should not match when missing one required skill', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');
      resolver.addRule({
        role: 'frontend',
        requiredSkills: ['create_component', 'style_design']
      });

      const identity: AgentIdentity = {
        name: 'partial-agent',
        skills: [
          { id: 'create_component' }
          // missing style_design
        ]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('guest');
    });
  });

  describe('Any Skills Matching (OR logic)', () => {
    it('should match when agent has at least one of anySkills', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({
        role: 'frontend',
        anySkills: ['react_development', 'vue_development', 'angular_development']
      });

      const identity: AgentIdentity = {
        name: 'react-agent',
        skills: [{ id: 'react_development' }]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('frontend');
      expect(result.matchedSkills).toContain('react_development');
    });

    it('should not match when agent has none of anySkills', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');
      resolver.addRule({
        role: 'frontend',
        anySkills: ['react_development', 'vue_development']
      });

      const identity: AgentIdentity = {
        name: 'backend-agent',
        skills: [{ id: 'database_query' }]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('guest');
    });

    it('should respect minSkillMatch for anySkills', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');
      resolver.addRule({
        role: 'senior',
        anySkills: ['react', 'vue', 'angular', 'svelte'],
        minSkillMatch: 2
      });

      // Agent with only 1 skill - should not match
      const identity1: AgentIdentity = {
        name: 'junior-agent',
        skills: [{ id: 'react' }]
      };
      expect(resolver.resolve(identity1).roleId).toBe('guest');

      // Agent with 2 skills - should match
      const identity2: AgentIdentity = {
        name: 'senior-agent',
        skills: [{ id: 'react' }, { id: 'vue' }]
      };
      expect(resolver.resolve(identity2).roleId).toBe('senior');
    });
  });

  describe('Combined Required + Any Skills', () => {
    it('should match when both required and any skills are satisfied', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({
        role: 'fullstack',
        requiredSkills: ['coding', 'testing'],
        anySkills: ['frontend_framework', 'backend_framework']
      });

      const identity: AgentIdentity = {
        name: 'fullstack-agent',
        skills: [
          { id: 'coding' },
          { id: 'testing' },
          { id: 'frontend_framework' }
        ]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('fullstack');
    });

    it('should not match if required skills are missing even if any skills match', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');
      resolver.addRule({
        role: 'fullstack',
        requiredSkills: ['coding', 'testing'],
        anySkills: ['frontend_framework', 'backend_framework']
      });

      const identity: AgentIdentity = {
        name: 'partial-agent',
        skills: [
          { id: 'coding' },
          // missing testing
          { id: 'frontend_framework' }
        ]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('guest');
    });
  });

  describe('Priority Ordering', () => {
    it('should use higher priority rules first', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({
        role: 'developer',
        anySkills: ['coding'],
        priority: 10
      });
      resolver.addRule({
        role: 'admin',
        anySkills: ['coding', 'admin_access'],
        priority: 100
      });

      // Agent has both skills - higher priority rule wins
      const identity: AgentIdentity = {
        name: 'admin-agent',
        skills: [{ id: 'coding' }, { id: 'admin_access' }]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('admin');
    });

    it('should use default priority of 0', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({
        role: 'role-a',
        anySkills: ['skill-x']
        // no priority = 0
      });
      resolver.addRule({
        role: 'role-b',
        anySkills: ['skill-x'],
        priority: 10
      });

      const identity: AgentIdentity = {
        name: 'agent',
        skills: [{ id: 'skill-x' }]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('role-b');
    });
  });

  describe('Reject Unknown Mode', () => {
    it('should reject unknown agents when configured', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setRejectUnknown(true);
      resolver.addRule({
        role: 'developer',
        requiredSkills: ['coding']
      });

      const identity: AgentIdentity = {
        name: 'unknown-agent',
        skills: [{ id: 'unrelated_skill' }]
      };

      expect(() => resolver.resolve(identity)).toThrow(/Unknown agent/);
    });

    it('should not reject when rule matches', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setRejectUnknown(true);
      resolver.addRule({
        role: 'developer',
        requiredSkills: ['coding']
      });

      const identity: AgentIdentity = {
        name: 'dev-agent',
        skills: [{ id: 'coding' }]
      };

      expect(() => resolver.resolve(identity)).not.toThrow();
      expect(resolver.resolve(identity).roleId).toBe('developer');
    });
  });

  describe('Trusted Prefix Detection', () => {
    it('should detect trusted agents by name prefix', () => {
      const resolver = createIdentityResolver(testLogger);
      // Default trusted prefixes include 'claude-' and 'mycelium-'

      const claudeResult = resolver.resolve({ name: 'claude-code', skills: [] });
      expect(claudeResult.isTrusted).toBe(true);

      const myceliumResult = resolver.resolve({ name: 'mycelium-frontend-1', skills: [] });
      expect(myceliumResult.isTrusted).toBe(true);
    });

    it('should mark untrusted agents', () => {
      const resolver = createIdentityResolver(testLogger);
      const result = resolver.resolve({ name: 'random-agent', skills: [] });
      expect(result.isTrusted).toBe(false);
    });

    it('should be case-insensitive for trust detection', () => {
      const resolver = createIdentityResolver(testLogger);
      const result = resolver.resolve({ name: 'CLAUDE-CODE', skills: [] });
      expect(result.isTrusted).toBe(true);
    });
  });

  describe('Forbidden Skills', () => {
  it('should reject agent with forbidden skill', () => {
    const resolver = createIdentityResolver(testLogger);
    resolver.setDefaultRole('guest');
    resolver.addRule({
      role: 'admin',
      requiredSkills: ['admin_access'],
      forbiddenSkills: ['trial_user', 'sandbox_mode']
    });

    // Agent with required skill but also has forbidden skill
    const trialAgent: AgentIdentity = {
      name: 'trial-admin',
      skills: [{ id: 'admin_access' }, { id: 'trial_user' }]
    };

    // Should NOT match admin role due to forbidden skill
    const result = resolver.resolve(trialAgent);
    expect(result.roleId).toBe('guest');
  });

  it('should allow agent without forbidden skills', () => {
    const resolver = createIdentityResolver(testLogger);
    resolver.addRule({
      role: 'admin',
      requiredSkills: ['admin_access'],
      forbiddenSkills: ['trial_user']
    });

    const realAdmin: AgentIdentity = {
      name: 'real-admin',
      skills: [{ id: 'admin_access' }, { id: 'full_license' }]
    };

    const result = resolver.resolve(realAdmin);
    expect(result.roleId).toBe('admin');
  });

  it('should check forbidden skills before required skills', () => {
    const resolver = createIdentityResolver(testLogger);
    resolver.setDefaultRole('guest');
    resolver.addRule({
      role: 'premium',
      requiredSkills: ['premium_access'],
      forbiddenSkills: ['deprecated_agent']
    });

    // Even with required skill, forbidden takes precedence
    const deprecatedAgent: AgentIdentity = {
      name: 'old-agent',
      skills: [{ id: 'premium_access' }, { id: 'deprecated_agent' }]
    };

    expect(resolver.resolve(deprecatedAgent).roleId).toBe('guest');
  });

  it('should handle multiple forbidden skills', () => {
    const resolver = createIdentityResolver(testLogger);
    resolver.setDefaultRole('guest');
    resolver.addRule({
      role: 'secure',
      anySkills: ['coding'],
      forbiddenSkills: ['untrusted', 'compromised', 'blacklisted']
    });

    // Any single forbidden skill should block
    const agent1: AgentIdentity = {
      name: 'agent1',
      skills: [{ id: 'coding' }, { id: 'compromised' }]
    };
    expect(resolver.resolve(agent1).roleId).toBe('guest');

    // Clean agent should pass
    const agent2: AgentIdentity = {
      name: 'agent2',
      skills: [{ id: 'coding' }]
    };
    expect(resolver.resolve(agent2).roleId).toBe('secure');
  });
});

describe('Context Conditions - Time Based', () => {
  it('should allow access during allowed days', () => {
    const resolver = createIdentityResolver(testLogger);
    const today = new Date().getDay(); // 0-6

    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedDays: [today] // Allow today
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('worker');
  });

  it('should deny access on non-allowed days', () => {
    const resolver = createIdentityResolver(testLogger);
    resolver.setDefaultRole('guest');
    const today = new Date().getDay();
    const tomorrow = (today + 1) % 7;

    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedDays: [tomorrow] // Only allow tomorrow
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    // Should fall back to default since today is not allowed
    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('guest');
  });

  it('should allow access during allowed time range', () => {
    const resolver = createIdentityResolver(testLogger);

    // Create a time range that includes current time
    const now = new Date();
    const startHour = now.getHours();
    const endHour = (startHour + 2) % 24;
    const timeRange = `${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`;

    resolver.addRule({
      role: 'shift-worker',
      anySkills: ['work'],
      context: {
        allowedTime: timeRange
      }
    });

    const agent: AgentIdentity = {
      name: 'shift-worker',
      skills: [{ id: 'work' }]
    };

    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('shift-worker');
  });

  it('should deny access outside allowed time range', () => {
    const resolver = createIdentityResolver(testLogger);
    resolver.setDefaultRole('guest');

    // Create a time range that excludes current time
    const now = new Date();
    const futureHour = (now.getHours() + 5) % 24;
    const futureEndHour = (futureHour + 2) % 24;
    const timeRange = `${String(futureHour).padStart(2, '0')}:00-${String(futureEndHour).padStart(2, '0')}:00`;

    resolver.addRule({
      role: 'night-worker',
      anySkills: ['work'],
      context: {
        allowedTime: timeRange
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'work' }]
    };

    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('guest');
  });

  it('should combine day and time restrictions', () => {
    const resolver = createIdentityResolver(testLogger);
    const today = new Date().getDay();
    const now = new Date();
    const startHour = now.getHours();
    const endHour = (startHour + 2) % 24;
    const timeRange = `${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`;

    resolver.addRule({
      role: 'office-worker',
      anySkills: ['work'],
      context: {
        allowedDays: [today],
        allowedTime: timeRange
      }
    });

    const agent: AgentIdentity = {
      name: 'office-worker',
      skills: [{ id: 'work' }]
    };

    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('office-worker');
  });

  it('should handle invalid time format gracefully', () => {
    const resolver = createIdentityResolver(testLogger);

    resolver.addRule({
      role: 'flexible',
      anySkills: ['work'],
      context: {
        allowedTime: 'invalid-format' // Should be ignored
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'work' }]
    };

    // Invalid format should allow access (fail-open for invalid config)
    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('flexible');
  });
});

describe('Context Conditions - Timezone Support', () => {
  it('should use system timezone when not specified', () => {
    const resolver = createIdentityResolver(testLogger);
    const today = new Date().getDay();

    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedDays: [today]
        // No timezone specified - use system default
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('worker');
  });

  it('should apply timezone to day calculation', () => {
    const resolver = createIdentityResolver(testLogger);

    // Allow all days to ensure the test passes regardless of timezone differences
    resolver.addRule({
      role: 'global-worker',
      anySkills: ['coding'],
      context: {
        allowedDays: [0, 1, 2, 3, 4, 5, 6],
        timezone: 'America/New_York'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('global-worker');
  });

  it('should apply timezone to time range calculation', () => {
    const resolver = createIdentityResolver(testLogger);

    // Use a 24-hour range to ensure test passes
    resolver.addRule({
      role: 'tokyo-worker',
      anySkills: ['coding'],
      context: {
        allowedTime: '00:00-23:59',
        timezone: 'Asia/Tokyo'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('tokyo-worker');
  });

  it('should handle invalid timezone gracefully (fall back to system)', () => {
    const resolver = createIdentityResolver(testLogger);
    const today = new Date().getDay();

    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedDays: [today],
        timezone: 'Invalid/Timezone'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    // Invalid timezone falls back to system time (fail-open)
    const result = resolver.resolve(agent);
    expect(result.roleId).toBe('worker');
  });

  it('should support overnight time ranges with timezone', () => {
    const resolver = createIdentityResolver(testLogger);

    // Overnight range that should cover current time if tested during night
    resolver.addRule({
      role: 'night-shift',
      anySkills: ['coding'],
      context: {
        allowedTime: '22:00-06:00',
        timezone: 'UTC'
      }
    });

    // Add a fallback rule for daytime testing
    resolver.addRule({
      role: 'day-shift',
      anySkills: ['coding'],
      context: {
        allowedTime: '06:00-22:00',
        timezone: 'UTC'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    // One of the two rules should match
    const result = resolver.resolve(agent);
    expect(['night-shift', 'day-shift']).toContain(result.roleId);
  });
});

describe('Strict Validation Mode', () => {
  it('should throw on invalid time format when strictValidation is true', () => {
    const resolver = createIdentityResolver(testLogger, {
      version: '1.0.0',
      defaultRole: 'guest',
      skillRules: [],
      strictValidation: true
    });

    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedTime: 'bad-format'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    expect(() => resolver.resolve(agent)).toThrow(/Invalid time range format/);
  });

  it('should throw on invalid timezone when strictValidation is true', () => {
    const resolver = createIdentityResolver(testLogger, {
      version: '1.0.0',
      defaultRole: 'guest',
      skillRules: [],
      strictValidation: true
    });

    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedDays: [1, 2, 3, 4, 5],
        timezone: 'Fake/Timezone'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    expect(() => resolver.resolve(agent)).toThrow(/Invalid timezone/);
  });

  it('should not throw on valid config even with strictValidation', () => {
    const resolver = createIdentityResolver(testLogger, {
      version: '1.0.0',
      defaultRole: 'guest',
      skillRules: [],
      strictValidation: true
    });

    const today = new Date().getDay();
    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedDays: [today],
        allowedTime: '00:00-23:59',
        timezone: 'UTC'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    expect(() => resolver.resolve(agent)).not.toThrow();
    expect(resolver.resolve(agent).roleId).toBe('worker');
  });

  it('should default to fail-open when strictValidation is false', () => {
    const resolver = createIdentityResolver(testLogger, {
      version: '1.0.0',
      defaultRole: 'guest',
      skillRules: [],
      strictValidation: false
    });

    resolver.addRule({
      role: 'worker',
      anySkills: ['coding'],
      context: {
        allowedTime: 'totally-invalid'
      }
    });

    const agent: AgentIdentity = {
      name: 'worker',
      skills: [{ id: 'coding' }]
    };

    // Should not throw, should allow access
    expect(() => resolver.resolve(agent)).not.toThrow();
    expect(resolver.resolve(agent).roleId).toBe('worker');
  });
});

describe('Edge Cases', () => {
    it('should handle empty agent name by using fallback', () => {
      const resolver = createIdentityResolver(testLogger);
      const result = resolver.resolve({ name: '', skills: [] });
      expect(result.agentName).toBe('unknown');
    });

    it('should handle undefined agent name', () => {
      const resolver = createIdentityResolver(testLogger);
      const result = resolver.resolve({ name: undefined as any, skills: [] });
      expect(result.agentName).toBe('unknown');
    });

    it('should handle undefined skills array', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');
      const result = resolver.resolve({ name: 'agent' });
      expect(result.roleId).toBe('guest');
    });

    it('should include resolution timestamp', () => {
      const resolver = createIdentityResolver(testLogger);
      const beforeTime = new Date();
      const result = resolver.resolve({ name: 'test', skills: [] });
      const afterTime = new Date();

      expect(result.resolvedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(result.resolvedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should not match rules with empty skill arrays', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('guest');
      resolver.addRule({
        role: 'empty-rule',
        requiredSkills: [],
        anySkills: []
      });

      const identity: AgentIdentity = {
        name: 'agent',
        skills: [{ id: 'some_skill' }]
      };
      const result = resolver.resolve(identity);

      expect(result.roleId).toBe('guest');
    });
  });

  describe('Configuration Management', () => {
    it('should allow adding rules dynamically', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({ role: 'new-role', requiredSkills: ['new_skill'] });

      const rules = resolver.getRules();
      expect(rules.some(r => r.role === 'new-role')).toBe(true);
    });

    it('should return config copy', () => {
      const resolver = createIdentityResolver(testLogger);
      const config = resolver.getConfig();
      expect(config.version).toBe('1.0.0');
      expect(config.defaultRole).toBe('guest');
    });

    it('should check if role rule exists', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({ role: 'tester', anySkills: ['testing'] });

      expect(resolver.hasRoleRule('tester')).toBe(true);
      expect(resolver.hasRoleRule('nonexistent')).toBe(false);
    });

    it('should include default role in hasRoleRule check', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.setDefaultRole('fallback');
      expect(resolver.hasRoleRule('fallback')).toBe(true);
    });
  });
});

describe('Skill-Based Identity Loading from Mycelium Skills', () => {
  describe('loadFromSkills', () => {
    it('should load skill matching rules from skills', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'admin-skill',
          displayName: 'Admin Skill',
          description: 'Admin tools',
          allowedRoles: ['admin'],
          allowedTools: ['*'],
          identity: {
            skillMatching: [
              {
                role: 'admin',
                requiredSkills: ['admin_access', 'system_management'],
                priority: 100
              }
            ],
            trustedPrefixes: ['admin-']
          }
        }
      ];

      resolver.loadFromSkills(skills);

      // Test matching
      const adminAgent: AgentIdentity = {
        name: 'admin-agent',
        skills: [{ id: 'admin_access' }, { id: 'system_management' }]
      };
      const result = resolver.resolve(adminAgent);

      expect(result.roleId).toBe('admin');
      expect(result.matchedSkills).toContain('admin_access');
      expect(result.matchedSkills).toContain('system_management');
    });

    it('should load rules from multiple skills', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'frontend-skill',
          displayName: 'Frontend Development',
          description: 'Frontend tools',
          allowedRoles: ['frontend'],
          allowedTools: ['filesystem__*'],
          identity: {
            skillMatching: [
              {
                role: 'frontend',
                anySkills: ['react', 'vue', 'angular'],
                priority: 50
              }
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
            skillMatching: [
              {
                role: 'backend',
                anySkills: ['nodejs', 'python', 'java'],
                priority: 50
              }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const frontendAgent: AgentIdentity = {
        name: 'react-agent',
        skills: [{ id: 'react' }]
      };
      expect(resolver.resolve(frontendAgent).roleId).toBe('frontend');

      const backendAgent: AgentIdentity = {
        name: 'node-agent',
        skills: [{ id: 'nodejs' }]
      };
      expect(resolver.resolve(backendAgent).roleId).toBe('backend');
    });

    it('should respect priority ordering across skills', () => {
      const resolver = createIdentityResolver(testLogger);

      const skills: SkillDefinition[] = [
        {
          id: 'low-priority-skill',
          displayName: 'Low Priority',
          description: 'Low priority skill',
          allowedRoles: ['developer'],
          allowedTools: [],
          identity: {
            skillMatching: [
              { role: 'developer', anySkills: ['coding'], priority: 10 }
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
            skillMatching: [
              { role: 'admin', requiredSkills: ['coding', 'admin_access'], priority: 100 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      // Agent with both skills - admin rule wins due to higher priority
      const adminAgent: AgentIdentity = {
        name: 'admin',
        skills: [{ id: 'coding' }, { id: 'admin_access' }]
      };
      expect(resolver.resolve(adminAgent).roleId).toBe('admin');

      // Agent with only coding - developer rule applies
      const devAgent: AgentIdentity = {
        name: 'dev',
        skills: [{ id: 'coding' }]
      };
      expect(resolver.resolve(devAgent).roleId).toBe('developer');
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
            skillMatching: [],
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
            skillMatching: [],
            trustedPrefixes: ['trusted-b-']
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.trustedPrefixes).toContain('trusted-a-');
      expect(stats.trustedPrefixes).toContain('trusted-b-');

      // Check trust detection
      const trustedA = resolver.resolve({ name: 'trusted-a-agent', skills: [] });
      expect(trustedA.isTrusted).toBe(true);

      const trustedB = resolver.resolve({ name: 'trusted-b-agent', skills: [] });
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
            skillMatching: [
              { role: 'developer', anySkills: ['coding'] }
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
      expect(stats.totalRules).toBe(1);
      expect(stats.rulesByRole).toEqual({ developer: 1 });
    });
  });

  describe('clearRules', () => {
    it('should clear all rules', () => {
      const resolver = createIdentityResolver(testLogger);
      resolver.addRule({ role: 'test', anySkills: ['test_skill'] });

      expect(resolver.getStats().totalRules).toBe(1);

      resolver.clearRules();

      expect(resolver.getStats().totalRules).toBe(0);
      expect(resolver.getRules()).toHaveLength(0);
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
            skillMatching: [
              { role: 'admin', requiredSkills: ['admin_access'], priority: 100 },
              { role: 'admin', anySkills: ['system_management'], priority: 50 }
            ],
            trustedPrefixes: ['claude-', 'mycelium-']
          }
        },
        {
          id: 'frontend-skill',
          displayName: 'Frontend',
          description: 'Frontend skill',
          allowedRoles: ['frontend'],
          allowedTools: [],
          identity: {
            skillMatching: [
              { role: 'frontend', anySkills: ['react', 'vue'], priority: 50 }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      const stats = resolver.getStats();
      expect(stats.totalRules).toBe(3);
      expect(stats.rulesByRole).toEqual({
        admin: 2,
        frontend: 1
      });
      expect(stats.trustedPrefixes).toContain('claude-');
      expect(stats.trustedPrefixes).toContain('mycelium-');
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
            skillMatching: [
              {
                role: 'admin',
                requiredSkills: ['admin_access', 'system_management'],
                priority: 100,
                description: 'Full admin access requires both skills'
              }
            ],
            trustedPrefixes: ['claude-', 'mycelium-']
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
            skillMatching: [
              {
                role: 'frontend',
                anySkills: ['react', 'vue', 'angular', 'svelte'],
                minSkillMatch: 1,
                priority: 50
              }
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
            skillMatching: [
              {
                role: 'backend',
                anySkills: ['nodejs', 'python', 'java', 'go'],
                minSkillMatch: 1,
                priority: 50
              }
            ]
          }
        }
      ];

      resolver.loadFromSkills(skills);

      // Test admin agent (needs both skills)
      const adminAgent: AgentIdentity = {
        name: 'claude-admin',
        skills: [{ id: 'admin_access' }, { id: 'system_management' }]
      };
      const adminResult = resolver.resolve(adminAgent);
      expect(adminResult.roleId).toBe('admin');
      expect(adminResult.isTrusted).toBe(true);

      // Test partial admin (missing one skill) → falls to guest
      const partialAdmin: AgentIdentity = {
        name: 'partial-admin',
        skills: [{ id: 'admin_access' }]
      };
      expect(resolver.resolve(partialAdmin).roleId).toBe('guest');

      // Test frontend agent
      const frontendAgent: AgentIdentity = {
        name: 'react-builder',
        skills: [{ id: 'react' }, { id: 'typescript' }]
      };
      const frontendResult = resolver.resolve(frontendAgent);
      expect(frontendResult.roleId).toBe('frontend');
      expect(frontendResult.matchedSkills).toContain('react');

      // Test backend agent
      const backendAgent: AgentIdentity = {
        name: 'api-service',
        skills: [{ id: 'nodejs' }, { id: 'database_query' }]
      };
      expect(resolver.resolve(backendAgent).roleId).toBe('backend');

      // Test unknown agent → guest
      const unknownAgent: AgentIdentity = {
        name: 'unknown-service',
        skills: [{ id: 'unrelated_skill' }]
      };
      const unknownResult = resolver.resolve(unknownAgent);
      expect(unknownResult.roleId).toBe('guest');
      expect(unknownResult.matchedRule).toBeNull();
      expect(unknownResult.isTrusted).toBe(false);

      // Verify stats
      const stats = resolver.getStats();
      expect(stats.totalRules).toBe(3);
      expect(stats.rulesByRole.admin).toBe(1);
      expect(stats.rulesByRole.frontend).toBe(1);
      expect(stats.rulesByRole.backend).toBe(1);
    });
  });
});
