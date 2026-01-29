// ============================================================================
// MYCELIUM RBAC - Tool Visibility Manager
// Manages tool discovery and role-based visibility filtering
// ============================================================================

import type { Logger, Role, ToolInfo, MemoryPolicy, SkillDefinition } from '@mycelium/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { RoleManager } from './role-manager.js';

/**
 * Options for ToolVisibilityManager
 */
export interface ToolVisibilityOptions {
  /** Initial skill definitions */
  skillDefinitions?: SkillDefinition[];
}

/**
 * Tool Visibility Manager
 * Handles tool discovery, filtering, and access control based on roles
 */
export class ToolVisibilityManager {
  private logger: Logger;
  private roleManager: RoleManager;

  // All discovered tools (unfiltered)
  private allTools: Map<string, ToolInfo> = new Map();

  // Currently visible tools (filtered by role + skills)
  private visibleTools: Map<string, ToolInfo> = new Map();

  // Current role reference
  private currentRole: Role | null = null;

  // Active skills for skill-based filtering
  private activeSkills: string[] = [];

  // Skill definitions for tool filtering
  private skillDefinitions: Map<string, SkillDefinition> = new Map();

  // Whether skill-based filtering is enabled
  private skillFilteringEnabled: boolean = false;

  constructor(logger: Logger, roleManager: RoleManager, options?: ToolVisibilityOptions) {
    this.logger = logger;
    this.roleManager = roleManager;

    // Load initial skill definitions if provided
    if (options?.skillDefinitions) {
      this.loadSkillDefinitions(options.skillDefinitions);
    }

    this.logger.debug('ToolVisibilityManager initialized');
  }

  // ============================================================================
  // Skill Management
  // ============================================================================

  /**
   * Load skill definitions for skill-based filtering
   */
  loadSkillDefinitions(skills: SkillDefinition[]): void {
    this.skillDefinitions.clear();
    for (const skill of skills) {
      this.skillDefinitions.set(skill.id, skill);
    }
    this.logger.info(`Loaded ${skills.length} skill definitions`);
  }

  /**
   * Set active skills and refilter visible tools
   * Returns the change in visible tools
   */
  setActiveSkills(skillIds: string[]): { added: string[]; removed: string[]; activeSkills: string[] } {
    const previousVisibleTools = new Set(this.visibleTools.keys());

    this.activeSkills = [...skillIds];
    this.skillFilteringEnabled = skillIds.length > 0;

    this.updateVisibleTools();

    const currentVisibleTools = new Set(this.visibleTools.keys());
    const added = [...currentVisibleTools].filter(t => !previousVisibleTools.has(t));
    const removed = [...previousVisibleTools].filter(t => !currentVisibleTools.has(t));

    this.logger.info(`Active skills updated: [${skillIds.join(', ')}], tools: +${added.length}/-${removed.length}`);

    return { added, removed, activeSkills: this.activeSkills };
  }

  /**
   * Get current active skills
   */
  getActiveSkills(): string[] {
    return [...this.activeSkills];
  }

  /**
   * Add a skill to active skills
   */
  addActiveSkill(skillId: string): { added: string[]; removed: string[]; activeSkills: string[] } {
    if (this.activeSkills.includes(skillId)) {
      return { added: [], removed: [], activeSkills: this.activeSkills };
    }
    return this.setActiveSkills([...this.activeSkills, skillId]);
  }

  /**
   * Remove a skill from active skills
   */
  removeActiveSkill(skillId: string): { added: string[]; removed: string[]; activeSkills: string[] } {
    if (!this.activeSkills.includes(skillId)) {
      return { added: [], removed: [], activeSkills: this.activeSkills };
    }
    return this.setActiveSkills(this.activeSkills.filter(id => id !== skillId));
  }

  /**
   * Get allowed tools from active skills (merged)
   */
  private getAllowedToolsFromSkills(): Set<string> {
    const allowedTools = new Set<string>();

    for (const skillId of this.activeSkills) {
      const skill = this.skillDefinitions.get(skillId);
      if (skill?.allowedTools) {
        for (const tool of skill.allowedTools) {
          allowedTools.add(tool);
        }
      }
    }

    return allowedTools;
  }

  // ============================================================================
  // Tool Discovery
  // ============================================================================

  /**
   * Register tools discovered from a server
   */
  registerTools(tools: Tool[], sourceServer: string): void {
    for (const tool of tools) {
      const toolInfo: ToolInfo = {
        tool,
        sourceServer,
        prefixedName: tool.name,
        visible: true,
        visibilityReason: 'discovered'
      };
      this.allTools.set(tool.name, toolInfo);
    }

    this.logger.debug(`Registered ${tools.length} tools from ${sourceServer}`);
  }

  /**
   * Register all tools from a raw tools list response
   */
  registerToolsFromList(toolsList: Tool[]): void {
    this.allTools.clear();

    for (const tool of toolsList) {
      const { serverName } = this.parseToolName(tool.name);

      const toolInfo: ToolInfo = {
        tool,
        sourceServer: serverName,
        prefixedName: tool.name,
        visible: true,
        visibilityReason: 'discovered'
      };

      this.allTools.set(tool.name, toolInfo);
    }

    this.logger.info(`Registered ${this.allTools.size} tools from upstream servers`);
  }

  /**
   * Clear all registered tools
   */
  clearTools(): void {
    this.allTools.clear();
    this.visibleTools.clear();
  }

  // ============================================================================
  // Role-based Filtering
  // ============================================================================

  /**
   * Update the current role and refilter visible tools
   */
  setCurrentRole(role: Role | null): { added: string[]; removed: string[] } {
    const previousVisibleTools = new Set(this.visibleTools.keys());
    this.currentRole = role;

    this.updateVisibleTools();

    const currentVisibleTools = new Set(this.visibleTools.keys());
    const added = [...currentVisibleTools].filter(t => !previousVisibleTools.has(t));
    const removed = [...previousVisibleTools].filter(t => !currentVisibleTools.has(t));

    return { added, removed };
  }

  /**
   * Update visible tools based on current role AND active skills
   * Filtering: Role permissions ∩ Skill allowedTools = Visible tools
   */
  private updateVisibleTools(): void {
    this.visibleTools.clear();

    const roleId = this.currentRole?.id || 'none';
    const allowedServers = this.currentRole?.allowedServers || [];
    const skillAllowedTools = this.skillFilteringEnabled ? this.getAllowedToolsFromSkills() : null;

    this.logger.debug(`Filtering tools for role: ${roleId}, skills: [${this.activeSkills.join(', ')}]`);

    let roleFilteredCount = 0;
    let skillFilteredCount = 0;

    for (const [name, toolInfo] of this.allTools) {
      // Step 1: Role-based filtering
      const isRoleAllowed = this.isToolVisibleForRole(toolInfo);
      if (!isRoleAllowed) {
        toolInfo.visible = false;
        toolInfo.visibilityReason = 'role_restricted';
        roleFilteredCount++;
        continue;
      }

      // Step 2: Skill-based filtering (if enabled)
      if (skillAllowedTools !== null) {
        const isSkillAllowed = this.isToolAllowedBySkills(toolInfo.prefixedName, skillAllowedTools);
        if (!isSkillAllowed) {
          toolInfo.visible = false;
          toolInfo.visibilityReason = 'skill_restricted';
          skillFilteredCount++;
          continue;
        }
      }

      // Tool is visible (passed both filters)
      toolInfo.visible = true;
      toolInfo.visibilityReason = this.skillFilteringEnabled ? 'role_and_skill_permitted' : 'role_permitted';
      this.visibleTools.set(name, toolInfo);
    }

    this.logger.debug(
      `Filtered: role=${roleFilteredCount}, skill=${skillFilteredCount}, visible=${this.visibleTools.size}`
    );

    // Always add the set_role system tool
    this.addSystemTool();
  }

  /**
   * Check if a tool is visible for the current role (role-level only)
   */
  private isToolVisibleForRole(toolInfo: ToolInfo): boolean {
    if (!this.currentRole) {
      return true; // No role = show all
    }

    // Check server access first
    if (!this.isServerAllowed(toolInfo.sourceServer)) {
      return false;
    }

    // Check tool-level permissions via RoleManager
    return this.roleManager.isToolAllowedForRole(
      this.currentRole.id,
      toolInfo.prefixedName,
      toolInfo.sourceServer
    );
  }

  /**
   * Check if a tool is allowed by active skills
   * Supports exact match and wildcard patterns (e.g., "filesystem__*")
   */
  private isToolAllowedBySkills(toolName: string, skillAllowedTools: Set<string>): boolean {
    // Exact match
    if (skillAllowedTools.has(toolName)) {
      return true;
    }

    // Check wildcard patterns
    for (const pattern of skillAllowedTools) {
      if (pattern.endsWith('__*')) {
        // Server wildcard: e.g., "filesystem__*" matches "filesystem__read_file"
        const prefix = pattern.slice(0, -1); // Remove "*"
        if (toolName.startsWith(prefix)) {
          return true;
        }
      } else if (pattern === '*') {
        // Universal wildcard
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a server is allowed for current role
   */
  private isServerAllowed(serverName: string): boolean {
    if (!this.currentRole) {
      return true;
    }

    // Wildcard allows all servers
    if (this.currentRole.allowedServers.includes('*')) {
      return true;
    }

    return this.currentRole.allowedServers.includes(serverName);
  }

  /**
   * Add system tools (memory tools are permission-based)
   */
  private addSystemTool(): void {
    // Check if current role has memory permission
    const roleId = this.currentRole?.id;
    const hasMemoryAccess = roleId ? this.roleManager.hasMemoryAccess(roleId) : false;

    if (!hasMemoryAccess) {
      this.logger.debug(`Role ${roleId || 'none'} does not have memory access, memory tools hidden`);
      return;
    }

    // Get memory policy details for tool descriptions
    const memoryPermission = roleId ? this.roleManager.getMemoryPermission(roleId) : { policy: 'none' as MemoryPolicy };
    const canAccessAll = this.roleManager.canAccessAllMemories(roleId || '');

    // save_memory tool
    const saveMemoryTool: Tool = {
      name: 'save_memory',
      description: 'Save information to the current role\'s memory. Memory is persistent and isolated per role.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string',
            description: 'The content to remember'
          },
          type: {
            type: 'string',
            enum: ['fact', 'preference', 'context', 'episode', 'learned'],
            description: 'Type of memory: fact (knowledge), preference (settings), context (situation), episode (event), learned (pattern)',
            default: 'context'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for categorization'
          },
          source: {
            type: 'string',
            description: 'Source of this memory (e.g., "user", "agent", "tool")'
          }
        },
        required: ['content']
      }
    };

    // recall_memory tool - description varies by permission
    const recallDescription = canAccessAll
      ? 'Search and retrieve memories. You have full access to all roles\' memories. Use all_roles=true to search across all roles.'
      : memoryPermission.policy === 'team'
        ? `Search and retrieve memories from your role and team roles: ${memoryPermission.teamRoles?.join(', ') || 'none'}.`
        : 'Search and retrieve memories from your role\'s memory store.';

    const recallMemoryTool: Tool = {
      name: 'recall_memory',
      description: recallDescription,
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Text to search for in memories'
          },
          type: {
            type: 'string',
            enum: ['fact', 'preference', 'context', 'episode', 'learned'],
            description: 'Filter by memory type'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags (any match)'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)'
          },
          ...(canAccessAll ? {
            all_roles: {
              type: 'boolean',
              description: 'Search across all roles\' memories'
            }
          } : {})
        }
      }
    };

    // list_memories tool - description varies by permission
    const listDescription = canAccessAll
      ? 'Get memory statistics. You have full access. Use all_roles=true to see all roles.'
      : 'Get statistics about your role\'s memory store.';

    const listMemoriesTool: Tool = {
      name: 'list_memories',
      description: listDescription,
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...(canAccessAll ? {
            role_id: {
              type: 'string',
              description: 'Role ID to check (defaults to current role)'
            },
            all_roles: {
              type: 'boolean',
              description: 'Show statistics for all roles'
            }
          } : {})
        }
      }
    };

    // Register memory tools
    const memoryTools = [
      { tool: saveMemoryTool, name: 'save_memory' },
      { tool: recallMemoryTool, name: 'recall_memory' },
      { tool: listMemoriesTool, name: 'list_memories' }
    ];

    for (const { tool, name } of memoryTools) {
      const toolInfo: ToolInfo = {
        tool,
        sourceServer: 'mycelium-router',
        prefixedName: name,
        visible: true,
        visibilityReason: `memory_granted:${memoryPermission.policy}`
      };
      this.visibleTools.set(name, toolInfo);
    }

    this.logger.debug(`Added memory tools for role ${roleId} with policy: ${memoryPermission.policy}`);
  }

  // ============================================================================
  // Access Control
  // ============================================================================

  // Memory tools (only visible if role has memory permission)
  private static readonly MEMORY_TOOLS = ['save_memory', 'recall_memory', 'list_memories'];

  /**
   * Check if a tool is accessible (throws if not)
   */
  checkAccess(toolName: string): void {
    // Memory tools require memory permission
    if (ToolVisibilityManager.MEMORY_TOOLS.includes(toolName)) {
      const roleId = this.currentRole?.id;
      if (!roleId || !this.roleManager.hasMemoryAccess(roleId)) {
        throw new Error(
          `Tool '${toolName}' requires memory access. ` +
          `Role '${roleId || 'none'}' does not have memory permission. ` +
          `Memory access must be granted via a skill.`
        );
      }
      return;
    }

    if (!this.visibleTools.has(toolName)) {
      const roleId = this.currentRole?.id || 'none';
      throw new Error(
        `Tool '${toolName}' is not accessible for role '${roleId}'. Check available tools for your skill.`
      );
    }
  }

  /**
   * Check if a tool is visible (returns boolean)
   */
  isVisible(toolName: string): boolean {
    // Memory tools are visible only if role has memory permission
    if (ToolVisibilityManager.MEMORY_TOOLS.includes(toolName)) {
      const roleId = this.currentRole?.id;
      return roleId ? this.roleManager.hasMemoryAccess(roleId) : false;
    }

    return this.visibleTools.has(toolName);
  }

  // ============================================================================
  // Tool List Access
  // ============================================================================

  /**
   * Get all visible tools as Tool array
   */
  getVisibleTools(): Tool[] {
    return Array.from(this.visibleTools.values()).map(info => info.tool);
  }

  /**
   * Get visible tools with metadata
   */
  getVisibleToolsInfo(): ToolInfo[] {
    return Array.from(this.visibleTools.values());
  }

  /**
   * Get visible tools count
   */
  getVisibleCount(): number {
    return this.visibleTools.size;
  }

  /**
   * Get all registered tools count
   */
  getTotalCount(): number {
    return this.allTools.size;
  }

  /**
   * Get tool info by name
   */
  getToolInfo(toolName: string): ToolInfo | undefined {
    return this.visibleTools.get(toolName) || this.allTools.get(toolName);
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Parse a prefixed tool name into server and original name
   */
  parseToolName(prefixedName: string): { serverName: string; originalName: string } {
    const parts = prefixedName.split('__');
    if (parts.length >= 2) {
      return {
        serverName: parts[0],
        originalName: parts.slice(1).join('__')
      };
    }
    return {
      serverName: 'unknown',
      originalName: prefixedName
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createToolVisibilityManager(
  logger: Logger,
  roleManager: RoleManager,
  options?: ToolVisibilityOptions
): ToolVisibilityManager {
  return new ToolVisibilityManager(logger, roleManager, options);
}
