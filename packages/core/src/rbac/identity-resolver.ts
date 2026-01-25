// ============================================================================
// MYCELIUM - IdentityResolver Stub
// Minimal implementation for skill-based worker pattern
// ============================================================================

import type { Logger, BaseSkillDefinition } from '@mycelium/shared';

/**
 * Extended skill definition with identity configuration
 */
export interface SkillDefinition extends BaseSkillDefinition {
  identity?: {
    skillMatching?: string[];
    trustedPrefixes?: string[];
  };
}

export interface AgentIdentity {
  name: string;
  parentAgent?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface IdentityResolution {
  roleId: string;
  matchedSkills: string[];
  matchedRule?: { description: string };
  isTrusted: boolean;
}

export interface IdentityConfig {
  defaultRole: string;
  rules?: Array<{
    pattern: string;
    roleId: string;
    description?: string;
  }>;
}

export interface IdentityRule {
  pattern: string;
  roleId: string;
  description?: string;
  priority: number;
}

/**
 * IdentityResolver - Resolves agent identity to roles
 */
export class IdentityResolver {
  private logger: Logger;
  private rules: IdentityRule[] = [];
  private defaultRole: string = 'guest';

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async loadFromFile(configPath: string): Promise<void> {
    // Stub: In production, this would load from file
    this.logger.debug(`Would load identity config from ${configPath}`);
  }

  loadFromSkills(skills: SkillDefinition[]): void {
    for (const skill of skills) {
      if (skill.identity?.skillMatching) {
        for (const pattern of skill.identity.skillMatching) {
          this.rules.push({
            pattern,
            roleId: skill.allowedRoles[0] || this.defaultRole,
            description: `From skill: ${skill.id}`,
            priority: 1,
          });
        }
      }
    }
  }

  clearRules(): void {
    this.rules = [];
  }

  resolve(identity: AgentIdentity): IdentityResolution {
    const matchedSkills: string[] = [];
    let matchedRule: IdentityRule | undefined;

    // Try to match against rules
    for (const rule of this.rules) {
      if (this.matchPattern(identity.name, rule.pattern)) {
        matchedRule = rule;
        break;
      }
    }

    return {
      roleId: matchedRule?.roleId || this.defaultRole,
      matchedSkills,
      matchedRule: matchedRule ? { description: matchedRule.description || '' } : undefined,
      isTrusted: !!matchedRule,
    };
  }

  private matchPattern(name: string, pattern: string): boolean {
    // Simple glob-like matching
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(name);
  }

  getStats(): { totalRules: number; rulesByRole: Record<string, number> } {
    const rulesByRole: Record<string, number> = {};
    for (const rule of this.rules) {
      rulesByRole[rule.roleId] = (rulesByRole[rule.roleId] || 0) + 1;
    }
    return {
      totalRules: this.rules.length,
      rulesByRole,
    };
  }
}

export function createIdentityResolver(logger: Logger): IdentityResolver {
  return new IdentityResolver(logger);
}
