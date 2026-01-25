// ============================================================================
// MYCELIUM RBAC - Role Manager
// Manages role definitions and permissions (skill-driven architecture)
// ============================================================================

import type {
  Logger,
  Role,
  ListRolesOptions,
  ListRolesResult,
  SkillManifest,
  DynamicRole,
  RoleManifest,
  MemoryPolicy,
  ToolPermissions
} from '@mycelium/shared';

/**
 * Memory permission configuration for a role
 */
export interface RoleMemoryPermission {
  /** Memory access policy */
  policy: MemoryPolicy;
  /** For 'team' policy: which roles' memories can be accessed */
  teamRoles?: string[];
}

/**
 * Role Manager
 * Manages role definitions and permission checking (skill-driven architecture)
 */
export class RoleManager {
  private logger: Logger;
  private roles: Map<string, Role> = new Map();
  private defaultRole: string = 'default';
  private initialized: boolean = false;

  /** Memory permissions per role (derived from skills) */
  private memoryPermissions: Map<string, RoleMemoryPermission> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
    this.logger.debug('RoleManager initialized');
  }

  /**
   * Initialize the role manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('RoleManager already initialized');
      return;
    }
    this.initialized = true;
  }

  // ============================================================================
  // Role Accessors
  // ============================================================================

  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  getDefaultRole(): Role | undefined {
    return this.roles.get(this.defaultRole);
  }

  getDefaultRoleId(): string {
    return this.defaultRole;
  }

  hasRole(roleId: string): boolean {
    return this.roles.has(roleId);
  }

  getRoleIds(): string[] {
    return Array.from(this.roles.keys());
  }

  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  // ============================================================================
  // Role Inheritance
  // ============================================================================

  /**
   * Get the inheritance chain for a role (from child to root)
   * Detects circular inheritance and returns empty array if found
   */
  getInheritanceChain(roleId: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = roleId;

    while (currentId) {
      if (visited.has(currentId)) {
        this.logger.warn(`Circular inheritance detected for role: ${roleId}`);
        return []; // Return empty chain on circular reference
      }

      visited.add(currentId);
      chain.push(currentId);

      const role = this.roles.get(currentId);
      currentId = role?.inherits;
    }

    return chain;
  }

  /**
   * Get effective servers for a role (including inherited)
   */
  getEffectiveServers(roleId: string): string[] {
    const chain = this.getInheritanceChain(roleId);
    const servers = new Set<string>();

    for (const id of chain) {
      const role = this.roles.get(id);
      if (role) {
        for (const server of role.allowedServers) {
          servers.add(server);
        }
      }
    }

    return Array.from(servers);
  }

  /**
   * Get effective tool permissions for a role (including inherited)
   * Child permissions take precedence over parent
   */
  getEffectiveToolPermissions(roleId: string): ToolPermissions {
    const chain = this.getInheritanceChain(roleId);

    // Start with empty permissions and merge from root to child
    const effective: ToolPermissions = {
      allow: [],
      deny: [],
      allowPatterns: [],
      denyPatterns: []
    };

    // Reverse chain to process from root to child (child overrides parent)
    for (const id of chain.reverse()) {
      const role = this.roles.get(id);
      if (role?.toolPermissions) {
        const perms = role.toolPermissions;

        // Merge arrays (child additions are appended)
        if (perms.allow) effective.allow!.push(...perms.allow);
        if (perms.deny) effective.deny!.push(...perms.deny);
        if (perms.allowPatterns) effective.allowPatterns!.push(...perms.allowPatterns);
        if (perms.denyPatterns) effective.denyPatterns!.push(...perms.denyPatterns);
      }
    }

    return effective;
  }

  // ============================================================================
  // Permission Checking
  // ============================================================================

  /**
   * Check if a server is allowed for a role (including inherited permissions)
   */
  isServerAllowedForRole(roleId: string, serverName: string): boolean {
    const effectiveServers = this.getEffectiveServers(roleId);

    // Wildcard allows all servers
    if (effectiveServers.includes('*')) return true;

    return effectiveServers.includes(serverName);
  }

  /**
   * Check if a tool is allowed for a role (including inherited permissions)
   */
  isToolAllowedForRole(roleId: string, toolName: string, serverName: string): boolean {
    // System tools are always allowed
    const SYSTEM_TOOLS = ['set_role'];
    if (SYSTEM_TOOLS.includes(toolName)) {
      return true;
    }

    const role = this.roles.get(roleId);
    if (!role) return false;

    // Check server access first (uses inheritance)
    if (!this.isServerAllowedForRole(roleId, serverName)) {
      return false;
    }

    // Get effective permissions (merged with inherited roles)
    const permissions = this.getEffectiveToolPermissions(roleId);

    // If no effective permissions defined, allow all tools from allowed servers
    const hasPermissions = (permissions.allow?.length ?? 0) > 0 ||
                          (permissions.deny?.length ?? 0) > 0 ||
                          (permissions.allowPatterns?.length ?? 0) > 0 ||
                          (permissions.denyPatterns?.length ?? 0) > 0;

    if (!hasPermissions) {
      return true;
    }

    // Check explicit deny list (deny takes precedence)
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

    // Default: deny if not explicitly allowed
    return false;
  }

  /**
   * Match a string against a pattern (supports * wildcard)
   */
  private matchPattern(str: string, pattern: string): boolean {
    // Direct match
    if (str === pattern) return true;

    // Wildcard matching
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp(`^${regexPattern}$`).test(str);
    }

    return false;
  }

  // ============================================================================
  // Memory Permission Checking
  // ============================================================================

  /**
   * Get memory permission for a role (direct, without inheritance)
   * Returns 'none' if no memory skill is granted
   */
  getMemoryPermission(roleId: string): RoleMemoryPermission {
    const permission = this.memoryPermissions.get(roleId);
    if (!permission) {
      return { policy: 'none' };
    }
    return permission;
  }

  /**
   * Get effective memory permission for a role (including inherited)
   * Returns the highest privilege from the inheritance chain
   * Priority: all > team > isolated > none
   */
  getEffectiveMemoryPermission(roleId: string): RoleMemoryPermission {
    const chain = this.getInheritanceChain(roleId);

    if (chain.length === 0) {
      // Circular inheritance detected, return no access
      return { policy: 'none' };
    }

    const policyOrder: MemoryPolicy[] = ['none', 'isolated', 'team', 'all'];
    let highestPermission: RoleMemoryPermission = { policy: 'none' };
    let highestIndex = 0;
    const mergedTeamRoles = new Set<string>();

    for (const id of chain) {
      const permission = this.memoryPermissions.get(id);
      if (permission) {
        const currentIndex = policyOrder.indexOf(permission.policy);

        // Collect team roles from all 'team' policies in chain
        if (permission.policy === 'team' && permission.teamRoles) {
          for (const teamRole of permission.teamRoles) {
            mergedTeamRoles.add(teamRole);
          }
        }

        // Higher privilege wins
        if (currentIndex > highestIndex) {
          highestIndex = currentIndex;
          highestPermission = { ...permission };
        }
      }
    }

    // If effective policy is 'team', merge all teamRoles from chain
    if (highestPermission.policy === 'team') {
      highestPermission.teamRoles = Array.from(mergedTeamRoles);
    }

    return highestPermission;
  }

  /**
   * Check if a role has memory access
   */
  hasMemoryAccess(roleId: string): boolean {
    const permission = this.getMemoryPermission(roleId);
    return permission.policy !== 'none';
  }

  /**
   * Check if a role can access another role's memory
   */
  canAccessRoleMemory(accessorRoleId: string, targetRoleId: string): boolean {
    const permission = this.getMemoryPermission(accessorRoleId);

    switch (permission.policy) {
      case 'none':
        return false;
      case 'isolated':
        return accessorRoleId === targetRoleId;
      case 'team':
        return accessorRoleId === targetRoleId ||
               (permission.teamRoles?.includes(targetRoleId) ?? false);
      case 'all':
        return true;
      default:
        return false;
    }
  }

  /**
   * Check if a role can access all memories (admin-level access)
   */
  canAccessAllMemories(roleId: string): boolean {
    const permission = this.getMemoryPermission(roleId);
    return permission.policy === 'all';
  }

  /**
   * Set memory permission for a role (used during skill loading)
   */
  setMemoryPermission(roleId: string, permission: RoleMemoryPermission): void {
    // Higher privilege wins: all > team > isolated > none
    const existing = this.memoryPermissions.get(roleId);
    if (existing) {
      const policyOrder: MemoryPolicy[] = ['none', 'isolated', 'team', 'all'];
      const existingIndex = policyOrder.indexOf(existing.policy);
      const newIndex = policyOrder.indexOf(permission.policy);

      if (newIndex <= existingIndex) {
        // Keep existing higher privilege
        // But merge team roles if both are 'team'
        if (existing.policy === 'team' && permission.policy === 'team') {
          const mergedTeamRoles = new Set([
            ...(existing.teamRoles || []),
            ...(permission.teamRoles || [])
          ]);
          existing.teamRoles = Array.from(mergedTeamRoles);
        }
        return;
      }
    }

    this.memoryPermissions.set(roleId, permission);
    this.logger.debug(`Set memory permission for role ${roleId}: ${permission.policy}`);
  }

  // ============================================================================
  // List Roles
  // ============================================================================

  /**
   * List all available roles
   */
  listRoles(options?: ListRolesOptions, currentRoleId?: string | null): ListRolesResult {
    const { includeInactive = false } = options || {};

    const roles: ListRolesResult['roles'] = [];

    for (const role of this.roles.values()) {
      const isActive = role.metadata?.active !== false;
      if (!isActive && !includeInactive) continue;

      roles.push({
        id: role.id,
        name: role.name,
        description: role.description,
        serverCount: role.allowedServers.length,
        toolCount: role.toolPermissions?.allowPatterns?.length || 0,
        skills: (role.metadata?.skills as string[]) || [],
        isActive,
        isCurrent: role.id === currentRoleId
      });
    }

    return {
      roles,
      defaultRole: this.defaultRole,
      currentRole: currentRoleId || null
    };
  }

  // ============================================================================
  // Skill-Driven Role Generation
  // ============================================================================

  /**
   * Generate role manifest from skill manifest
   */
  generateRoleManifest(manifest: SkillManifest): RoleManifest {
    const roles: Record<string, DynamicRole> = {};

    for (const skill of manifest.skills) {
      for (const roleId of skill.allowedRoles) {
        // Skip wildcard - not supported
        if (roleId === '*') {
          this.logger.warn(`Wildcard (*) in allowedRoles is not supported, skipping in skill: ${skill.id}`);
          continue;
        }

        if (!roles[roleId]) {
          roles[roleId] = {
            id: roleId,
            skills: [],
            tools: []
          };
        }

        // Add skill to role
        if (!roles[roleId].skills.includes(skill.id)) {
          roles[roleId].skills.push(skill.id);
        }

        // Add tools to role (deduplicated)
        for (const tool of skill.allowedTools) {
          if (!roles[roleId].tools.includes(tool)) {
            roles[roleId].tools.push(tool);
          }
        }
      }
    }

    this.logger.info(`Generated role manifest from ${manifest.skills.length} skills`, {
      roleCount: Object.keys(roles).length,
      roles: Object.keys(roles)
    });

    return {
      roles,
      sourceVersion: manifest.version,
      generatedAt: new Date()
    };
  }

  /**
   * Load roles from skill manifest
   */
  async loadFromSkillManifest(manifest: SkillManifest): Promise<void> {
    const roleManifest = this.generateRoleManifest(manifest);

    this.roles.clear();
    this.memoryPermissions.clear();

    // Extract memory grants from skills
    for (const skill of manifest.skills) {
      if (skill.grants?.memory && skill.grants.memory !== 'none') {
        for (const roleId of skill.allowedRoles) {
          if (roleId === '*') {
            // Wildcard not supported
            continue;
          }
          this.setMemoryPermission(roleId, {
            policy: skill.grants.memory,
            teamRoles: skill.grants.memoryTeamRoles
          });
        }
      }
    }

    for (const [roleId, dynamicRole] of Object.entries(roleManifest.roles)) {
      const role: Role = {
        id: roleId,
        name: roleId.charAt(0).toUpperCase() + roleId.slice(1),
        description: `Dynamic role with access to: ${dynamicRole.skills.join(', ')}`,
        allowedServers: this.extractServersFromTools(dynamicRole.tools),
        systemInstruction: this.generateRoleInstruction(roleId, dynamicRole),
        toolPermissions: {
          allowPatterns: dynamicRole.tools
        },
        metadata: {
          active: true,
          tags: ['dynamic', 'skill-driven'],
          skills: dynamicRole.skills
        }
      };

      this.roles.set(roleId, role);

      const memPerm = this.getMemoryPermission(roleId);
      this.logger.debug(`Created dynamic role: ${roleId}`, {
        skills: dynamicRole.skills.length,
        tools: dynamicRole.tools.length,
        memoryPolicy: memPerm.policy
      });
    }

    if (this.roles.size > 0 && !this.roles.has(this.defaultRole)) {
      this.defaultRole = Array.from(this.roles.keys())[0];
    }

    this.logger.info(`Loaded ${this.roles.size} roles from skill manifest`);
  }

  // ============================================================================
  // Tool/Server Extraction
  // ============================================================================

  /**
   * Extract server name from MCP tool name
   * Format: mcp__plugin_<plugin>_<server>__<tool> or server__tool
   */
  static extractServerFromTool(tool: string): string | null {
    // MCP format: mcp__plugin_xxx_servername__toolname
    const match = tool.match(/^mcp__plugin_[^_]+_([^_]+)__/);
    if (match) {
      return match[1];
    }
    // Simple format: servername__toolname
    const simpleMatch = tool.match(/^([^_]+)__/);
    if (simpleMatch) {
      return simpleMatch[1];
    }
    return null;
  }

  /**
   * Extract server names from tool list
   */
  private extractServersFromTools(tools: string[]): string[] {
    const servers = new Set<string>();
    for (const tool of tools) {
      const server = RoleManager.extractServerFromTool(tool);
      if (server) {
        servers.add(server);
      }
    }
    return Array.from(servers);
  }

  /**
   * Generate system instruction for a role
   */
  private generateRoleInstruction(roleId: string, role: DynamicRole): string {
    return `# ${roleId.charAt(0).toUpperCase() + roleId.slice(1)} Role

You are operating as the ${roleId} role with access to the following skills:
${role.skills.map(s => `- ${s}`).join('\n')}

Available tools are filtered based on your role.`;
  }

  /**
   * Get skills for a role
   */
  getSkillsForRole(roleId: string): string[] {
    const role = this.roles.get(roleId);
    if (!role || !role.metadata?.tags?.includes('skill-driven')) {
      return [];
    }
    return role.toolPermissions?.allowPatterns || [];
  }

  /**
   * Check if a tool is defined in any skill's allowedTools
   * Used to validate that router-level tools are skill-driven
   */
  isToolDefinedInAnySkill(toolName: string): boolean {
    for (const role of this.roles.values()) {
      const allowPatterns = role.toolPermissions?.allowPatterns || [];
      if (allowPatterns.includes(toolName)) {
        return true;
      }
      // Also check pattern matching
      for (const pattern of allowPatterns) {
        if (this.matchPattern(toolName, pattern)) {
          return true;
        }
      }
    }
    return false;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a RoleManager instance
 */
export function createRoleManager(logger: Logger): RoleManager {
  return new RoleManager(logger);
}
