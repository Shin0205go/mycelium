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
  AgentIdentity
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
