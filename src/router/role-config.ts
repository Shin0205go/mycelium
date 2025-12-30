// ============================================================================
// AEGIS Router - Role Configuration System
// Loads and manages role definitions from configuration files
// ============================================================================

import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { Logger } from '../utils/logger.js';
import type {
  Role,
  RoleConfig,
  RolesConfig,
  RoleMetadata,
  ToolPermissions,
  RemoteInstruction,
  AgentConfig,
  ExtendedRolesConfig,
  ListRolesOptions,
  ListRolesResult,
  SkillDefinition,
  SkillManifest,
  DynamicRole,
  RoleManifest
} from '../types/router-types.js';
import { RemotePromptFetcher, createRemotePromptFetcher, PromptRouter } from './remote-prompt-fetcher.js';

/**
 * Default roles directory relative to project root
 */
const DEFAULT_ROLES_DIR = 'roles';

/**
 * Default roles configuration file name
 */
const DEFAULT_CONFIG_FILE = 'aegis-roles.json';

/**
 * Role Configuration Manager
 * Handles loading, parsing, and managing role definitions
 */
export class RoleConfigManager {
  private logger: Logger;
  private rolesDir: string;
  private configFile: string;
  private roles: Map<string, Role> = new Map();
  private roleConfigs: Map<string, RoleConfig> = new Map(); // Store original configs for refetching
  private agents: Map<string, AgentConfig> = new Map(); // Store agent configurations
  private serverGroups: Map<string, string[]> = new Map();
  private defaultRole: string = 'default';
  private configVersion: string = '1.0.0';
  private initialized: boolean = false;
  private remotePromptFetcher: RemotePromptFetcher;

  constructor(
    logger: Logger,
    options?: {
      rolesDir?: string;
      configFile?: string;
    }
  ) {
    this.logger = logger;

    // Initialize remote prompt fetcher
    this.remotePromptFetcher = createRemotePromptFetcher(logger);

    // Determine roles directory using process.cwd() for project root
    const projectRoot = process.cwd();
    this.rolesDir = options?.rolesDir || join(projectRoot, DEFAULT_ROLES_DIR);
    this.configFile = options?.configFile || join(this.rolesDir, DEFAULT_CONFIG_FILE);

    this.logger.debug('RoleConfigManager initialized', {
      rolesDir: this.rolesDir,
      configFile: this.configFile
    });
  }

  /**
   * Set the router for remote prompt fetching
   * This must be called before roles with remote instructions can be activated
   */
  setPromptRouter(router: PromptRouter): void {
    this.remotePromptFetcher.setRouter(router);
    this.logger.debug('Prompt router set for remote instruction fetching');
  }

  /**
   * Initialize the role configuration system
   * v2: Roles are loaded dynamically from skill manifest via loadFromSkillManifest()
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('RoleConfigManager already initialized');
      return;
    }

    this.logger.info('Initializing role configuration system...');
    // v2: No static config - roles loaded via loadFromSkillManifest()
    this.initialized = true;
  }

  /**
   * Load a single role from configuration
   * Note: Remote instructions are not fetched during init - use refreshRoleInstruction() after activation
   */
  private async loadRole(config: RoleConfig): Promise<Role> {
    // Resolve server groups
    const allowedServers = this.resolveServerReferences(config.allowedServers);

    // Load system instruction based on priority:
    // 1. remoteInstruction - use placeholder, will be fetched on role activation
    // 2. promptFile - load from local file
    // 3. systemInstruction - use inline
    let systemInstruction = config.systemInstruction || '';

    if (config.remoteInstruction) {
      // For remote instructions, use fallback or placeholder during initialization
      // The actual fetch happens when the role is activated (refreshRoleInstruction)
      systemInstruction = config.remoteInstruction.fallback ||
        `# ${config.name}\n\n` +
        `This role uses a remote instruction from backend: ${config.remoteInstruction.backend}\n` +
        `Prompt: ${config.remoteInstruction.promptName}\n\n` +
        `The instruction will be loaded when the role is activated.`;

      this.logger.debug(`Role ${config.id} uses remote instruction from ${config.remoteInstruction.backend}`);
    } else if (config.promptFile) {
      try {
        const promptPath = join(this.rolesDir, config.promptFile);
        systemInstruction = await readFile(promptPath, 'utf-8');
        this.logger.debug(`Loaded prompt file for ${config.id}: ${config.promptFile}`);
      } catch (error) {
        this.logger.warn(`Failed to load prompt file for ${config.id}: ${config.promptFile}`);
        // Fall back to inline instruction or empty string
      }
    }

    // Build the role object
    const role: Role = {
      id: config.id,
      name: config.name,
      description: config.description,
      allowedServers,
      systemInstruction,
      // Store remote instruction config for later fetching
      remoteInstruction: config.remoteInstruction,
      toolPermissions: config.toolPermissions,
      metadata: {
        ...config.metadata,
        active: config.metadata?.active !== false
      }
    };

    return role;
  }

  /**
   * Resolve server references (including @group notation)
   */
  private resolveServerReferences(refs: string[]): string[] {
    const resolved: string[] = [];

    for (const ref of refs) {
      if (ref.startsWith('@')) {
        // It's a group reference
        const groupName = ref.substring(1);
        const groupServers = this.serverGroups.get(groupName);

        if (groupServers) {
          resolved.push(...groupServers);
        } else {
          this.logger.warn(`Unknown server group: ${groupName}`);
        }
      } else {
        // It's a direct server reference
        resolved.push(ref);
      }
    }

    // Remove duplicates
    return [...new Set(resolved)];
  }

  /**
   * Create default role configuration
   */
  private async createDefaultRoles(): Promise<void> {
    // Create a permissive default role
    const defaultRole: Role = {
      id: 'default',
      name: 'Default Role',
      description: 'Default role with access to all servers and tools',
      allowedServers: ['*'], // Wildcard for all servers
      systemInstruction: `# AEGIS Default Role

You are operating in the default role with full access to all available tools and servers.

Please use the tools responsibly and follow best practices for security and data handling.

To switch to a specialized role, use the set_role tool with the desired role name.`,
      metadata: {
        priority: 0,
        active: true,
        tags: ['default', 'full-access']
      }
    };

    // Create a restricted guest role
    const guestRole: Role = {
      id: 'guest',
      name: 'Guest Role',
      description: 'Restricted role with read-only access',
      allowedServers: ['filesystem'],
      systemInstruction: `# AEGIS Guest Role

You are operating in guest mode with limited, read-only access.

You can:
- Read files
- List directories

You cannot:
- Write or modify files
- Execute commands
- Access sensitive resources

To request elevated access, contact the system administrator.`,
      toolPermissions: {
        allowPatterns: ['filesystem__read*', 'filesystem__list*'],
        denyPatterns: ['*__write*', '*__delete*', '*__execute*']
      },
      metadata: {
        priority: -1,
        active: true,
        tags: ['guest', 'read-only']
      }
    };

    // Create admin role
    const adminRole: Role = {
      id: 'admin',
      name: 'Administrator Role',
      description: 'Full administrative access with all capabilities',
      allowedServers: ['*'],
      systemInstruction: `# AEGIS Administrator Role

You are operating with full administrative privileges.

IMPORTANT: With great power comes great responsibility.

- You have access to ALL tools and servers
- Exercise caution with destructive operations
- All actions are logged for audit purposes
- Follow security best practices`,
      metadata: {
        priority: 100,
        active: true,
        tags: ['admin', 'full-access', 'privileged']
      }
    };

    this.roles.set('default', defaultRole);
    this.roles.set('guest', guestRole);
    this.roles.set('admin', adminRole);

    this.defaultRole = 'default';

    this.logger.info('Created default roles: default, guest, admin');
  }

  /**
   * Get a role by ID
   */
  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  /**
   * Get the default role
   */
  getDefaultRole(): Role | undefined {
    return this.roles.get(this.defaultRole);
  }

  /**
   * Get the default role ID
   */
  getDefaultRoleId(): string {
    return this.defaultRole;
  }

  /**
   * Check if a role exists
   */
  hasRole(roleId: string): boolean {
    return this.roles.has(roleId);
  }

  /**
   * Get all role IDs
   */
  getRoleIds(): string[] {
    return Array.from(this.roles.keys());
  }

  /**
   * Get all roles
   */
  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get an agent config by ID
   */
  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agent configs
   */
  getAllAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Check if a role is backed by an agent config (vs legacy role)
   */
  isAgentRole(roleId: string): boolean {
    return this.agents.has(roleId);
  }

  /**
   * Convert an AgentConfig to a Role
   *
   * Agent = skill + access control
   * - allowedServers: which MCP servers this agent can use
   * - allowedSkills: which skills from agent-skills are visible
   * - toolPermissions: fine-grained tool access control
   */
  private agentToRole(agent: AgentConfig): Role {
    const allowedServers = agent.allowedServers || [];
    if (allowedServers.length === 0) {
      this.logger.warn(`Agent ${agent.id} has no allowed servers configured`);
    }

    // Simple system instruction based on description
    const systemInstruction = `# ${agent.displayName}\n\n${agent.description}`;

    const role: Role = {
      id: agent.id,
      name: agent.displayName,
      description: agent.description,
      allowedServers,
      systemInstruction,
      toolPermissions: agent.toolPermissions,
      metadata: {
        ...agent.metadata,
        active: agent.metadata?.active !== false,
        tags: [...(agent.metadata?.tags || []), 'agent']
      }
    };

    this.logger.debug(`Converted agent to role: ${agent.id}`, {
      allowedServers,
      allowedSkills: agent.allowedSkills
    });

    return role;
  }

  /**
   * Get allowed skills for an agent
   * Returns undefined if no skill filtering (all skills allowed)
   */
  getAllowedSkillsForAgent(agentId: string): string[] | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    // If allowedSkills is defined and non-empty, return it
    if (agent.allowedSkills && agent.allowedSkills.length > 0) {
      return agent.allowedSkills;
    }

    // No skill filtering
    return undefined;
  }

  /**
   * Check if a skill is allowed for an agent
   */
  isSkillAllowedForAgent(agentId: string, skillName: string): boolean {
    const allowedSkills = this.getAllowedSkillsForAgent(agentId);

    // If no skill filtering, all skills are allowed
    if (!allowedSkills) return true;

    // Check if skill is in allowed list
    return allowedSkills.includes(skillName);
  }

  /**
   * Check if a role has remote instruction that needs fetching
   */
  hasRemoteInstruction(roleId: string): boolean {
    const role = this.roles.get(roleId);
    return !!role?.remoteInstruction;
  }

  /**
   * Refresh a role's system instruction from remote source
   * Called when a role with remote instruction is activated
   *
   * @param roleId - The role ID to refresh
   * @returns The updated system instruction, or null if no remote instruction
   */
  async refreshRoleInstruction(roleId: string): Promise<string | null> {
    const role = this.roles.get(roleId);
    if (!role || !role.remoteInstruction) {
      return null;
    }

    this.logger.info(`Refreshing remote instruction for role: ${roleId}`);

    const result = await this.remotePromptFetcher.fetchPrompt(role.remoteInstruction);

    if (result.success) {
      role.systemInstruction = result.content;
      this.roles.set(roleId, role);

      this.logger.info(`Remote instruction refreshed for ${roleId}`, {
        source: result.source,
        contentLength: result.content.length
      });

      return result.content;
    } else {
      this.logger.warn(`Failed to refresh remote instruction for ${roleId}:`, result.error);
      return role.systemInstruction;
    }
  }

  /**
   * Update a role's system instruction directly
   * Useful for testing or dynamic updates
   */
  updateRoleInstruction(roleId: string, instruction: string): boolean {
    const role = this.roles.get(roleId);
    if (!role) return false;

    role.systemInstruction = instruction;
    this.roles.set(roleId, role);

    this.logger.debug(`Updated instruction for role: ${roleId}`);
    return true;
  }

  /**
   * Invalidate cached remote instruction for a role
   */
  invalidateRemoteCache(roleId: string): void {
    const role = this.roles.get(roleId);
    if (role?.remoteInstruction) {
      this.remotePromptFetcher.invalidateCache(role.remoteInstruction);
      this.logger.debug(`Invalidated remote cache for role: ${roleId}`);
    }
  }

  /**
   * Get the remote prompt fetcher for external access
   */
  getRemotePromptFetcher(): RemotePromptFetcher {
    return this.remotePromptFetcher;
  }

  /**
   * List roles with optional filtering
   */
  listRoles(options?: ListRolesOptions, currentRoleId?: string | null): ListRolesResult {
    let roles = Array.from(this.roles.values());

    // Filter by active status
    if (!options?.includeInactive) {
      roles = roles.filter(r => r.metadata?.active !== false);
    }

    // Filter by tags
    if (options?.tags && options.tags.length > 0) {
      roles = roles.filter(r => {
        const roleTags = r.metadata?.tags || [];
        return options.tags!.some(tag => roleTags.includes(tag));
      });
    }

    return {
      roles: roles.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        serverCount: r.allowedServers.includes('*') ? -1 : r.allowedServers.length,
        isActive: r.metadata?.active !== false,
        isCurrent: r.id === currentRoleId
      })),
      currentRole: currentRoleId ?? null,
      defaultRole: this.defaultRole
    };
  }

  /**
   * Check if a server is allowed for a role
   */
  isServerAllowedForRole(roleId: string, serverName: string): boolean {
    const role = this.roles.get(roleId);
    if (!role) return false;

    // Wildcard allows all servers
    if (role.allowedServers.includes('*')) return true;

    return role.allowedServers.includes(serverName);
  }

  /**
   * Check if a tool is allowed for a role
   */
  isToolAllowedForRole(roleId: string, toolName: string, serverName: string): boolean {
    // System tools are always allowed regardless of role
    const SYSTEM_TOOLS = ['set_role'];
    if (SYSTEM_TOOLS.includes(toolName)) {
      return true;
    }

    const role = this.roles.get(roleId);
    if (!role) return false;

    // First check server access
    if (!this.isServerAllowedForRole(roleId, serverName)) {
      return false;
    }

    // If no tool permissions defined, allow all tools from allowed servers
    if (!role.toolPermissions) {
      return true;
    }

    const permissions = role.toolPermissions;

    // Check explicit deny list first
    if (permissions.deny?.includes(toolName)) {
      return false;
    }

    // Check deny patterns
    if (permissions.denyPatterns) {
      for (const pattern of permissions.denyPatterns) {
        if (this.matchPattern(toolName, pattern)) {
          return false;
        }
      }
    }

    // Check explicit allow list
    if (permissions.allow?.includes(toolName)) {
      return true;
    }

    // Check allow patterns
    if (permissions.allowPatterns) {
      for (const pattern of permissions.allowPatterns) {
        if (this.matchPattern(toolName, pattern)) {
          return true;
        }
      }
    }

    // If allow list/patterns are defined, default to deny
    if (permissions.allow || permissions.allowPatterns) {
      return false;
    }

    // Default to allow
    return true;
  }

  /**
   * Simple glob-style pattern matching
   */
  private matchPattern(str: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*')                   // Convert * to .*
      .replace(/\?/g, '.');                   // Convert ? to .

    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(str);
  }

  // ============================================================================
  // v2: Skill-Driven Dynamic Role Generation
  // ============================================================================

  /**
   * Generate dynamic roles from skill manifest
   * Skills define allowedRoles, and roles are aggregated from all skills
   *
   * @param manifest - Skill manifest from Skill MCP Server
   * @returns Role manifest with dynamically generated roles
   */
  generateRoleManifest(manifest: SkillManifest): RoleManifest {
    const roles: Record<string, DynamicRole> = {};

    for (const skill of manifest.skills) {
      for (const roleId of skill.allowedRoles) {
        // Handle wildcard role
        const targetRoleId = roleId === '*' ? '__all__' : roleId;

        if (!roles[targetRoleId]) {
          roles[targetRoleId] = {
            id: targetRoleId,
            skills: [],
            tools: []
          };
        }

        // Add skill to role
        if (!roles[targetRoleId].skills.includes(skill.id)) {
          roles[targetRoleId].skills.push(skill.id);
        }

        // Add tools to role (deduplicated)
        for (const tool of skill.allowedTools) {
          if (!roles[targetRoleId].tools.includes(tool)) {
            roles[targetRoleId].tools.push(tool);
          }
        }
      }
    }

    // If there's a wildcard role, merge its skills/tools into all other roles
    const wildcardRole = roles['__all__'];
    if (wildcardRole) {
      for (const roleId of Object.keys(roles)) {
        if (roleId !== '__all__') {
          // Merge wildcard skills
          for (const skill of wildcardRole.skills) {
            if (!roles[roleId].skills.includes(skill)) {
              roles[roleId].skills.push(skill);
            }
          }
          // Merge wildcard tools
          for (const tool of wildcardRole.tools) {
            if (!roles[roleId].tools.includes(tool)) {
              roles[roleId].tools.push(tool);
            }
          }
        }
      }
      // Remove the __all__ placeholder
      delete roles['__all__'];
    }

    const roleManifest: RoleManifest = {
      roles,
      sourceVersion: manifest.version,
      generatedAt: new Date()
    };

    this.logger.info(`Generated role manifest from ${manifest.skills.length} skills`, {
      roleCount: Object.keys(roles).length,
      roles: Object.keys(roles)
    });

    return roleManifest;
  }

  /**
   * Load roles dynamically from skill manifest
   * Replaces static role definitions with skill-derived roles
   *
   * @param manifest - Skill manifest from Skill MCP Server
   */
  async loadFromSkillManifest(manifest: SkillManifest): Promise<void> {
    const roleManifest = this.generateRoleManifest(manifest);

    // Clear existing roles (keep only system roles if needed)
    this.roles.clear();
    this.agents.clear();

    // Create Role objects from dynamic roles
    for (const [roleId, dynamicRole] of Object.entries(roleManifest.roles)) {
      const role: Role = {
        id: roleId,
        name: roleId.charAt(0).toUpperCase() + roleId.slice(1), // Capitalize
        description: `Dynamic role with access to: ${dynamicRole.skills.join(', ')}`,
        allowedServers: this.extractServersFromTools(dynamicRole.tools),
        systemInstruction: this.generateRoleInstruction(roleId, dynamicRole),
        toolPermissions: {
          allowPatterns: dynamicRole.tools
        },
        metadata: {
          active: true,
          tags: ['dynamic', 'skill-driven']
        }
      };

      this.roles.set(roleId, role);
      this.logger.debug(`Created dynamic role: ${roleId}`, {
        skills: dynamicRole.skills.length,
        tools: dynamicRole.tools.length
      });
    }

    // Set first role as default if none specified
    if (this.roles.size > 0 && !this.roles.has(this.defaultRole)) {
      this.defaultRole = Array.from(this.roles.keys())[0];
    }

    this.logger.info(`Loaded ${this.roles.size} roles from skill manifest`);
  }

  /**
   * Extract server name from a single MCP tool name
   * Format: mcp__plugin_<plugin>_<server>__<tool> or server__tool
   * @public - exported for testing
   */
  static extractServerFromTool(tool: string): string | null {
    // Match MCP tool format: mcp__plugin_xxx_servername__toolname
    const match = tool.match(/^mcp__plugin_[^_]+_([^_]+)__/);
    if (match) {
      return match[1];
    }
    // Try simpler format: servername__toolname
    const simpleMatch = tool.match(/^([^_]+)__/);
    if (simpleMatch) {
      return simpleMatch[1];
    }
    return null;
  }

  /**
   * Extract server names from MCP tool names
   * Format: mcp__plugin_<plugin>_<server>__<tool>
   */
  private extractServersFromTools(tools: string[]): string[] {
    const servers = new Set<string>();

    for (const tool of tools) {
      const server = RoleConfigManager.extractServerFromTool(tool);
      if (server) {
        servers.add(server);
      }
    }

    return Array.from(servers);
  }

  /**
   * Generate system instruction for a dynamic role
   */
  private generateRoleInstruction(roleId: string, role: DynamicRole): string {
    return `# ${roleId.charAt(0).toUpperCase() + roleId.slice(1)} Role

You are operating as the ${roleId} role with access to the following skills:
${role.skills.map(s => `- ${s}`).join('\n')}

Available tools are filtered based on your role. Use the tools responsibly.`;
  }

  /**
   * Get available skills for a role (v2)
   */
  getSkillsForRole(roleId: string): string[] {
    // For now, check if role was created from dynamic loading
    const role = this.roles.get(roleId);
    if (!role) return [];

    // Extract skills from tool patterns if available
    // This is a placeholder - actual implementation depends on how skills are stored
    return role.metadata?.tags?.includes('skill-driven')
      ? (role.toolPermissions?.allowPatterns || [])
      : [];
  }

  /**
   * Reload configuration from file
   */
  async reload(): Promise<void> {
    this.roles.clear();
    this.roleConfigs.clear();
    this.agents.clear();
    this.serverGroups.clear();
    this.remotePromptFetcher.clearCache();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Get configuration version
   */
  getVersion(): string {
    return this.configVersion;
  }

  /**
   * Get server groups
   */
  getServerGroups(): Map<string, string[]> {
    return new Map(this.serverGroups);
  }
}

// Export a factory function for easy creation
export function createRoleConfigManager(
  logger: Logger,
  options?: {
    rolesDir?: string;
    configFile?: string;
  }
): RoleConfigManager {
  return new RoleConfigManager(logger, options);
}
