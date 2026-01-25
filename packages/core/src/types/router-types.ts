// ============================================================================
// MYCELIUM Router Core - Type Definitions
// Defines types for role-based routing and dynamic tool filtering
// ============================================================================

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Import shared types (imported but NOT re-exported to avoid conflicts with @mycelium/shared)
// Consumers should import these types directly from @mycelium/shared
import type {
  Role,
  ToolPermissions,
  RoleMetadata,
  RemoteInstruction,
  ToolInfo,
  SkillManifest,
  RoleManifest
} from '@mycelium/shared';

// Use BaseSkillDefinition from shared (A2A identity features removed)
// Alias for backward compatibility
type SkillDefinition = import('@mycelium/shared').BaseSkillDefinition;

// ============================================================================
// Role Configuration File Format
// ============================================================================

/**
 * Configuration file format for roles (mycelium-roles.json)
 */
export interface RolesConfig {
  /** Configuration version */
  version: string;

  /** Default role when no role is specified */
  defaultRole: string;

  /** Role definitions */
  roles: RoleConfig[];

  /** Server group definitions for easier role configuration */
  serverGroups?: Record<string, string[]>;
}

/**
 * Role configuration as stored in config file
 */
export interface RoleConfig {
  /** Role ID */
  id: string;

  /** Role name */
  name: string;

  /** Role description */
  description: string;

  /** List of allowed servers or server groups (prefixed with @) */
  allowedServers: string[];

  /** Path to PROMPT.md file (relative to roles directory) */
  promptFile?: string;

  /** Inline system instruction (used if promptFile is not specified) */
  systemInstruction?: string;

  /**
   * Remote instruction configuration - fetch prompt from an MCP server
   * This takes precedence over promptFile and systemInstruction when specified
   */
  remoteInstruction?: RemoteInstruction;

  /** Tool permissions */
  toolPermissions?: ToolPermissions;

  /** Metadata */
  metadata?: RoleMetadata;
}

// ============================================================================
// Agent Configuration (Persona + Skills Architecture)
// ============================================================================

/**
 * Agent configuration - skill-based agent definition
 *
 * Design philosophy:
 * - Agent = skill + access control
 * - Skill provides instruction (SKILL.md) and tools
 * - MYCELIUM controls which servers/skills/tools are accessible
 */
export interface AgentConfig {
  /** Agent ID for internal reference */
  id: string;

  /** Display name shown to users */
  displayName: string;

  /** Description of what this agent does */
  description: string;

  /** Allowed backend servers for this agent */
  allowedServers: string[];

  /** Allowed skills (filters list_skills/get_skill responses) */
  allowedSkills?: string[];

  /** Tool permissions for fine-grained control */
  toolPermissions?: ToolPermissions;

  /** Agent metadata */
  metadata?: RoleMetadata;
}

/**
 * Backend server configuration
 */
export interface BackendConfig {
  /** Command to run the server */
  command: string;

  /** Command arguments */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Working directory */
  cwd?: string;

  /** Description of what this backend provides */
  description?: string;
}

/**
 * Extended roles config that supports both legacy roles and new agents
 */
export interface ExtendedRolesConfig extends RolesConfig {
  /**
   * Backend server definitions
   * Maps backend name to its configuration
   */
  backends?: Record<string, BackendConfig>;

  /**
   * Agent definitions (new format)
   * These combine personas with skills from backends
   */
  agents?: AgentConfig[];
}

// ============================================================================
// Router State
// ============================================================================

/**
 * Current state of the MYCELIUM Router
 */
export interface MyceliumRouterState {
  /** Currently active role */
  currentRole: Role | null;

  /** All available roles */
  availableRoles: Map<string, Role>;

  /** Connected sub-MCP servers */
  connectedServers: Map<string, SubServerInfo>;

  /** Currently visible tools (filtered by role) */
  visibleTools: Map<string, ToolInfo>;

  /** State metadata */
  metadata: RouterStateMetadata;
}

/**
 * Information about a connected sub-MCP server
 */
export interface SubServerInfo {
  /** Server name/identifier */
  name: string;

  /** Whether the server is connected */
  connected: boolean;

  /** Whether the server is active for current role */
  activeForRole: boolean;

  /** Tools provided by this server */
  tools: Tool[];

  /** Last activity timestamp */
  lastActivity?: Date;

  /** Server health status */
  health?: 'healthy' | 'degraded' | 'unhealthy';
}

/**
 * Router state metadata
 */
export interface RouterStateMetadata {
  /** When the router was initialized */
  initializedAt: Date;

  /** Last role switch timestamp */
  lastRoleSwitch?: Date;

  /** Number of role switches in this session */
  roleSwitchCount: number;

  /** Session ID */
  sessionId: string;
}

// ============================================================================
// Agent Manifest (set_role result)
// ============================================================================

/**
 * Result of set_role tool call
 */
export interface AgentManifest {
  /** Role that was activated */
  role: ManifestRole;

  /** System instruction/prompt for the AI agent */
  systemInstruction: string;

  /** List of available tools for this role */
  availableTools: ManifestTool[];

  /** List of available servers for this role */
  availableServers: string[];

  /** Manifest metadata */
  metadata: ManifestMetadata;
}

/**
 * Role information in manifest
 */
export interface ManifestRole {
  /** Role ID */
  id: string;

  /** Role name */
  name: string;

  /** Role description */
  description: string;
}

/**
 * Tool information in manifest
 */
export interface ManifestTool {
  /** Tool name (prefixed) */
  name: string;

  /** Tool description */
  description?: string;

  /** Source server */
  source: string;

  /** Tool category (if available) */
  category?: string;
}

/**
 * Manifest metadata
 */
export interface ManifestMetadata {
  /** When the manifest was generated */
  generatedAt: Date;

  /** Previous role (if switching) */
  previousRole?: string;

  /** Whether tools list changed */
  toolsChanged: boolean;

  /** Number of tools available */
  toolCount: number;

  /** Number of servers active */
  serverCount: number;
}

// ============================================================================
// Router Events
// ============================================================================

/**
 * Event emitted when role changes
 */
export interface RoleSwitchEvent {
  /** Event type */
  type: 'role_switch';

  /** Timestamp */
  timestamp: Date;

  /** Previous role (null if first switch) */
  previousRole: string | null;

  /** New role */
  newRole: string;

  /** Tools that were added */
  addedTools: string[];

  /** Tools that were removed */
  removedTools: string[];

  /** Who initiated the switch */
  initiatedBy?: string;
}

/**
 * Event emitted when tools list changes
 */
export interface ToolsChangedEvent {
  /** Event type */
  type: 'tools_changed';

  /** Timestamp */
  timestamp: Date;

  /** Current role */
  role: string;

  /** Reason for change */
  reason: 'role_switch' | 'server_connect' | 'server_disconnect' | 'config_update';

  /** Current tool count */
  toolCount: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Options for set_role tool
 */
export interface SetRoleOptions {
  /** Role to activate */
  role: string;

  /** Whether to include full tool descriptions */
  includeToolDescriptions?: boolean;

  /** Whether to include server health info */
  includeServerHealth?: boolean;
}

// ============================================================================
// Skill MCP Client Interface
// ============================================================================

/**
 * Interface for Skill MCP Server client
 */
export interface SkillMcpClient {
  /**
   * Fetch skill list from Skill MCP Server (called at startup)
   */
  listSkills(): Promise<SkillManifest>;

  /**
   * Generate role manifest from skills
   * Aggregates skills by allowedRoles and combines their tools
   */
  generateRoleManifest(skills: SkillDefinition[]): RoleManifest;
}
