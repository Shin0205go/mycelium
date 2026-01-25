// ============================================================================
// Server Manager - MCP Server Connection Management
// ============================================================================

import { Logger } from '../utils/logger.js';
import { StdioRouter } from '../mcp/index.js';
import type { MCPServerConfig } from '@mycelium/shared';
import type { SubServerInfo } from '../types/router-types.js';
import type { Role } from '@mycelium/shared';

/**
 * ServerManager handles all MCP server connections
 * Extracted from MyceliumRouterCore for better separation of concerns
 */
export class ServerManager {
  private logger: Logger;
  private stdioRouter: StdioRouter;
  private connectedServers: Map<string, SubServerInfo> = new Map();

  constructor(logger: Logger, options?: { cwd?: string }) {
    this.logger = logger;
    this.stdioRouter = new StdioRouter(logger, { cwd: options?.cwd });
  }

  /**
   * Add a server from configuration
   */
  addServer(name: string, config: MCPServerConfig): void {
    this.stdioRouter.addServerFromConfig(name, config);
    this.logger.debug(`Added server configuration: ${name}`);
  }

  /**
   * Load servers from Claude Desktop config format
   */
  loadServersFromConfig(config: { mcpServers: Record<string, MCPServerConfig> }): void {
    this.stdioRouter.loadServersFromDesktopConfig(config);
    this.logger.info(`Loaded ${Object.keys(config.mcpServers).length} server configurations`);
  }

  /**
   * Start all configured servers
   */
  async startServers(): Promise<void> {
    this.logger.info('Starting upstream MCP servers...');
    await this.stdioRouter.startServers();
    await this.updateConnectedServersState();
    this.logger.info('All upstream servers started');
  }

  /**
   * Start servers required for a specific role (lazy loading)
   */
  async startServersForRole(role: Role): Promise<void> {
    const allowedServers = role.allowedServers;

    // If wildcard, start all servers
    if (allowedServers.includes('*')) {
      this.logger.info(`Role ${role.id} allows all servers, starting all...`);
      await this.startServers();
      return;
    }

    // Start only the required servers
    this.logger.info(`Starting servers for role ${role.id}: ${allowedServers.join(', ')}`);
    await this.stdioRouter.startServersByName(allowedServers);
    await this.updateConnectedServersState();
    this.logger.info(`Servers started for role ${role.id}`);
  }

  /**
   * Stop all servers
   */
  async stopServers(): Promise<void> {
    this.logger.info('Stopping upstream MCP servers...');
    await this.stdioRouter.stopServers();
    this.connectedServers.clear();
    this.logger.info('All upstream servers stopped');
  }

  /**
   * Update the connected servers state from StdioRouter
   */
  async updateConnectedServersState(currentRole?: Role | null): Promise<void> {
    const servers = this.stdioRouter.getAvailableServers();

    for (const server of servers) {
      const serverInfo: SubServerInfo = {
        name: server.name,
        connected: server.connected,
        activeForRole: this.isServerActiveForRole(server.name, currentRole),
        tools: [],
        lastActivity: new Date(),
        health: server.connected ? 'healthy' : 'unhealthy'
      };

      this.connectedServers.set(server.name, serverInfo);
    }

    this.logger.debug(`Updated ${this.connectedServers.size} server states`);
  }

  /**
   * Check if a server is active for a given role
   */
  isServerActiveForRole(serverName: string, role?: Role | null): boolean {
    if (!role) {
      return true; // No role = allow all
    }

    // Wildcard allows all servers
    if (role.allowedServers.includes('*')) {
      return true;
    }

    return role.allowedServers.includes(serverName);
  }

  /**
   * Update server activation status for a role
   */
  updateServerActivation(role: Role | null): void {
    for (const [serverName, serverInfo] of this.connectedServers) {
      serverInfo.activeForRole = this.isServerActiveForRole(serverName, role);
    }
  }

  /**
   * Get connected servers list
   */
  getConnectedServers(): Map<string, SubServerInfo> {
    return this.connectedServers;
  }

  /**
   * Get connected servers as array
   */
  getConnectedServersArray(): Array<{ name: string; connected: boolean; activeForRole: boolean }> {
    return Array.from(this.connectedServers.values()).map(s => ({
      name: s.name,
      connected: s.connected,
      activeForRole: s.activeForRole
    }));
  }

  /**
   * Get the underlying StdioRouter for direct access if needed
   */
  getStdioRouter(): StdioRouter {
    return this.stdioRouter;
  }

  /**
   * Route a request through StdioRouter
   */
  async routeRequest(request: any): Promise<any> {
    return await this.stdioRouter.routeRequest(request);
  }

  /**
   * Route to a specific server
   */
  async routeToServer(serverName: string, request: any): Promise<any> {
    return await this.stdioRouter.routeToServer(serverName, request);
  }
}

/**
 * Factory function for ServerManager
 */
export function createServerManager(
  logger: Logger,
  options?: { cwd?: string }
): ServerManager {
  return new ServerManager(logger, options);
}
