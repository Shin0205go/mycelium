// ============================================================================
// AEGIS Shared Types
// Common types used across all AEGIS packages
// ============================================================================

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Role Configuration
// ============================================================================

/**
 * Tool-level permissions for fine-grained access control
 */
export interface ToolPermissions {
  /** Explicitly allowed tools (overrides server-level permissions) */
  allow?: string[];

  /** Explicitly denied tools (overrides allow list) */
  deny?: string[];

  /** Tool patterns to allow (glob-style, e.g., 'filesystem__read*') */
  allowPatterns?: string[];

  /** Tool patterns to deny */
  denyPatterns?: string[];
}

/**
 * Role metadata for management and auditing
 */
export interface RoleMetadata {
  /** Role version */
  version?: string;

  /** When the role was created */
  createdAt?: Date;

  /** Who created the role */
  createdBy?: string;

  /** Last modification time */
  lastModified?: Date;

  /** Role priority (higher = more privileged) */
  priority?: number;

  /** Tags for categorization */
  tags?: string[];

  /** Whether this role is currently active */
  active?: boolean;

  /** Skills assigned to this role */
  skills?: string[];
}

/**
 * Role definition that determines which servers/tools are accessible
 */
export interface Role {
  /** Unique role identifier (e.g., 'frontend', 'db_admin', 'security') */
  id: string;

  /** Human-readable role name */
  name: string;

  /** Role description */
  description: string;

  /** Parent role ID to inherit permissions from */
  inherits?: string;

  /** List of allowed upstream server names */
  allowedServers: string[];

  /** System instruction/prompt for this role (loaded from PROMPT.md or remote) */
  systemInstruction: string;

  /** Remote instruction configuration if this role fetches prompt from MCP server */
  remoteInstruction?: RemoteInstruction;

  /** Optional tool-level permissions within allowed servers */
  toolPermissions?: ToolPermissions;

  /** Role metadata */
  metadata?: RoleMetadata;
}

/**
 * Configuration for fetching system instruction from a remote MCP server
 */
export interface RemoteInstruction {
  /** Backend/server name that provides the prompt */
  backend: string;

  /** Name of the prompt to fetch via prompts/get */
  promptName: string;

  /** Optional arguments to pass to the prompt */
  arguments?: Record<string, string>;

  /** Cache TTL in seconds (0 = no cache, default = 300) */
  cacheTtl?: number;

  /** Fallback instruction if remote fetch fails */
  fallback?: string;
}

// ============================================================================
// Skill Types
// ============================================================================

/**
 * Memory access policy type
 * - 'none': No memory access (default)
 * - 'isolated': Own role's memory only
 * - 'team': Access to specific roles' memories (requires teamRoles)
 * - 'all': Access to all roles' memories (admin level)
 */
export type MemoryPolicy = 'none' | 'isolated' | 'team' | 'all';

/**
 * Capability grants from skills
 */
export interface SkillGrants {
  /** Memory access policy for roles using this skill */
  memory?: MemoryPolicy;

  /** For 'team' policy: which roles' memories can be accessed */
  memoryTeamRoles?: string[];
}

/**
 * Skill metadata
 */
export interface SkillMetadata {
  /** Skill version */
  version?: string;

  /** Skill category for grouping */
  category?: string;

  /** Skill author */
  author?: string;

  /** Tags for discovery */
  tags?: string[];
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Extended tool information with source tracking
 */
export interface ToolInfo {
  /** Original tool definition */
  tool: Tool;

  /** Source server name */
  sourceServer: string;

  /** Prefixed tool name (serverName__toolName) */
  prefixedName: string;

  /** Whether this tool is currently visible */
  visible: boolean;

  /** Why this tool is visible/hidden */
  visibilityReason?: string;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when role is not found
 */
export class RoleNotFoundError extends Error {
  constructor(
    public readonly roleId: string,
    public readonly availableRoles: string[]
  ) {
    super(`Role '${roleId}' not found. Available roles: ${availableRoles.join(', ')}`);
    this.name = 'RoleNotFoundError';
  }
}

/**
 * Error thrown when server is not accessible for current role
 */
export class ServerNotAccessibleError extends Error {
  constructor(
    public readonly serverName: string,
    public readonly currentRole: string,
    public readonly allowedServers: string[]
  ) {
    super(
      `Server '${serverName}' is not accessible for role '${currentRole}'. ` +
      `Allowed servers: ${allowedServers.join(', ')}`
    );
    this.name = 'ServerNotAccessibleError';
  }
}

/**
 * Error thrown when tool is not accessible
 */
export class ToolNotAccessibleError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly currentRole: string,
    public readonly reason: string
  ) {
    super(`Tool '${toolName}' is not accessible for role '${currentRole}': ${reason}`);
    this.name = 'ToolNotAccessibleError';
  }
}

// ============================================================================
// Logger Interface
// ============================================================================

/**
 * Logger interface for dependency injection
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ============================================================================
// List Roles Types
// ============================================================================

/**
 * Options for listing available roles
 */
export interface ListRolesOptions {
  /** Include inactive roles */
  includeInactive?: boolean;

  /** Filter by tags */
  tags?: string[];
}

/**
 * Result of listing roles
 */
export interface ListRolesResult {
  /** Available roles */
  roles: Array<{
    id: string;
    name: string;
    description: string;
    serverCount: number;
    toolCount: number;
    skills: string[];
    isActive: boolean;
    isCurrent: boolean;
  }>;

  /** Current role ID */
  currentRole: string | null;

  /** Default role ID */
  defaultRole: string;
}

// ============================================================================
// Skill Manifest Types
// ============================================================================

/**
 * Skill definition from Skill MCP Server (base type)
 * Extended by @aegis/a2a with identity configuration
 */
export interface BaseSkillDefinition {
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

  /** Skill metadata */
  metadata?: SkillMetadata;
}

/**
 * Result of list_skills from Skill MCP Server
 */
export interface SkillManifest<TSkill = BaseSkillDefinition> {
  /** All available skills */
  skills: TSkill[];

  /** Manifest version */
  version: string;

  /** When the manifest was generated */
  generatedAt: Date;
}

/**
 * Dynamically generated role from skill definitions
 * Role = aggregation of skills that allow it
 */
export interface DynamicRole {
  /** Role ID (extracted from skill.allowedRoles) */
  id: string;

  /** Skills available for this role */
  skills: string[];

  /** Aggregated tools from all skills */
  tools: string[];
}

/**
 * Role manifest generated from skill definitions
 * Maps role IDs to their available skills and tools
 */
export interface RoleManifest {
  /** Dynamic roles derived from skills */
  roles: Record<string, DynamicRole>;

  /** Source skill manifest version */
  sourceVersion: string;

  /** When this manifest was generated */
  generatedAt: Date;
}
