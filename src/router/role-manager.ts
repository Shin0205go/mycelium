// ============================================================================
// AEGIS Router - Role Manager
// Manages role definitions and permissions (skill-driven architecture)
// ============================================================================

import { Logger } from '../utils/logger.js';
import type {
  Role,
  ListRolesOptions,
  ListRolesResult,
  SkillManifest,
  DynamicRole,
  RoleManifest
} from '../types/router-types.js';

/**
 * Role Manager
 * Manages role definitions and permission checking (skill-driven architecture)
 */
export class RoleManager {
  private logger: Logger;
  private roles: Map<string, Role> = new Map();
  private defaultRole: string = 'default';
  private initialized: boolean = false;

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
  // Permission Checking
  // ============================================================================

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
    // System tools are always allowed
    const SYSTEM_TOOLS = ['set_role'];
    if (SYSTEM_TOOLS.includes(toolName)) {
      return true;
    }

    const role = this.roles.get(roleId);
    if (!role) return false;

    // Check server access first
    if (!this.isServerAllowedForRole(roleId, serverName)) {
      return false;
    }

    // If no tool permissions defined, allow all tools from allowed servers
    if (!role.toolPermissions) {
      return true;
    }

    const permissions = role.toolPermissions;

    // Check explicit deny list
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

    // Merge wildcard role into all other roles
    const wildcardRole = roles['__all__'];
    if (wildcardRole) {
      for (const roleId of Object.keys(roles)) {
        if (roleId !== '__all__') {
          for (const skill of wildcardRole.skills) {
            if (!roles[roleId].skills.includes(skill)) {
              roles[roleId].skills.push(skill);
            }
          }
          for (const tool of wildcardRole.tools) {
            if (!roles[roleId].tools.includes(tool)) {
              roles[roleId].tools.push(tool);
            }
          }
        }
      }
      delete roles['__all__'];
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
      this.logger.debug(`Created dynamic role: ${roleId}`, {
        skills: dynamicRole.skills.length,
        tools: dynamicRole.tools.length
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
