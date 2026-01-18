// ============================================================================
// Mycelium A2A - Identity Resolver
// A2A Zero-Trust identity resolution based on Agent Card skills
// ============================================================================

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { Logger } from '@mycelium/shared';
import type {
  IdentityConfig,
  IdentityResolution,
  AgentIdentity,
  SkillDefinition,
  SkillMatchRule,
  A2AAgentSkill,
  IdentityStats
} from './types.js';

/**
 * Default identity configuration when no config is provided
 */
const DEFAULT_IDENTITY_CONFIG: IdentityConfig = {
  version: '1.0.0',
  defaultRole: 'guest',
  skillRules: [],
  rejectUnknown: false,
  trustedPrefixes: ['claude-', 'mycelium-']
};

/**
 * Identity Resolver
 * Resolves agent identity to role based on A2A Agent Card skills (Zero-Trust)
 *
 * Design:
 * - Agents declare their capabilities via A2A Agent Card skills
 * - Router matches skills against rules to determine role
 * - No name pattern matching - purely capability-based
 * - Rules checked in priority order, first match wins
 */
export class IdentityResolver {
  private logger: Logger;
  private config: IdentityConfig;
  private sortedRules: SkillMatchRule[];

  constructor(logger: Logger, config?: IdentityConfig) {
    this.logger = logger;
    // Deep copy the config to avoid mutating the default
    const baseConfig = config || DEFAULT_IDENTITY_CONFIG;
    this.config = {
      ...baseConfig,
      skillRules: [...(baseConfig.skillRules || [])],
      trustedPrefixes: [...(baseConfig.trustedPrefixes || [])]
    };
    this.sortedRules = this.sortRulesByPriority(this.config.skillRules);
    this.logger.debug('IdentityResolver initialized (A2A skill-based)', {
      ruleCount: this.sortedRules.length,
      defaultRole: this.config.defaultRole
    });
  }

  /**
   * Load configuration from YAML file
   */
  async loadFromFile(configPath: string): Promise<void> {
    if (!existsSync(configPath)) {
      this.logger.warn(`Identity config not found at ${configPath}, using defaults`);
      return;
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      // Dynamic import for yaml to avoid bundling issues
      const { parse: parseYaml } = await import('yaml');
      const parsed = parseYaml(content) as IdentityConfig;

      // Validate required fields
      if (!parsed.version || !parsed.defaultRole) {
        throw new Error('Invalid identity config: missing version or defaultRole');
      }

      this.config = {
        ...DEFAULT_IDENTITY_CONFIG,
        ...parsed,
        skillRules: parsed.skillRules || []
      };
      this.sortedRules = this.sortRulesByPriority(this.config.skillRules);

      this.logger.info(`Loaded identity config from ${configPath}`, {
        version: this.config.version,
        ruleCount: this.sortedRules.length,
        defaultRole: this.config.defaultRole,
        rejectUnknown: this.config.rejectUnknown
      });
    } catch (error) {
      this.logger.error(`Failed to load identity config: ${error}`);
      throw error;
    }
  }

  /**
   * Sort rules by priority (higher first)
   */
  private sortRulesByPriority(rules: SkillMatchRule[]): SkillMatchRule[] {
    return [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Resolve agent identity to role based on Agent Card skills
   *
   * @param identity Agent identity from MCP connection (includes skills)
   * @returns Resolution result with role and matched skills
   * @throws Error if rejectUnknown is true and no rule matches
   */
  resolve(identity: AgentIdentity): IdentityResolution {
    const agentName = identity.name && identity.name.trim() ? identity.name : 'unknown';
    const agentSkills = this.extractSkillIds(identity.skills || []);

    // Check each rule in priority order
    for (const rule of this.sortedRules) {
      const matchResult = this.matchRule(agentSkills, rule);
      if (matchResult.matched) {
        const resolution: IdentityResolution = {
          roleId: rule.role,
          agentName,
          matchedRule: rule,
          matchedSkills: matchResult.matchedSkills,
          isTrusted: this.isTrustedAgent(agentName),
          resolvedAt: new Date()
        };

        this.logger.info(`Identity resolved: ${agentName} → ${rule.role}`, {
          matchedSkills: matchResult.matchedSkills,
          description: rule.description,
          isTrusted: resolution.isTrusted
        });

        return resolution;
      }
    }

    // No rule matched
    if (this.config.rejectUnknown) {
      this.logger.warn(`Unknown agent rejected: ${agentName}`, {
        declaredSkills: agentSkills
      });
      throw new Error(`Unknown agent: ${agentName}. No skill matching rule matched.`);
    }

    // Use default role
    const resolution: IdentityResolution = {
      roleId: this.config.defaultRole,
      agentName,
      matchedRule: null,
      matchedSkills: [],
      isTrusted: this.isTrustedAgent(agentName),
      resolvedAt: new Date()
    };

    this.logger.info(`Identity resolved to default: ${agentName} → ${this.config.defaultRole}`, {
      declaredSkills: agentSkills,
      isTrusted: resolution.isTrusted
    });

    return resolution;
  }

  /**
   * Extract skill IDs from A2A Agent Card skills
   */
  private extractSkillIds(skills: A2AAgentSkill[]): string[] {
    return skills.map(s => s.id);
  }

  /**
   * Match agent skills against a rule
   */
  private matchRule(
    agentSkills: string[],
    rule: SkillMatchRule
  ): { matched: boolean; matchedSkills: string[]; rejectionReason?: string } {
    const matchedSkills: string[] = [];

    // Check forbiddenSkills FIRST (immediate rejection)
    if (rule.forbiddenSkills && rule.forbiddenSkills.length > 0) {
      for (const forbidden of rule.forbiddenSkills) {
        if (agentSkills.includes(forbidden)) {
          return {
            matched: false,
            matchedSkills: [],
            rejectionReason: `Forbidden skill detected: ${forbidden}`
          };
        }
      }
    }

    // Check context conditions (time-based access control)
    if (rule.context) {
      const contextCheck = this.checkContext(rule.context);
      if (!contextCheck.allowed) {
        return {
          matched: false,
          matchedSkills: [],
          rejectionReason: contextCheck.reason
        };
      }
    }

    // Check requiredSkills (ALL must be present)
    if (rule.requiredSkills && rule.requiredSkills.length > 0) {
      for (const required of rule.requiredSkills) {
        if (!agentSkills.includes(required)) {
          return { matched: false, matchedSkills: [] };
        }
        matchedSkills.push(required);
      }
    }

    // Check anySkills (at least minSkillMatch must be present)
    if (rule.anySkills && rule.anySkills.length > 0) {
      const minMatch = rule.minSkillMatch ?? 1;
      let anyMatched = 0;

      for (const any of rule.anySkills) {
        if (agentSkills.includes(any)) {
          anyMatched++;
          matchedSkills.push(any);
        }
      }

      if (anyMatched < minMatch) {
        return { matched: false, matchedSkills: [] };
      }
    }

    // If no requiredSkills and no anySkills, rule never matches
    if ((!rule.requiredSkills || rule.requiredSkills.length === 0) &&
        (!rule.anySkills || rule.anySkills.length === 0)) {
      return { matched: false, matchedSkills: [] };
    }

    return { matched: true, matchedSkills };
  }

  /**
   * Check context conditions (time-based access control)
   */
  private checkContext(context: import('./types.js').RuleContext): { allowed: boolean; reason?: string } {
    // Get current time in specified timezone (or system default)
    const now = this.getCurrentTimeInTimezone(context.timezone);

    // Check allowed days
    if (context.allowedDays && context.allowedDays.length > 0) {
      const currentDay = now.day;
      if (!context.allowedDays.includes(currentDay)) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const tzInfo = context.timezone ? ` (${context.timezone})` : '';
        return {
          allowed: false,
          reason: `Access denied: ${dayNames[currentDay]}${tzInfo} is not in allowed days`
        };
      }
    }

    // Check allowed time range
    if (context.allowedTime) {
      const timeCheck = this.checkTimeRangeWithTimezone(context.allowedTime, now, context.timezone);
      if (!timeCheck.allowed) {
        return timeCheck;
      }
    }

    return { allowed: true };
  }

  /**
   * Get current time components in specified timezone
   */
  private getCurrentTimeInTimezone(timezone?: string): { day: number; hours: number; minutes: number } {
    const now = new Date();

    if (!timezone) {
      return {
        day: now.getDay(),
        hours: now.getHours(),
        minutes: now.getMinutes()
      };
    }

    try {
      // Use Intl.DateTimeFormat to get time in specified timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
      });

      const parts = formatter.formatToParts(now);
      const dayMap: Record<string, number> = {
        'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
      };

      let day = now.getDay();
      let hours = now.getHours();
      let minutes = now.getMinutes();

      for (const part of parts) {
        if (part.type === 'weekday') {
          day = dayMap[part.value] ?? now.getDay();
        } else if (part.type === 'hour') {
          hours = parseInt(part.value, 10);
        } else if (part.type === 'minute') {
          minutes = parseInt(part.value, 10);
        }
      }

      return { day, hours, minutes };
    } catch (error) {
      if (this.config.strictValidation) {
        throw new Error(`Invalid timezone: ${timezone}`);
      }
      this.logger.warn(`Invalid timezone: ${timezone}, using system default`);
      return {
        day: now.getDay(),
        hours: now.getHours(),
        minutes: now.getMinutes()
      };
    }
  }

  /**
   * Check if current time is within allowed range (with timezone support)
   */
  private checkTimeRangeWithTimezone(
    timeRange: string,
    time: { hours: number; minutes: number },
    timezone?: string
  ): { allowed: boolean; reason?: string } {
    const match = timeRange.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) {
      if (this.config.strictValidation) {
        throw new Error(`Invalid time range format: ${timeRange}. Expected HH:MM-HH:MM`);
      }
      this.logger.warn(`Invalid time range format: ${timeRange}`);
      return { allowed: true }; // Invalid format, allow by default
    }

    const [, startHour, startMin, endHour, endMin] = match;
    const startMinutes = parseInt(startHour) * 60 + parseInt(startMin);
    const endMinutes = parseInt(endHour) * 60 + parseInt(endMin);
    const currentMinutes = time.hours * 60 + time.minutes;

    // Handle overnight ranges (e.g., "22:00-06:00")
    let inRange: boolean;
    if (startMinutes <= endMinutes) {
      // Normal range (e.g., "09:00-18:00")
      inRange = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Overnight range (e.g., "22:00-06:00")
      inRange = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }

    if (!inRange) {
      const currentTime = `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`;
      const tzInfo = timezone ? ` (${timezone})` : '';
      return {
        allowed: false,
        reason: `Access denied: Current time ${currentTime}${tzInfo} is outside allowed range ${timeRange}`
      };
    }

    return { allowed: true };
  }

  /**
   * Check if agent is trusted based on name prefix
   * (Trust level is separate from role assignment)
   */
  private isTrustedAgent(agentName: string): boolean {
    const prefixes = this.config.trustedPrefixes || [];
    const lowerName = agentName.toLowerCase();
    return prefixes.some(prefix => lowerName.startsWith(prefix.toLowerCase()));
  }

  /**
   * Get the current configuration
   */
  getConfig(): IdentityConfig {
    return { ...this.config };
  }

  /**
   * Get all configured rules
   */
  getRules(): SkillMatchRule[] {
    return [...this.sortedRules];
  }

  /**
   * Check if a role exists in any rule
   */
  hasRoleRule(roleId: string): boolean {
    return this.sortedRules.some(r => r.role === roleId) ||
           this.config.defaultRole === roleId;
  }

  /**
   * Add a rule dynamically
   */
  addRule(rule: SkillMatchRule): void {
    this.config.skillRules.push(rule);
    this.sortedRules = this.sortRulesByPriority(this.config.skillRules);
    this.logger.debug(`Added skill match rule for role: ${rule.role}`, {
      requiredSkills: rule.requiredSkills,
      anySkills: rule.anySkills
    });
  }

  /**
   * Set the default role
   */
  setDefaultRole(roleId: string): void {
    this.config.defaultRole = roleId;
    this.logger.debug(`Default role set to: ${roleId}`);
  }

  /**
   * Set whether to reject unknown agents
   */
  setRejectUnknown(reject: boolean): void {
    this.config.rejectUnknown = reject;
    this.logger.debug(`Reject unknown agents: ${reject}`);
  }

  // ============================================================================
  // Skill-Based Identity Loading from Mycelium Skills
  // ============================================================================

  /**
   * Load skill matching rules from skill definitions
   * Aggregates rules from all skills that define A2A identity config
   *
   * @param skills Array of skill definitions
   */
  loadFromSkills(skills: SkillDefinition[]): void {
    const addedRules: SkillMatchRule[] = [];
    const addedPrefixes: Set<string> = new Set(this.config.trustedPrefixes || []);

    for (const skill of skills) {
      // Skip skills without identity config
      if (!skill.identity?.skillMatching) {
        continue;
      }

      // Add rules from this skill
      for (const rule of skill.identity.skillMatching) {
        const enrichedRule: SkillMatchRule = {
          ...rule,
          description: rule.description || `From skill: ${skill.id}`
        };

        // Check for duplicate rules (same role and same skills)
        const isDuplicate = this.config.skillRules.some(
          r => r.role === enrichedRule.role &&
               JSON.stringify(r.requiredSkills) === JSON.stringify(enrichedRule.requiredSkills) &&
               JSON.stringify(r.anySkills) === JSON.stringify(enrichedRule.anySkills)
        );

        if (!isDuplicate) {
          this.config.skillRules.push(enrichedRule);
          addedRules.push(enrichedRule);
        }
      }

      // Add trusted prefixes from this skill
      if (skill.identity.trustedPrefixes) {
        for (const prefix of skill.identity.trustedPrefixes) {
          addedPrefixes.add(prefix);
        }
      }
    }

    // Update trusted prefixes
    this.config.trustedPrefixes = Array.from(addedPrefixes);

    // Re-sort rules by priority
    this.sortedRules = this.sortRulesByPriority(this.config.skillRules);

    if (addedRules.length > 0) {
      this.logger.info(`Loaded ${addedRules.length} skill matching rules from skills`, {
        rules: addedRules.map(r => ({
          role: r.role,
          requiredSkills: r.requiredSkills,
          anySkills: r.anySkills
        })),
        totalRules: this.sortedRules.length,
        trustedPrefixes: this.config.trustedPrefixes
      });
    }
  }

  /**
   * Clear all rules (useful for reloading)
   */
  clearRules(): void {
    this.config.skillRules = [];
    this.sortedRules = [];
    this.logger.debug('Cleared all skill matching rules');
  }

  /**
   * Get statistics about loaded rules
   */
  getStats(): IdentityStats {
    const rulesByRole: Record<string, number> = {};
    for (const rule of this.sortedRules) {
      rulesByRole[rule.role] = (rulesByRole[rule.role] || 0) + 1;
    }

    return {
      totalRules: this.sortedRules.length,
      rulesByRole,
      trustedPrefixes: this.config.trustedPrefixes || []
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an IdentityResolver instance
 */
export function createIdentityResolver(
  logger: Logger,
  config?: IdentityConfig
): IdentityResolver {
  return new IdentityResolver(logger, config);
}
