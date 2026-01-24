// ============================================================================
// AEGIS A2A Types
// Agent-to-Agent Zero-Trust Identity Resolution
// ============================================================================

import type { SkillGrants, SkillMetadata } from '@mycelium/shared';

// ============================================================================
// A2A Agent Card Types (Google A2A Protocol)
// ============================================================================

/**
 * A2A Agent Skill (from Agent Card)
 * Represents a capability that an agent declares it can perform
 */
export interface A2AAgentSkill {
  /** Unique skill identifier */
  id: string;

  /** Human-readable skill name */
  name?: string;

  /** Skill description */
  description?: string;

  /** Input modes supported (e.g., "text", "file") */
  inputModes?: string[];

  /** Output modes supported */
  outputModes?: string[];

  /** Example prompts for this skill */
  examples?: string[];

  /** Tags for categorization */
  tags?: string[];
}

/**
 * Agent identity information from MCP connection
 * Extended with A2A Agent Card skills
 */
export interface AgentIdentity {
  /** Agent name from clientInfo.name */
  name: string;

  /** Agent version from clientInfo.version */
  version?: string;

  /** A2A Agent Card skills - capabilities the agent declares */
  skills?: A2AAgentSkill[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Skill-Based Matching Rules
// ============================================================================

/**
 * Context conditions for time-based access control
 */
export interface RuleContext {
  /** Allowed time range in 24h format (e.g., "09:00-18:00") */
  allowedTime?: string;

  /** Allowed days of week (0=Sunday, 1=Monday, ..., 6=Saturday) */
  allowedDays?: number[];

  /** Timezone for time checks (default: system timezone) */
  timezone?: string;
}

/**
 * A2A Skill-based role matching rule
 * Matches agents based on their declared skills in Agent Card
 */
export interface SkillMatchRule {
  /** Role to assign when skills match */
  role: string;

  /** ALL of these skills must be present (AND logic) */
  requiredSkills?: string[];

  /** ANY of these skills is sufficient (OR logic) */
  anySkills?: string[];

  /** Minimum number of anySkills that must match (default: 1) */
  minSkillMatch?: number;

  /** Skills that MUST NOT be present (immediate rejection) */
  forbiddenSkills?: string[];

  /** Context conditions (time-based access control) */
  context?: RuleContext;

  /** Optional description for this rule */
  description?: string;

  /** Priority (higher = checked first, default: 0) */
  priority?: number;
}

/**
 * A2A identity configuration within skills
 * Skills define capability-based role matching rules
 */
export interface SkillIdentityConfig {
  /** Skill-based matching rules (replaces pattern matching) */
  skillMatching?: SkillMatchRule[];

  /** Trusted agent name prefixes (for trust level, not role assignment) */
  trustedPrefixes?: string[];
}

// ============================================================================
// Skill Definition (Extended for A2A)
// ============================================================================

/**
 * Skill definition from Skill MCP Server
 * Extended with A2A identity configuration
 */
export interface SkillDefinition {
  /** Unique skill identifier */
  id: string;

  /** Human-readable display name */
  displayName: string;

  /** Skill description */
  description: string;

  /** Roles that can use this skill (["*"] = all roles) */
  allowedRoles: string[];

  /** Tools this skill uses (MCP tool format) */
  allowedTools: string[];

  /** Capability grants (memory, etc.) */
  grants?: SkillGrants;

  /**
   * A2A Identity configuration
   * Skills can define identity-to-role mappings for Zero-Trust agent communication
   */
  identity?: SkillIdentityConfig;

  /** Skill metadata */
  metadata?: SkillMetadata;
}

// ============================================================================
// Identity Configuration
// ============================================================================

/**
 * A2A Identity Configuration
 * Skill-based role matching for Zero-Trust agent communication
 */
export interface IdentityConfig {
  /** Configuration version */
  version: string;

  /** Default role when no skills match */
  defaultRole: string;

  /** Skill-based matching rules */
  skillRules: SkillMatchRule[];

  /** Whether to reject connections that don't match any rule */
  rejectUnknown?: boolean;

  /** Trusted agent prefixes (for trust level, not role assignment) */
  trustedPrefixes?: string[];

  /**
   * Strict validation mode
   * When true: invalid config (bad time format, invalid timezone) throws error
   * When false (default): invalid config is logged and skipped (fail-open)
   */
  strictValidation?: boolean;
}

// ============================================================================
// Identity Resolution Result
// ============================================================================

/**
 * Result of identity resolution
 */
export interface IdentityResolution {
  /** Resolved role ID */
  roleId: string;

  /** Original agent name from clientInfo */
  agentName: string;

  /** Which matching rule was used (null if default) */
  matchedRule: SkillMatchRule | null;

  /** Skills that matched from the agent */
  matchedSkills: string[];

  /** Whether this is a trusted agent */
  isTrusted: boolean;

  /** Resolution timestamp */
  resolvedAt: Date;
}

// ============================================================================
// Identity Statistics
// ============================================================================

/**
 * Statistics about loaded identity rules
 */
export interface IdentityStats {
  /** Total number of rules */
  totalRules: number;

  /** Number of rules per role */
  rulesByRole: Record<string, number>;

  /** Trusted prefixes */
  trustedPrefixes: string[];
}
