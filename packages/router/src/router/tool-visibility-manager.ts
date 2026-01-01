// ============================================================================
// AEGIS Router - Tool Visibility Manager
// Manages tool discovery and role-based visibility filtering
// ============================================================================

import { Logger } from '../utils/logger.js';
import { RoleManager } from './role-manager.js';
import type { Role, ToolInfo } from '../types/router-types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Tool Visibility Manager
 * Handles tool discovery, filtering, and access control based on roles
 */
export class ToolVisibilityManager {
  private logger: Logger;
  private roleManager: RoleManager;

  // All discovered tools (unfiltered)
  private allTools: Map<string, ToolInfo> = new Map();

  // Currently visible tools (filtered by role)
  private visibleTools: Map<string, ToolInfo> = new Map();

  // Current role reference
  private currentRole: Role | null = null;

  constructor(logger: Logger, roleManager: RoleManager) {
    this.logger = logger;
    this.roleManager = roleManager;
    this.logger.debug('ToolVisibilityManager initialized');
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
   * Update visible tools based on current role
   */
  private updateVisibleTools(): void {
    this.visibleTools.clear();

    const roleId = this.currentRole?.id || 'none';
    const allowedServers = this.currentRole?.allowedServers || [];
    this.logger.debug(`Filtering tools for role: ${roleId}, allowedServers: ${JSON.stringify(allowedServers)}`);

    let filteredCount = 0;
    for (const [name, toolInfo] of this.allTools) {
      const isVisible = this.isToolVisibleForRole(toolInfo);

      if (isVisible) {
        toolInfo.visible = true;
        toolInfo.visibilityReason = 'role_permitted';
        this.visibleTools.set(name, toolInfo);
      } else {
        toolInfo.visible = false;
        toolInfo.visibilityReason = 'role_restricted';
        filteredCount++;
      }
    }

    this.logger.debug(`Filtered out ${filteredCount} tools, ${this.visibleTools.size} visible`);

    // Always add the set_role system tool
    this.addSystemTool();
  }

  /**
   * Check if a tool is visible for the current role
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
   * Add system tools (always visible)
   */
  private addSystemTool(): void {
    // set_role tool
    const setRoleTool: Tool = {
      name: 'set_role',
      description: 'Switch to a specific role and get the system instruction and available tools for that role. ' +
        'Use this tool to change your operational context and capabilities.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          role_id: {
            type: 'string',
            description: 'The role ID to switch to. Use "list" to see available roles.'
          },
          includeToolDescriptions: {
            type: 'boolean',
            description: 'Whether to include full tool descriptions in the response',
            default: true
          }
        },
        required: ['role_id']
      }
    };

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

    // recall_memory tool
    const recallMemoryTool: Tool = {
      name: 'recall_memory',
      description: 'Search and retrieve memories from the current role\'s memory store.',
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
          }
        }
      }
    };

    // list_memories tool
    const listMemoriesTool: Tool = {
      name: 'list_memories',
      description: 'Get statistics about the current role\'s memory store.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          role_id: {
            type: 'string',
            description: 'Role ID to check (defaults to current role)'
          }
        }
      }
    };

    // Register all system tools
    const systemTools = [
      { tool: setRoleTool, name: 'set_role' },
      { tool: saveMemoryTool, name: 'save_memory' },
      { tool: recallMemoryTool, name: 'recall_memory' },
      { tool: listMemoriesTool, name: 'list_memories' }
    ];

    for (const { tool, name } of systemTools) {
      const toolInfo: ToolInfo = {
        tool,
        sourceServer: 'aegis-router',
        prefixedName: name,
        visible: true,
        visibilityReason: 'system_tool'
      };
      this.visibleTools.set(name, toolInfo);
    }
  }

  // ============================================================================
  // Access Control
  // ============================================================================

  // System tools that are always accessible
  private static readonly SYSTEM_TOOLS = ['set_role', 'save_memory', 'recall_memory', 'list_memories'];

  /**
   * Check if a tool is accessible (throws if not)
   */
  checkAccess(toolName: string): void {
    // System tools always accessible
    if (ToolVisibilityManager.SYSTEM_TOOLS.includes(toolName)) {
      return;
    }

    if (!this.visibleTools.has(toolName)) {
      const roleId = this.currentRole?.id || 'none';
      throw new Error(
        `Tool '${toolName}' is not accessible for role '${roleId}'. ` +
        `Use set_role to switch roles or check available tools.`
      );
    }
  }

  /**
   * Check if a tool is visible (returns boolean)
   */
  isVisible(toolName: string): boolean {
    return ToolVisibilityManager.SYSTEM_TOOLS.includes(toolName) || this.visibleTools.has(toolName);
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
  roleManager: RoleManager
): ToolVisibilityManager {
  return new ToolVisibilityManager(logger, roleManager);
}
