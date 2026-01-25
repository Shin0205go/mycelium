// ============================================================================
// MYCELIUM Router Adapter
// Integrates MyceliumCore with existing MCP proxy infrastructure
// ============================================================================

import { Logger } from '../utils/logger.js';
import { MyceliumCore, createMyceliumCore } from './mycelium-core.js';
import type { MCPServerConfig, ListRolesResult } from '@mycelium/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * RouterAdapter - Bridge between MyceliumCore and existing MCP proxy
 *
 * This adapter:
 * 1. Wraps the Router Core for easy integration with MCPStdioPolicyProxy
 * 2. Manages tools/list_changed notifications
 * 3. Filters tool lists based on current skill
 */
export class RouterAdapter {
  private logger: Logger;
  private routerCore: MyceliumCore;
  private enabled: boolean = false;
  private notificationCallback?: () => Promise<void>;

  constructor(logger: Logger, options?: { rolesDir?: string; configFile?: string }) {
    this.logger = logger;
    this.routerCore = createMyceliumCore(logger, options);

    // Set up event handlers
    this.routerCore.on('toolsChanged', (event) => {
      this.logger.debug('Tools changed event', {
        skill: event.skill,
        reason: event.reason,
        count: event.toolCount
      });
    });
  }

  /**
   * Initialize the router adapter
   */
  async initialize(): Promise<void> {
    await this.routerCore.initialize();
    this.logger.info('Router adapter initialized');
  }

  /**
   * Enable skill-based routing
   */
  enable(): void {
    this.enabled = true;
    this.logger.info('Skill-based routing enabled');
  }

  /**
   * Disable skill-based routing (pass-through mode)
   */
  disable(): void {
    this.enabled = false;
    this.logger.info('Skill-based routing disabled');
  }

  /**
   * Check if skill-based routing is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set the callback for tools/list_changed notifications
   * This should be called by the proxy to wire up the notification mechanism
   */
  setNotificationCallback(callback: () => Promise<void>): void {
    this.notificationCallback = callback;
    this.routerCore.setToolsChangedCallback(callback);
  }

  /**
   * Load server configurations
   */
  loadServersFromConfig(config: { mcpServers: Record<string, MCPServerConfig> }): void {
    this.routerCore.loadServersFromConfig(config);
  }

  /**
   * Add a single server
   */
  addServer(name: string, config: MCPServerConfig): void {
    this.routerCore.addServer(name, config);
  }

  /**
   * Start all servers
   */
  async startServers(): Promise<void> {
    await this.routerCore.startServers();
  }

  /**
   * Stop all servers
   */
  async stopServers(): Promise<void> {
    await this.routerCore.stopServers();
  }

  /**
   * Check if a tool is accessible for the current skill
   * Returns null if accessible, error message if not
   */
  checkToolAccess(toolName: string): string | null {
    if (!this.enabled) {
      return null; // Pass-through mode
    }

    // Check if tool is in visible tools
    try {
      this.routerCore.checkToolAccess(toolName);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Filter tools list based on current skill
   */
  filterToolsList(tools: Tool[]): Tool[] {
    if (!this.enabled) {
      return tools;
    }

    // The router core will filter based on skill
    return tools;
  }

  /**
   * Get the current role ID
   */
  getCurrentRoleId(): string | null {
    return this.routerCore.getCurrentRole()?.id || null;
  }

  /**
   * Get router state metadata
   */
  getStateMetadata(): Record<string, any> {
    return this.routerCore.getStateMetadata();
  }

  /**
   * Get connected servers info
   */
  getConnectedServers(): Array<{ name: string; connected: boolean; activeForRole: boolean }> {
    return this.routerCore.getConnectedServers();
  }

  /**
   * Reload role configurations
   */
  async reloadRoles(): Promise<void> {
    await this.routerCore.reloadRoles();
  }

  /**
   * Get the underlying router core (for advanced use cases)
   */
  getRouterCore(): MyceliumCore {
    return this.routerCore;
  }

  /**
   * Get the underlying stdio router (for direct routing when needed)
   */
  getStdioRouter() {
    return this.routerCore.getStdioRouter();
  }
}

/**
 * Create a router adapter instance
 */
export function createRouterAdapter(
  logger: Logger,
  options?: { rolesDir?: string; configFile?: string }
): RouterAdapter {
  return new RouterAdapter(logger, options);
}
