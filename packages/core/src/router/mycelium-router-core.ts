// ============================================================================
// MYCELIUM Router Core - Central Routing and Role Management
// The "司令塔" (command center) for multi-server MCP routing
// ============================================================================

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { RoleManager, createRoleManager, ToolVisibilityManager, createToolVisibilityManager, createRoleMemoryStore } from '../rbac/index.js';
import { ServerManager, createServerManager } from './server-manager.js';
import { ToolRegistry, createToolRegistry, ROUTER_TOOLS } from './tool-registry.js';
import { MemoryHandler, createMemoryHandler } from './memory-handler.js';
import type { MCPServerConfig } from '@mycelium/shared';
import type {
  Role,
  ListRolesResult,
  SkillManifest
} from '@mycelium/shared';
import type {
  MyceliumRouterState,
  AgentManifest,
  ManifestTool,
  RoleSwitchEvent,
  ToolsChangedEvent,
  SetRoleOptions
} from '../types/router-types.js';
import { v4 as uuidv4 } from 'uuid';

// Re-export ROUTER_TOOLS for backward compatibility
export { ROUTER_TOOLS };

/**
 * MyceliumRouterCore - Central routing system for MYCELIUM
 *
 * This class serves as the "司令塔" (command center) that:
 * 1. Manages connections to multiple sub-MCP servers
 * 2. Maintains a virtual tool table filtered by current role
 * 3. Handles role switching via set_role
 * 4. Emits notifications when tools change
 */
export class MyceliumRouterCore extends EventEmitter {
  private logger: Logger;
  private serverManager: ServerManager;
  private toolRegistry: ToolRegistry;
  private memoryHandler: MemoryHandler;
  private roleManager: RoleManager;
  private toolVisibility: ToolVisibilityManager;

  // Router state
  private state: MyceliumRouterState;

  // Notification callback for tools/list_changed
  private toolsChangedCallback?: () => Promise<void>;

  // Initialization state
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    logger: Logger,
    options?: {
      rolesDir?: string;
      configFile?: string;
      memoryDir?: string;
      cwd?: string;
    }
  ) {
    super();
    this.logger = logger;

    // Initialize role manager
    this.roleManager = createRoleManager(logger);

    // Initialize tool visibility manager
    this.toolVisibility = createToolVisibilityManager(logger, this.roleManager);

    // Initialize server manager
    this.serverManager = createServerManager(logger, { cwd: options?.cwd });

    // Initialize tool registry
    this.toolRegistry = createToolRegistry(
      logger,
      this.toolVisibility,
      this.roleManager,
      this.serverManager
    );

    // Initialize memory handler
    const memoryStore = createRoleMemoryStore(options?.memoryDir || './memory');
    this.memoryHandler = createMemoryHandler(logger, this.roleManager, memoryStore);

    // Initialize state
    this.state = {
      currentRole: null,
      availableRoles: new Map(),
      connectedServers: new Map(),
      visibleTools: new Map(),
      metadata: {
        initializedAt: new Date(),
        roleSwitchCount: 0,
        sessionId: uuidv4()
      }
    };

    this.logger.debug('MyceliumRouterCore created', {
      sessionId: this.state.metadata.sessionId
    });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the router core
   * Loads roles and prepares for connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Router core already initialized');
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    this.logger.info('Initializing MYCELIUM Router Core...');

    try {
      // Initialize role configuration
      await this.roleManager.initialize();

      // Initialize memory handler
      await this.memoryHandler.initialize();

      // Load roles into state
      const allRoles = this.roleManager.getAllRoles();
      for (const role of allRoles) {
        this.state.availableRoles.set(role.id, role);
      }

      this.logger.info(`Loaded ${this.state.availableRoles.size} roles`);

      // Set default role if available
      const defaultRole = this.roleManager.getDefaultRole();
      if (defaultRole) {
        this.state.currentRole = defaultRole;
        this.logger.info(`Default role set to: ${defaultRole.id}`);
      }

      this.initialized = true;
      this.logger.info('MYCELIUM Router Core initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize router core:', error);
      throw error;
    }
  }

  // ============================================================================
  // Server Management (delegated to ServerManager)
  // ============================================================================

  addServer(name: string, config: MCPServerConfig): void {
    this.serverManager.addServer(name, config);
  }

  loadServersFromConfig(config: { mcpServers: Record<string, MCPServerConfig> }): void {
    this.serverManager.loadServersFromConfig(config);
  }

  async startServers(): Promise<void> {
    await this.serverManager.startServers();

    // Sync connected servers to state
    this.state.connectedServers = this.serverManager.getConnectedServers();

    // Discover tools from all connected servers
    await this.toolRegistry.discoverAllTools();

    // Apply role-based filtering
    this.toolRegistry.setCurrentRole(this.state.currentRole);

    this.logger.info('All upstream servers started and tools discovered');
  }

  async startServersForRole(roleId: string): Promise<void> {
    const role = this.roleManager.getRole(roleId);
    if (!role) {
      this.logger.warn(`Role not found: ${roleId}`);
      return;
    }

    await this.serverManager.startServersForRole(role);

    // Sync state
    this.state.connectedServers = this.serverManager.getConnectedServers();

    // Discover tools
    await this.toolRegistry.discoverAllTools();
  }

  async stopServers(): Promise<void> {
    await this.serverManager.stopServers();
    this.state.connectedServers.clear();
    this.toolRegistry.clearTools();
    this.state.visibleTools.clear();
  }

  // ============================================================================
  // Role Loading from Skills Server
  // ============================================================================

  /**
   * Load roles dynamically from mycelium-skills MCP server
   * Calls list_skills and generates roles from skill definitions
   */
  async loadRolesFromSkillsServer(): Promise<boolean> {
    this.logger.info('🔄 Loading roles from mycelium-skills server...');

    try {
      // Call mycelium-skills list_skills tool
      const request = {
        jsonrpc: '2.0' as const,
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'mycelium-skills__list_skills',
          arguments: {}
        }
      };

      const response = await this.serverManager.routeRequest(request);

      // Parse the response
      const result = response?.result;
      if (!result?.content?.[0]?.text) {
        this.logger.warn('No skills returned from mycelium-skills server');
        return false;
      }

      const skillsData = JSON.parse(result.content[0].text);

      // Transform to SkillManifest format
      const skillsArray = skillsData.skills || skillsData;
      const skillManifest: SkillManifest = {
        skills: this.transformSkillsToDefinitions(skillsArray),
        version: '1.0.0',
        generatedAt: new Date()
      };

      if (skillManifest.skills.length === 0) {
        this.logger.warn('No skills with allowedRoles found');
        return false;
      }

      // Load roles from skill manifest
      await this.roleManager.loadFromSkillManifest(skillManifest);

      // Update state with new roles
      this.state.availableRoles.clear();
      const allRoles = this.roleManager.getAllRoles();
      for (const role of allRoles) {
        this.state.availableRoles.set(role.id, role);
      }

      // Set default role and apply tool filtering
      const defaultRole = this.roleManager.getDefaultRole();
      if (defaultRole) {
        this.state.currentRole = defaultRole;
        this.toolRegistry.setCurrentRole(defaultRole);
        this.logger.info(`Applied tool filtering for default role: ${defaultRole.id}`);
      }

      this.logger.info(`✅ Loaded ${this.state.availableRoles.size} roles from ${skillManifest.skills.length} skills`);
      return true;

    } catch (error) {
      this.logger.error('Failed to load roles from mycelium-skills server:', error);
      return false;
    }
  }

  private transformSkillsToDefinitions(skillsData: any[]): import('@mycelium/shared').BaseSkillDefinition[] {
    const definitions: import('@mycelium/shared').BaseSkillDefinition[] = [];

    for (const skill of skillsData) {
      if (!skill.allowedRoles || skill.allowedRoles.length === 0) {
        this.logger.debug(`Skipping skill ${skill.id}: no allowedRoles defined`);
        continue;
      }

      definitions.push({
        id: skill.id,
        displayName: skill.displayName || skill.id,
        description: skill.description || '',
        allowedRoles: skill.allowedRoles,
        allowedTools: skill.allowedTools || [],
        grants: skill.grants ? {
          memory: skill.grants.memory,
          memoryTeamRoles: skill.grants.memoryTeamRoles
        } : undefined,
        metadata: {
          version: skill.version,
          category: skill.category,
          tags: skill.tags
        }
      });
    }

    return definitions;
  }

  // ============================================================================
  // Role Switching (set_role)
  // ============================================================================

  /**
   * Execute set_role - the core role switching function
   */
  async setRole(options: SetRoleOptions): Promise<AgentManifest> {
    const { role: roleId, includeToolDescriptions = true } = options;

    this.logger.info(`🔄 Role switch requested: ${roleId}`);

    // Validate role exists
    const role = this.state.availableRoles.get(roleId);
    if (!role) {
      const availableRoles = Array.from(this.state.availableRoles.keys());
      throw new Error(
        `Role '${roleId}' not found. Available roles: ${availableRoles.join(', ')}`
      );
    }

    // Track previous role for notifications
    const previousRole = this.state.currentRole;

    // Update current role
    this.state.currentRole = role;
    this.state.metadata.lastRoleSwitch = new Date();
    this.state.metadata.roleSwitchCount++;

    // Update server activation status
    this.serverManager.updateServerActivation(role);
    this.state.connectedServers = this.serverManager.getConnectedServers();

    // Update visible tools based on new role
    const { added: addedTools, removed: removedTools } = this.toolRegistry.setCurrentRole(role);

    // Emit role switch event
    const switchEvent: RoleSwitchEvent = {
      type: 'role_switch',
      timestamp: new Date(),
      previousRole: previousRole?.id || null,
      newRole: role.id,
      addedTools,
      removedTools
    };
    this.emit('roleSwitch', switchEvent);

    // Send tools/list_changed notification to client
    if (addedTools.length > 0 || removedTools.length > 0) {
      await this.notifyToolsChanged();
    }

    // Build the manifest response
    const manifest = this.buildManifest(role, includeToolDescriptions);

    this.logger.info(`✅ Role activated: ${role.name}`, {
      toolCount: manifest.availableTools.length,
      serverCount: manifest.availableServers.length
    });

    return manifest;
  }

  private buildManifest(role: Role, includeToolDescriptions: boolean): AgentManifest {
    const availableTools: ManifestTool[] = [];

    for (const toolInfo of this.toolRegistry.getVisibleToolsInfo()) {
      const manifestTool: ManifestTool = {
        name: toolInfo.prefixedName,
        source: toolInfo.sourceServer
      };

      if (includeToolDescriptions && toolInfo.tool.description) {
        manifestTool.description = toolInfo.tool.description;
      }

      availableTools.push(manifestTool);
    }

    // Get active servers
    const activeServers: string[] = [];
    for (const [serverName, serverInfo] of this.state.connectedServers) {
      if (serverInfo.activeForRole && serverInfo.connected) {
        activeServers.push(serverName);
      }
    }

    return {
      role: {
        id: role.id,
        name: role.name,
        description: role.description
      },
      systemInstruction: role.systemInstruction,
      availableTools,
      availableServers: activeServers,
      metadata: {
        generatedAt: new Date(),
        previousRole: undefined,
        toolsChanged: true,
        toolCount: availableTools.length,
        serverCount: activeServers.length
      }
    };
  }

  private async notifyToolsChanged(): Promise<void> {
    this.logger.info('📢 Sending tools/list_changed notification');

    const event: ToolsChangedEvent = {
      type: 'tools_changed',
      timestamp: new Date(),
      role: this.state.currentRole?.id || 'none',
      reason: 'role_switch',
      toolCount: this.toolRegistry.getVisibleToolsCount()
    };
    this.emit('toolsChanged', event);

    if (this.toolsChangedCallback) {
      try {
        await this.toolsChangedCallback();
      } catch (error) {
        this.logger.error('Failed to execute tools changed callback:', error);
      }
    }
  }

  setToolsChangedCallback(callback: () => Promise<void>): void {
    this.toolsChangedCallback = callback;
  }

  // ============================================================================
  // Request Routing
  // ============================================================================

  async routeRequest(request: any): Promise<any> {
    const { method, params } = request;

    // Handle set_role
    if (method === 'tools/call' && params?.name === 'set_role') {
      return await this.handleSetRole(params.arguments || {});
    }

    // Handle memory tools
    if (method === 'tools/call' && params?.name === 'save_memory') {
      return await this.memoryHandler.handleSaveMemory(params.arguments || {}, this.state.currentRole);
    }
    if (method === 'tools/call' && params?.name === 'recall_memory') {
      return await this.memoryHandler.handleRecallMemory(params.arguments || {}, this.state.currentRole);
    }
    if (method === 'tools/call' && params?.name === 'list_memories') {
      return await this.memoryHandler.handleListMemories(params.arguments || {}, this.state.currentRole);
    }

    // Handle tools/list - return filtered tools
    if (method === 'tools/list') {
      return this.toolRegistry.getFilteredToolsList();
    }

    // Check tool access for tool calls
    if (method === 'tools/call' && params?.name) {
      this.toolRegistry.checkToolAccess(params.name);
    }

    // Forward to upstream
    return await this.serverManager.routeRequest(request);
  }

  private async handleSetRole(args: Record<string, any>): Promise<any> {
    try {
      const manifest = await this.setRole({
        role: args.role_id,
        includeToolDescriptions: args.includeToolDescriptions !== false
      });

      return {
        result: {
          content: [
            {
              type: 'text',
              text: manifest.systemInstruction
            },
            {
              type: 'text',
              text: `\n\n---\n\n## Available Tools (${manifest.availableTools.length})\n\n` +
                manifest.availableTools
                  .map(t => `- **${t.name}** (${t.source})${t.description ? `: ${t.description}` : ''}`)
                  .join('\n')
            }
          ],
          isError: false,
          metadata: {
            role: manifest.role,
            toolCount: manifest.metadata.toolCount,
            serverCount: manifest.metadata.serverCount,
            generatedAt: manifest.metadata.generatedAt.toISOString()
          }
        }
      };
    } catch (error) {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      };
    }
  }

  checkToolAccess(toolName: string): void {
    this.toolRegistry.checkToolAccess(toolName);
  }

  async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    this.toolRegistry.checkToolAccess(toolName);
    return await this.routeToolCall(toolName, args);
  }

  async routeToolCall(toolName: string, args: Record<string, unknown>): Promise<any> {
    const request = {
      jsonrpc: '2.0' as const,
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    const response = await this.routeRequest(request);
    return response?.result ?? response;
  }

  // ============================================================================
  // Public Accessors
  // ============================================================================

  getCurrentRole(): Role | null {
    return this.state.currentRole;
  }

  listRoles(): ListRolesResult {
    return this.roleManager.listRoles(
      { includeInactive: false },
      this.state.currentRole?.id
    );
  }

  getVisibleToolsCount(): number {
    return this.toolRegistry.getVisibleToolsCount();
  }

  getConnectedServers(): Array<{ name: string; connected: boolean; activeForRole: boolean }> {
    return this.serverManager.getConnectedServersArray();
  }

  getStateMetadata(): MyceliumRouterState['metadata'] {
    return { ...this.state.metadata };
  }

  getStdioRouter() {
    return this.serverManager.getStdioRouter();
  }

  async reloadRoles(): Promise<void> {
    this.logger.info('Reloading roles from skill server...');
    await this.loadRolesFromSkillsServer();
    this.toolRegistry.setCurrentRole(this.state.currentRole);
    await this.notifyToolsChanged();
    this.logger.info('Roles reloaded');
  }

  getState(): {
    currentRole: string | null;
    systemInstruction: string | null;
    visibleToolsCount: number;
    connectedServersCount: number;
  } {
    return {
      currentRole: this.state.currentRole?.id ?? null,
      systemInstruction: this.state.currentRole?.systemInstruction ?? null,
      visibleToolsCount: this.toolRegistry.getVisibleToolsCount(),
      connectedServersCount: this.state.connectedServers.size
    };
  }

  getContext(): {
    role: { id: string; name: string; description: string } | null;
    systemInstruction: string | null;
    availableTools: Array<{ name: string; source: string; description?: string }>;
    availableServers: string[];
    metadata: {
      sessionId: string;
      roleSwitchCount: number;
      lastRoleSwitch: Date | null;
    };
  } {
    const role = this.state.currentRole;
    const visibleToolsInfo = this.toolRegistry.getVisibleToolsInfo();

    return {
      role: role ? {
        id: role.id,
        name: role.name,
        description: role.description,
      } : null,
      systemInstruction: role?.systemInstruction ?? null,
      availableTools: visibleToolsInfo.map(info => ({
        name: info.tool.name,
        source: info.sourceServer,
        description: info.tool.description,
      })),
      availableServers: Array.from(this.state.connectedServers.keys()),
      metadata: {
        sessionId: this.state.metadata.sessionId,
        roleSwitchCount: this.state.metadata.roleSwitchCount,
        lastRoleSwitch: this.state.metadata.lastRoleSwitch ?? null,
      },
    };
  }
}

// Export factory function
export function createMyceliumRouterCore(
  logger: Logger,
  options?: {
    rolesDir?: string;
    configFile?: string;
    memoryDir?: string;
    cwd?: string;
  }
): MyceliumRouterCore {
  return new MyceliumRouterCore(logger, options);
}
