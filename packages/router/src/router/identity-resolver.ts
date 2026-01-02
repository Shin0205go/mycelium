// ============================================================================
// AEGIS Router - Identity Resolver
// A2A Zero-Trust identity resolution for agent-to-agent communication
// ============================================================================

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { Logger } from '../utils/logger.js';
import type {
  IdentityConfig,
  IdentityPattern,
  IdentityResolution,
  AgentIdentity,
  SkillDefinition,
  SkillIdentityMapping
} from '../types/router-types.js';

/**
 * Default identity configuration when no config file is found
 */
const DEFAULT_IDENTITY_CONFIG: IdentityConfig = {
  version: '1.0.0',
  defaultRole: 'default',
  patterns: [],
  rejectUnknown: false,
  trustedPrefixes: ['claude-', 'aegis-']
};

/**
 * Identity Resolver
 * Resolves agent identity to role based on pattern matching (A2A Zero-Trust)
 *
 * Design:
 * - All clients are treated as agents
 * - Agent identity (clientInfo.name) determines role at connection time
 * - No runtime role switching (set_role removed)
 * - Patterns checked in priority order, first match wins
 */
export class IdentityResolver {
  private logger: Logger;
  private config: IdentityConfig;
  private sortedPatterns: IdentityPattern[];
  private configPath: string | null = null;

  constructor(logger: Logger, config?: IdentityConfig) {
    this.logger = logger;
    // Deep copy the config to avoid mutating the default
    const baseConfig = config || DEFAULT_IDENTITY_CONFIG;
    this.config = {
      ...baseConfig,
      patterns: [...(baseConfig.patterns || [])],
      trustedPrefixes: [...(baseConfig.trustedPrefixes || [])]
    };
    this.sortedPatterns = this.sortPatternsByPriority(this.config.patterns);
    this.logger.debug('IdentityResolver initialized', {
      patternCount: this.sortedPatterns.length,
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
      const parsed = parseYaml(content) as IdentityConfig;

      // Validate required fields
      if (!parsed.version || !parsed.defaultRole) {
        throw new Error('Invalid identity config: missing version or defaultRole');
      }

      this.config = {
        ...DEFAULT_IDENTITY_CONFIG,
        ...parsed
      };
      this.sortedPatterns = this.sortPatternsByPriority(this.config.patterns || []);
      this.configPath = configPath;

      this.logger.info(`Loaded identity config from ${configPath}`, {
        version: this.config.version,
        patternCount: this.sortedPatterns.length,
        defaultRole: this.config.defaultRole,
        rejectUnknown: this.config.rejectUnknown
      });
    } catch (error) {
      this.logger.error(`Failed to load identity config: ${error}`);
      throw error;
    }
  }

  /**
   * Sort patterns by priority (higher first)
   */
  private sortPatternsByPriority(patterns: IdentityPattern[]): IdentityPattern[] {
    return [...patterns].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Resolve agent identity to role
   *
   * @param identity Agent identity from MCP connection
   * @returns Resolution result with role and metadata
   * @throws Error if rejectUnknown is true and no pattern matches
   */
  resolve(identity: AgentIdentity): IdentityResolution {
    // Treat empty string as 'unknown' for safety
    const agentName = identity.name && identity.name.trim() ? identity.name : 'unknown';

    // Check each pattern in priority order
    for (const pattern of this.sortedPatterns) {
      if (this.matchPattern(agentName, pattern.pattern)) {
        const resolution: IdentityResolution = {
          roleId: pattern.role,
          agentName,
          matchedPattern: pattern.pattern,
          isTrusted: this.isTrustedAgent(agentName),
          resolvedAt: new Date()
        };

        this.logger.info(`Identity resolved: ${agentName} → ${pattern.role}`, {
          pattern: pattern.pattern,
          description: pattern.description,
          isTrusted: resolution.isTrusted
        });

        return resolution;
      }
    }

    // No pattern matched
    if (this.config.rejectUnknown) {
      this.logger.warn(`Unknown agent rejected: ${agentName}`);
      throw new Error(`Unknown agent: ${agentName}. No identity pattern matched.`);
    }

    // Use default role
    const resolution: IdentityResolution = {
      roleId: this.config.defaultRole,
      agentName,
      matchedPattern: null,
      isTrusted: this.isTrustedAgent(agentName),
      resolvedAt: new Date()
    };

    this.logger.info(`Identity resolved to default: ${agentName} → ${this.config.defaultRole}`, {
      isTrusted: resolution.isTrusted
    });

    return resolution;
  }

  /**
   * Match agent name against glob-style pattern
   * Supports: * (any), ? (single char), [abc] (char class)
   */
  private matchPattern(name: string, pattern: string): boolean {
    // Exact match
    if (name === pattern) return true;

    // Convert glob to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars (except * and ?)
      .replace(/\*/g, '.*')                   // * → .*
      .replace(/\?/g, '.');                   // ? → .

    try {
      const regex = new RegExp(`^${regexPattern}$`, 'i');
      return regex.test(name);
    } catch {
      this.logger.warn(`Invalid pattern: ${pattern}`);
      return false;
    }
  }

  /**
   * Check if agent is trusted based on prefix
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
   * Get all configured patterns
   */
  getPatterns(): IdentityPattern[] {
    return [...this.sortedPatterns];
  }

  /**
   * Check if a role exists in any pattern
   */
  hasRolePattern(roleId: string): boolean {
    return this.sortedPatterns.some(p => p.role === roleId) ||
           this.config.defaultRole === roleId;
  }

  /**
   * Add a pattern dynamically (for testing or runtime configuration)
   */
  addPattern(pattern: IdentityPattern): void {
    this.config.patterns.push(pattern);
    this.sortedPatterns = this.sortPatternsByPriority(this.config.patterns);
    this.logger.debug(`Added identity pattern: ${pattern.pattern} → ${pattern.role}`);
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
  // Skill-Based Identity Loading
  // ============================================================================

  /**
   * Load identity patterns from skill definitions
   * Aggregates patterns from all skills that define identity mappings
   *
   * @param skills Array of skill definitions
   */
  loadFromSkills(skills: SkillDefinition[]): void {
    const addedPatterns: IdentityPattern[] = [];
    const addedPrefixes: Set<string> = new Set(this.config.trustedPrefixes || []);

    for (const skill of skills) {
      // Skip skills without identity config
      if (!skill.identity) {
        continue;
      }

      // Add patterns from this skill (if any)
      if (skill.identity.mappings && skill.identity.mappings.length > 0) {
        for (const mapping of skill.identity.mappings) {
          const pattern: IdentityPattern = {
            pattern: mapping.pattern,
            role: mapping.role,
            description: mapping.description || `From skill: ${skill.id}`,
            priority: mapping.priority ?? 0
          };

          // Check for duplicate patterns
          const isDuplicate = this.config.patterns.some(
            p => p.pattern === pattern.pattern && p.role === pattern.role
          );

          if (!isDuplicate) {
            this.config.patterns.push(pattern);
            addedPatterns.push(pattern);
          }
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

    // Re-sort patterns by priority
    this.sortedPatterns = this.sortPatternsByPriority(this.config.patterns);

    if (addedPatterns.length > 0) {
      this.logger.info(`Loaded ${addedPatterns.length} identity patterns from skills`, {
        patterns: addedPatterns.map(p => `${p.pattern} → ${p.role}`),
        totalPatterns: this.sortedPatterns.length,
        trustedPrefixes: this.config.trustedPrefixes
      });
    }
  }

  /**
   * Clear all patterns (useful for reloading)
   */
  clearPatterns(): void {
    this.config.patterns = [];
    this.sortedPatterns = [];
    this.logger.debug('Cleared all identity patterns');
  }

  /**
   * Get statistics about loaded patterns
   */
  getStats(): {
    totalPatterns: number;
    patternsByRole: Record<string, number>;
    trustedPrefixes: string[];
    defaultRole: string;
  } {
    const patternsByRole: Record<string, number> = {};
    for (const pattern of this.sortedPatterns) {
      patternsByRole[pattern.role] = (patternsByRole[pattern.role] || 0) + 1;
    }

    return {
      totalPatterns: this.sortedPatterns.length,
      patternsByRole,
      trustedPrefixes: this.config.trustedPrefixes || [],
      defaultRole: this.config.defaultRole
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
