// ============================================================================
// Tool Registry - Tool Discovery and Registration
// ============================================================================

import { Logger } from '../utils/logger.js';
import { ToolVisibilityManager, RoleManager } from '../rbac/index.js';
import { ServerManager } from './server-manager.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Role } from '@mycelium/shared';

/**
 * Router-level tool definitions
 * These are tools provided by mycelium-router itself (not backend MCP servers)
 */
export const ROUTER_TOOLS: Tool[] = [
  {
    name: 'mycelium-router__get_context',
    description: 'Get current router context including active role, system instruction, available tools count, and connected servers. Use this to query current state without switching roles.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mycelium-router__list_roles',
    description: 'Get a list of available roles with their skills and capabilities',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mycelium-router__spawn_sub_agent',
    description: 'Spawn a sub-agent with a specific role to handle a task. The sub-agent runs independently with its own tools and capabilities based on the role. Use this to delegate specialized tasks to role-specific agents.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'The role for the sub-agent (e.g., "mentor", "frontend", "guest")',
        },
        task: {
          type: 'string',
          description: 'The task/prompt to send to the sub-agent',
        },
        model: {
          type: 'string',
          description: 'Optional: Model to use (default: claude-3-5-haiku-20241022)',
        },
        interactive: {
          type: 'boolean',
          description: 'If true, opens a new terminal window for interactive session with the sub-agent (macOS only)',
        },
      },
      required: ['role', 'task'],
    },
  },
];

/**
 * ToolRegistry handles tool discovery and registration
 * Extracted from MyceliumRouterCore for better separation of concerns
 */
export class ToolRegistry {
  private logger: Logger;
  private toolVisibility: ToolVisibilityManager;
  private roleManager: RoleManager;
  private serverManager: ServerManager;

  constructor(
    logger: Logger,
    toolVisibility: ToolVisibilityManager,
    roleManager: RoleManager,
    serverManager: ServerManager
  ) {
    this.logger = logger;
    this.toolVisibility = toolVisibility;
    this.roleManager = roleManager;
    this.serverManager = serverManager;
  }

  /**
   * Discover all tools from connected servers
   */
  async discoverAllTools(): Promise<void> {
    this.logger.debug('Discovering tools from all connected servers...');

    try {
      // Request tools list through the router
      const request = {
        jsonrpc: '2.0' as const,
        id: Date.now(),
        method: 'tools/list',
        params: {}
      };

      const response = await this.serverManager.routeRequest(request);

      if (response.result?.tools) {
        // Register all discovered tools with ToolVisibilityManager
        this.toolVisibility.registerToolsFromList(response.result.tools as Tool[]);

        // Register router-level tools only if defined in some skill (skill-driven RBAC)
        const skillDefinedRouterTools = ROUTER_TOOLS.filter(
          tool => this.roleManager.isToolDefinedInAnySkill(tool.name)
        );
        if (skillDefinedRouterTools.length > 0) {
          this.toolVisibility.registerTools(skillDefinedRouterTools, 'mycelium-router');
          this.logger.debug(`Registered ${skillDefinedRouterTools.length}/${ROUTER_TOOLS.length} router tools (skill-defined)`);
        }

        // Update server's tool list in connected servers state
        const connectedServers = this.serverManager.getConnectedServers();
        for (const tool of response.result.tools as Tool[]) {
          const { serverName } = this.toolVisibility.parseToolName(tool.name);
          const serverInfo = connectedServers.get(serverName);
          if (serverInfo) {
            serverInfo.tools.push(tool);
          }
        }

        this.logger.info(`Discovered ${this.toolVisibility.getTotalCount()} tools from upstream servers`);
      }
    } catch (error) {
      this.logger.error('Failed to discover tools:', error);
    }
  }

  /**
   * Get filtered tools list for current role
   */
  getFilteredToolsList(): { result: { tools: Tool[] } } {
    const tools = this.toolVisibility.getVisibleTools();
    return {
      result: {
        tools
      }
    };
  }

  /**
   * Check if a tool is accessible for the current role
   * Throws an error if access is denied
   */
  checkToolAccess(toolName: string): void {
    this.toolVisibility.checkAccess(toolName);
  }

  /**
   * Set current role and update visible tools
   */
  setCurrentRole(role: Role | null): { added: string[]; removed: string[] } {
    return this.toolVisibility.setCurrentRole(role);
  }

  /**
   * Get visible tools count
   */
  getVisibleToolsCount(): number {
    return this.toolVisibility.getVisibleCount();
  }

  /**
   * Get visible tools info for manifest building
   */
  getVisibleToolsInfo(): ReturnType<ToolVisibilityManager['getVisibleToolsInfo']> {
    return this.toolVisibility.getVisibleToolsInfo();
  }

  /**
   * Clear all registered tools
   */
  clearTools(): void {
    this.toolVisibility.clearTools();
  }

  /**
   * Get the underlying ToolVisibilityManager
   */
  getToolVisibility(): ToolVisibilityManager {
    return this.toolVisibility;
  }
}

/**
 * Factory function for ToolRegistry
 */
export function createToolRegistry(
  logger: Logger,
  toolVisibility: ToolVisibilityManager,
  roleManager: RoleManager,
  serverManager: ServerManager
): ToolRegistry {
  return new ToolRegistry(logger, toolVisibility, roleManager, serverManager);
}
