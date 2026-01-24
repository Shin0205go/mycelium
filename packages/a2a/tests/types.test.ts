/**
 * Unit tests for @aegis/a2a types
 * Verifies type exports and interface structures
 */

import { describe, it, expect } from 'vitest';
import type {
  A2AAgentSkill,
  AgentIdentity,
  SkillMatchRule,
  SkillIdentityConfig,
  SkillDefinition,
  IdentityConfig,
  IdentityResolution,
  IdentityStats,
} from '../src/types.js';

describe('@mycelium/a2a types', () => {
  describe('A2AAgentSkill', () => {
    it('should accept minimal skill definition', () => {
      const skill: A2AAgentSkill = {
        id: 'react',
      };

      expect(skill.id).toBe('react');
    });

    it('should accept full skill definition', () => {
      const skill: A2AAgentSkill = {
        id: 'frontend-development',
        name: 'Frontend Development',
        description: 'Build user interfaces with React',
        inputModes: ['text', 'file'],
        outputModes: ['text', 'code'],
        examples: ['Create a button component', 'Build a form'],
        tags: ['frontend', 'react', 'ui'],
      };

      expect(skill.id).toBe('frontend-development');
      expect(skill.name).toBe('Frontend Development');
      expect(skill.inputModes).toContain('text');
      expect(skill.outputModes).toContain('code');
      expect(skill.examples).toHaveLength(2);
      expect(skill.tags).toContain('react');
    });
  });

  describe('AgentIdentity', () => {
    it('should accept minimal identity', () => {
      const identity: AgentIdentity = {
        name: 'test-agent',
      };

      expect(identity.name).toBe('test-agent');
    });

    it('should accept full identity with skills', () => {
      const identity: AgentIdentity = {
        name: 'react-builder',
        version: '1.0.0',
        skills: [
          { id: 'react' },
          { id: 'typescript', name: 'TypeScript' },
        ],
        metadata: {
          organization: 'test-org',
          environment: 'production',
        },
      };

      expect(identity.name).toBe('react-builder');
      expect(identity.version).toBe('1.0.0');
      expect(identity.skills).toHaveLength(2);
      expect(identity.skills?.[0].id).toBe('react');
      expect(identity.metadata?.organization).toBe('test-org');
    });
  });

  describe('SkillMatchRule', () => {
    it('should accept rule with requiredSkills', () => {
      const rule: SkillMatchRule = {
        role: 'admin',
        requiredSkills: ['admin_access', 'system_management'],
      };

      expect(rule.role).toBe('admin');
      expect(rule.requiredSkills).toContain('admin_access');
    });

    it('should accept rule with anySkills', () => {
      const rule: SkillMatchRule = {
        role: 'frontend',
        anySkills: ['react', 'vue', 'angular', 'svelte'],
        minSkillMatch: 1,
      };

      expect(rule.role).toBe('frontend');
      expect(rule.anySkills).toHaveLength(4);
      expect(rule.minSkillMatch).toBe(1);
    });

    it('should accept full rule with all options', () => {
      const rule: SkillMatchRule = {
        role: 'senior-dev',
        requiredSkills: ['coding', 'review'],
        anySkills: ['react', 'node', 'python'],
        minSkillMatch: 2,
        description: 'Senior developer with full-stack skills',
        priority: 100,
      };

      expect(rule.role).toBe('senior-dev');
      expect(rule.priority).toBe(100);
      expect(rule.description).toContain('Senior');
    });
  });

  describe('SkillIdentityConfig', () => {
    it('should accept empty config', () => {
      const config: SkillIdentityConfig = {};

      expect(config.skillMatching).toBeUndefined();
      expect(config.trustedPrefixes).toBeUndefined();
    });

    it('should accept config with skill matching rules', () => {
      const config: SkillIdentityConfig = {
        skillMatching: [
          { role: 'admin', requiredSkills: ['admin'] },
          { role: 'user', anySkills: ['basic'] },
        ],
        trustedPrefixes: ['claude-', 'aegis-'],
      };

      expect(config.skillMatching).toHaveLength(2);
      expect(config.trustedPrefixes).toContain('claude-');
    });
  });

  describe('SkillDefinition', () => {
    it('should accept minimal skill definition', () => {
      const skill: SkillDefinition = {
        id: 'basic',
        displayName: 'Basic Skill',
        description: 'A basic skill',
        allowedRoles: ['user'],
        allowedTools: [],
      };

      expect(skill.id).toBe('basic');
      expect(skill.displayName).toBe('Basic Skill');
    });

    it('should accept full skill definition with identity', () => {
      const skill: SkillDefinition = {
        id: 'admin-access',
        displayName: 'Admin Access',
        description: 'Full administrative access',
        allowedRoles: ['admin'],
        allowedTools: ['*'],
        grants: {
          memory: 'all',
        },
        identity: {
          skillMatching: [
            {
              role: 'admin',
              requiredSkills: ['admin_access', 'system_management'],
              priority: 100,
            },
          ],
          trustedPrefixes: ['claude-', 'aegis-'],
        },
        metadata: {
          version: '1.0.0',
          category: 'admin',
          author: 'system',
          tags: ['admin', 'access-control'],
        },
      };

      expect(skill.id).toBe('admin-access');
      expect(skill.grants?.memory).toBe('all');
      expect(skill.identity?.skillMatching).toHaveLength(1);
      expect(skill.metadata?.category).toBe('admin');
    });
  });

  describe('IdentityConfig', () => {
    it('should accept minimal config', () => {
      const config: IdentityConfig = {
        version: '1.0.0',
        defaultRole: 'guest',
        skillRules: [],
      };

      expect(config.version).toBe('1.0.0');
      expect(config.defaultRole).toBe('guest');
      expect(config.skillRules).toEqual([]);
    });

    it('should accept full config with rules', () => {
      const config: IdentityConfig = {
        version: '2.0.0',
        defaultRole: 'guest',
        skillRules: [
          { role: 'admin', requiredSkills: ['admin'], priority: 100 },
          { role: 'developer', anySkills: ['coding'], priority: 50 },
        ],
        rejectUnknown: true,
        trustedPrefixes: ['internal-'],
      };

      expect(config.skillRules).toHaveLength(2);
      expect(config.rejectUnknown).toBe(true);
      expect(config.trustedPrefixes).toContain('internal-');
    });
  });

  describe('IdentityResolution', () => {
    it('should represent successful resolution', () => {
      const resolution: IdentityResolution = {
        roleId: 'frontend',
        agentName: 'react-builder',
        matchedRule: {
          role: 'frontend',
          anySkills: ['react'],
        },
        matchedSkills: ['react', 'typescript'],
        isTrusted: true,
        resolvedAt: new Date(),
      };

      expect(resolution.roleId).toBe('frontend');
      expect(resolution.agentName).toBe('react-builder');
      expect(resolution.matchedRule?.role).toBe('frontend');
      expect(resolution.matchedSkills).toContain('react');
      expect(resolution.isTrusted).toBe(true);
      expect(resolution.resolvedAt).toBeInstanceOf(Date);
    });

    it('should represent default resolution without matched rule', () => {
      const resolution: IdentityResolution = {
        roleId: 'guest',
        agentName: 'unknown-agent',
        matchedRule: null,
        matchedSkills: [],
        isTrusted: false,
        resolvedAt: new Date(),
      };

      expect(resolution.roleId).toBe('guest');
      expect(resolution.matchedRule).toBeNull();
      expect(resolution.matchedSkills).toEqual([]);
      expect(resolution.isTrusted).toBe(false);
    });
  });

  describe('IdentityStats', () => {
    it('should represent empty stats', () => {
      const stats: IdentityStats = {
        totalRules: 0,
        rulesByRole: {},
        trustedPrefixes: [],
      };

      expect(stats.totalRules).toBe(0);
      expect(Object.keys(stats.rulesByRole)).toHaveLength(0);
    });

    it('should represent populated stats', () => {
      const stats: IdentityStats = {
        totalRules: 5,
        rulesByRole: {
          admin: 1,
          frontend: 2,
          backend: 2,
        },
        trustedPrefixes: ['claude-', 'aegis-', 'internal-'],
      };

      expect(stats.totalRules).toBe(5);
      expect(stats.rulesByRole.admin).toBe(1);
      expect(stats.rulesByRole.frontend).toBe(2);
      expect(stats.trustedPrefixes).toHaveLength(3);
    });
  });

  describe('Type compatibility', () => {
    it('A2AAgentSkill should be usable in AgentIdentity.skills', () => {
      const skill: A2AAgentSkill = {
        id: 'test',
        name: 'Test Skill',
      };

      const identity: AgentIdentity = {
        name: 'agent',
        skills: [skill],
      };

      expect(identity.skills?.[0]).toBe(skill);
    });

    it('SkillMatchRule should be usable in IdentityConfig.skillRules', () => {
      const rule: SkillMatchRule = {
        role: 'admin',
        requiredSkills: ['admin'],
      };

      const config: IdentityConfig = {
        version: '1.0.0',
        defaultRole: 'guest',
        skillRules: [rule],
      };

      expect(config.skillRules[0]).toBe(rule);
    });

    it('SkillIdentityConfig should be usable in SkillDefinition.identity', () => {
      const identityConfig: SkillIdentityConfig = {
        skillMatching: [{ role: 'test', anySkills: ['skill1'] }],
      };

      const skill: SkillDefinition = {
        id: 'test',
        displayName: 'Test',
        description: 'Test skill',
        allowedRoles: ['*'],
        allowedTools: [],
        identity: identityConfig,
      };

      expect(skill.identity).toBe(identityConfig);
    });
  });
});
