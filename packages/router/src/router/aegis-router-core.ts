// ============================================================================
// AEGIS Router Core - Central Routing and Role Management
// The "司令塔" (command center) for multi-server MCP routing
// ============================================================================

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { StdioRouter, UpstreamServerInfo } from '../mcp/stdio-router.js';
import type { MCPServerConfig } from '../types/mcp-types.js';
import { RoleManager, createRoleManager } from './role-manager.js';
import { ToolVisibilityManager, createToolVisibilityManager } from './tool-visibility-manager.js';
import { AuditLogger, createAuditLogger } from './audit-logger.js';
import { RateLimiter, createRateLimiter, type RoleQuota } from './rate-limiter.js';
import { RoleMemoryStore, createRoleMemoryStore, type MemoryEntry, type SaveMemoryOptions, type MemorySearchOptions } from './role-memory.js';
import type {
  Role,
  AegisRouterState,
  SubServerInfo,
  ToolInfo,
  AgentManifest,
  ManifestTool,
  RoleSwitchEvent,
  ToolsChangedEvent,
  SetRoleOptions,
  ListRolesResult,
  SkillManifest,
  SkillDefinition
} from '../types/router-types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * AegisRouterCore - Central routing system for AEGIS
 *
 * This class serves as the "司令塔" (command center) that:
 * 1. Manages connections to multiple sub-MCP servers
 * 2. Maintains a virtual tool table filtered by current role
 * 3. Handles role switching via set_role
 * 4. Emits notifications when tools change
 */
export class AegisRouterCore extends EventEmitter {
  private logger: Logger;
  private stdioRouter: StdioRouter;
  private roleManager: RoleManager;
  private toolVisibility: ToolVisibilityManager;
  private auditLogger: AuditLogger;
  private rateLimiter: RateLimiter;
  private memoryStore: RoleMemoryStore;

  // Router state
  private state: AegisRouterState;

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
    }
  ) {
    super();
    this.logger = logger;

    // Initialize StdioRouter for managing upstream servers
    this.stdioRouter = new StdioRouter(logger);

    // Initialize role manager
    this.roleManager = createRoleManager(logger);

    // Initialize tool visibility manager
    this.toolVisibility = createToolVisibilityManager(logger, this.roleManager);

    // Initialize audit logger
    this.auditLogger = createAuditLogger(logger);

    // Initialize rate limiter
    this.rateLimiter = createRateLimiter(logger);

    // Initialize role memory store
    this.memoryStore = createRoleMemoryStore(options?.memoryDir || './memory');

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

    this.logger.debug('AegisRouterCore created', {
      sessionId: this.state.metadata.sessionId
    });
  }

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
    this.logger.info('Initializing AEGIS Router Core...');

    try {
      // Initialize role configuration
      await this.roleManager.initialize();

      // Initialize memory store
      await this.memoryStore.initialize();

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
      this.logger.info('AEGIS Router Core initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize router core:', error);
      throw error;
    }
  }

  // ============================================================================
  // Connection Manager - Manages sub-MCP server connections
  // ============================================================================

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

    // Update connected servers state
    await this.updateConnectedServersState();

    // Discover tools from all connected servers
    await this.discoverAllTools();

    // Apply role-based filtering
    this.toolVisibility.setCurrentRole(this.state.currentRole);

    this.logger.info('All upstream servers started and tools discovered');
  }

  /**
   * Load roles dynamically from aegis-skills MCP server
   * Calls list_skills and generates roles from skill definitions
   */
  async loadRolesFromSkillsServer(): Promise<boolean> {
    this.logger.info('🔄 Loading roles from aegis-skills server...');

    try {
      // Call aegis-skills list_skills tool
      const request = {
        jsonrpc: '2.0' as const,
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'aegis-skills__list_skills',
          arguments: {}
        }
      };

      const response = await this.stdioRouter.routeRequest(request);

      // Parse the response
      const result = response?.result;
      if (!result?.content?.[0]?.text) {
        this.logger.warn('No skills returned from aegis-skills server');
        return false;
      }

      const skillsData = JSON.parse(result.content[0].text);

      // Transform to SkillManifest format
      // list_skills returns { skills: [...] } format
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
        // Apply tool visibility filtering based on new role
        this.toolVisibility.setCurrentRole(defaultRole);
        this.logger.info(`Applied tool filtering for default role: ${defaultRole.id}`);
      }

      this.logger.info(`✅ Loaded ${this.state.availableRoles.size} roles from ${skillManifest.skills.length} skills`);
      return true;

    } catch (error) {
      this.logger.error('Failed to load roles from aegis-skills server:', error);
      return false;
    }
  }

  /**
   * Transform skills data from aegis-skills to SkillDefinition format
   */
  private transformSkillsToDefinitions(skillsData: any[]): SkillDefinition[] {
    const definitions: SkillDefinition[] = [];

    for (const skill of skillsData) {
      // Skip skills without allowedRoles
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
        metadata: {
          version: skill.version,
          category: skill.category,
          tags: skill.tags
        }
      });
    }

    return definitions;
  }

  /**
   * Create a prompt router that can route prompts/get requests to specific servers
   */
  private createPromptRouter() {
    return {
      routeRequest: async (request: any): Promise<any> => {
        // Check if this is a targeted request (for a specific backend)
        const targetServer = request._aegis_target_server;

        if (targetServer) {
          // Route to specific server
          this.logger.debug(`Routing prompts/get to server: ${targetServer}`);

          // Strip the _aegis_target_server and modify request for specific server
          const { _aegis_target_server, ...cleanRequest } = request;

          // Route through stdioRouter with server prefix
          return await this.stdioRouter.routeToServer(targetServer, cleanRequest);
        }

        // Default routing
        return await this.stdioRouter.routeRequest(request);
      }
    };
  }

  /**
   * Start servers required for a specific role (lazy loading)
   */
  async startServersForRole(roleId: string): Promise<void> {
    const role = this.roleManager.getRole(roleId);
    if (!role) {
      this.logger.warn(`Role not found: ${roleId}`);
      return;
    }

    // Get allowed servers for this role
    const allowedServers = role.allowedServers;

    // If wildcard, start all servers
    if (allowedServers.includes('*')) {
      this.logger.info(`Role ${roleId} allows all servers, starting all...`);
      await this.startServers();
      return;
    }

    // Start only the required servers
    this.logger.info(`Starting servers for role ${roleId}: ${allowedServers.join(', ')}`);
    await this.stdioRouter.startServersByName(allowedServers);

    // Update state and discover tools
    await this.updateConnectedServersState();
    await this.discoverAllTools();
    // Note: Don't call updateVisibleTools() here - let setRole handle it
    // because currentRole hasn't been updated yet

    this.logger.info(`Servers started for role ${roleId}`);
  }

  /**
   * Stop all servers
   */
  async stopServers(): Promise<void> {
    this.logger.info('Stopping upstream MCP servers...');
    await this.stdioRouter.stopServers();

    // Clear state
    this.state.connectedServers.clear();
    this.toolVisibility.clearTools();
    this.state.visibleTools.clear();

    this.logger.info('All upstream servers stopped');
  }

  /**
   * Update the connected servers state from StdioRouter
   */
  private async updateConnectedServersState(): Promise<void> {
    const servers = this.stdioRouter.getAvailableServers();

    for (const server of servers) {
      const serverInfo: SubServerInfo = {
        name: server.name,
        connected: server.connected,
        activeForRole: this.isServerActiveForRole(server.name),
        tools: [],
        lastActivity: new Date(),
        health: server.connected ? 'healthy' : 'unhealthy'
      };

      this.state.connectedServers.set(server.name, serverInfo);
    }

    this.logger.debug(`Updated ${this.state.connectedServers.size} server states`);
  }

  /**
   * Check if a server is active for the current role
   */
  private isServerActiveForRole(serverName: string): boolean {
    if (!this.state.currentRole) {
      return true; // No role = allow all
    }

    const role = this.state.currentRole;

    // Wildcard allows all servers
    if (role.allowedServers.includes('*')) {
      return true;
    }

    return role.allowedServers.includes(serverName);
  }

  // ============================================================================
  // Virtual Tool Table - Role-based tool filtering
  // ============================================================================

  /**
   * Discover all tools from connected servers
   */
  private async discoverAllTools(): Promise<void> {
    this.logger.debug('Discovering tools from all connected servers...');

    try {
      // Request tools list through the router
      const request = {
        jsonrpc: '2.0' as const,
        id: Date.now(),
        method: 'tools/list',
        params: {}
      };

      const response = await this.stdioRouter.routeRequest(request);

      if (response.result?.tools) {
        // Register tools with ToolVisibilityManager
        this.toolVisibility.registerToolsFromList(response.result.tools as Tool[]);

        // Update server's tool list in state
        for (const tool of response.result.tools as Tool[]) {
          const { serverName } = this.toolVisibility.parseToolName(tool.name);
          const serverInfo = this.state.connectedServers.get(serverName);
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

  // ============================================================================
  // set_role - Role Switching Implementation
  // ============================================================================

  /**
   * Execute set_role - the core role switching function
   *
   * This is the key function that:
   * 1. Fetches remote instruction (SKILL.md) from backend if configured
   * 2. Combines persona + skill instruction for the final system prompt
   * 3. Updates internal state to activate needed sub-servers
   * 4. Sends tools/list_changed notification to clients
   *
   * Flow for agent with remote skill:
   * 1. Client requests role switch
   * 2. AEGIS fetches SKILL.md from backend server via prompts/get
   * 3. AEGIS combines its persona definition with the skill instruction
   * 4. AEGIS sends tools/list_changed to client
   * 5. Client receives combined instruction + available tools
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
    for (const [serverName, serverInfo] of this.state.connectedServers) {
      serverInfo.activeForRole = this.isServerActiveForRole(serverName);
    }

    // Update visible tools based on new role (via ToolVisibilityManager)
    const { added: addedTools, removed: removedTools } = this.toolVisibility.setCurrentRole(role);

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

  /**
   * Build the agent manifest for a role
   */
  private buildManifest(role: Role, includeToolDescriptions: boolean): AgentManifest {
    const availableTools: ManifestTool[] = [];

    for (const toolInfo of this.toolVisibility.getVisibleToolsInfo()) {
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
        previousRole: undefined, // Set by caller if needed
        toolsChanged: true,
        toolCount: availableTools.length,
        serverCount: activeServers.length
      }
    };
  }

  /**
   * Notify client that tools list has changed
   */
  private async notifyToolsChanged(): Promise<void> {
    this.logger.info('📢 Sending tools/list_changed notification');

    // Emit event
    const event: ToolsChangedEvent = {
      type: 'tools_changed',
      timestamp: new Date(),
      role: this.state.currentRole?.id || 'none',
      reason: 'role_switch',
      toolCount: this.toolVisibility.getVisibleCount()
    };
    this.emit('toolsChanged', event);

    // Call the registered callback if available
    if (this.toolsChangedCallback) {
      try {
        await this.toolsChangedCallback();
      } catch (error) {
        this.logger.error('Failed to execute tools changed callback:', error);
      }
    }
  }

  /**
   * Set the callback for tools/list_changed notifications
   */
  setToolsChangedCallback(callback: () => Promise<void>): void {
    this.toolsChangedCallback = callback;
  }

  // ============================================================================
  // Request Routing
  // ============================================================================

  /**
   * Route a request through the router
   * Applies role-based access control before forwarding
   */
  async routeRequest(request: any): Promise<any> {
    const { method, params } = request;

    // Handle internal tools
    if (method === 'tools/call' && params?.name === 'set_role') {
      return await this.handleSetRole(params.arguments || {});
    }

    // Handle memory tools
    if (method === 'tools/call' && params?.name === 'save_memory') {
      return await this.handleSaveMemory(params.arguments || {});
    }
    if (method === 'tools/call' && params?.name === 'recall_memory') {
      return await this.handleRecallMemory(params.arguments || {});
    }
    if (method === 'tools/call' && params?.name === 'list_memories') {
      return await this.handleListMemories(params.arguments || {});
    }

    // Handle tools/list - return filtered tools
    if (method === 'tools/list') {
      return this.getFilteredToolsList();
    }

    // Check tool access for tool calls
    if (method === 'tools/call' && params?.name) {
      this.checkToolAccess(params.name);

      // Handle skill filtering for agent-skills tools
      if (params.name === 'agent-skills__list_skills') {
        return await this.handleListSkillsWithFiltering(request);
      }
      if (params.name === 'agent-skills__get_skill') {
        return await this.handleGetSkillWithFiltering(request, params.arguments);
      }
    }

    // Forward to upstream
    return await this.stdioRouter.routeRequest(request);
  }

  /**
   * Handle list_skills - forward to upstream
   */
  private async handleListSkillsWithFiltering(request: any): Promise<any> {
    return await this.stdioRouter.routeRequest(request);
  }

  /**
   * Handle get_skill - forward to upstream
   */
  private async handleGetSkillWithFiltering(request: any, _args: any): Promise<any> {
    return await this.stdioRouter.routeRequest(request);
  }

  // ============================================================================
  // Memory Tool Handlers
  // ============================================================================

  /**
   * Handle save_memory tool call
   */
  private async handleSaveMemory(args: Record<string, any>): Promise<any> {
    try {
      const roleId = this.state.currentRole?.id;
      if (!roleId) {
        throw new Error('No role selected. Use set_role first.');
      }

      const { content, type, tags, source } = args;
      if (!content) {
        throw new Error('content is required');
      }

      const entry = await this.memoryStore.addEntry(roleId, content, {
        type: type || 'context',
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
        source: source || 'agent'
      });

      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Memory saved successfully.\n\nID: ${entry.id}\nType: ${entry.type}\nContent: ${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}`
            }
          ],
          isError: false
        }
      };
    } catch (error) {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Error saving memory: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      };
    }
  }

  /**
   * Handle recall_memory tool call
   */
  private async handleRecallMemory(args: Record<string, any>): Promise<any> {
    try {
      const roleId = this.state.currentRole?.id;
      if (!roleId) {
        throw new Error('No role selected. Use set_role first.');
      }

      const { query, type, tags, limit } = args;

      const entries = await this.memoryStore.search(roleId, {
        query,
        type,
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
        limit: limit || 10
      });

      if (entries.length === 0) {
        return {
          result: {
            content: [
              {
                type: 'text',
                text: 'No memories found matching your criteria.'
              }
            ],
            isError: false
          }
        };
      }

      const formattedEntries = entries.map((e, i) =>
        `### ${i + 1}. [${e.type}] ${e.id}\n${e.content}\n${e.tags ? `Tags: ${e.tags.join(', ')}` : ''}`
      ).join('\n\n');

      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Found ${entries.length} memories:\n\n${formattedEntries}`
            }
          ],
          isError: false
        }
      };
    } catch (error) {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Error recalling memory: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      };
    }
  }

  /**
   * Handle list_memories tool call
   */
  private async handleListMemories(args: Record<string, any>): Promise<any> {
    try {
      const roleId = args.role_id || this.state.currentRole?.id;
      if (!roleId) {
        throw new Error('No role selected. Use set_role first or provide role_id.');
      }

      const stats = await this.memoryStore.getStats(roleId);

      const typeBreakdown = Object.entries(stats.byType)
        .map(([type, count]) => `  - ${type}: ${count}`)
        .join('\n');

      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Memory Statistics for role "${roleId}":\n\n` +
                `Total entries: ${stats.totalEntries}\n\n` +
                `By type:\n${typeBreakdown || '  (no entries)'}\n\n` +
                `Oldest: ${stats.oldestEntry?.toISOString() || 'N/A'}\n` +
                `Newest: ${stats.newestEntry?.toISOString() || 'N/A'}`
            }
          ],
          isError: false
        }
      };
    } catch (error) {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Error listing memories: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      };
    }
  }

  /**
   * Handle set_role tool call
   */
  private async handleSetRole(args: Record<string, any>): Promise<any> {
    try {
      const manifest = await this.setRole({
        role: args.role_id,
        includeToolDescriptions: args.includeToolDescriptions !== false
      });

      // Format as MCP tool result
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

  /**
   * Get the filtered tools list for the current role
   */
  private getFilteredToolsList(): any {
    // Get visible tools from ToolVisibilityManager (includes set_role)
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
    const roleId = this.state.currentRole?.id || 'none';
    const sessionId = this.state.metadata.sessionId;
    const toolInfo = this.toolVisibility.getToolInfo(toolName);
    const sourceServer = toolInfo?.sourceServer || 'unknown';

    // Check rate limit first
    const rateLimitResult = this.rateLimiter.check(roleId, sessionId, toolName);
    if (!rateLimitResult.allowed) {
      this.auditLogger.logDenied(
        sessionId,
        roleId,
        toolName,
        sourceServer,
        {},
        rateLimitResult.reason || 'Rate limit exceeded'
      );
      throw new Error(rateLimitResult.reason);
    }

    // Check role-based access
    try {
      this.toolVisibility.checkAccess(toolName);
    } catch (error) {
      this.auditLogger.logDenied(
        sessionId,
        roleId,
        toolName,
        sourceServer,
        {},
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Execute a tool call with audit logging and rate limiting
   */
  async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const roleId = this.state.currentRole?.id || 'none';
    const sessionId = this.state.metadata.sessionId;
    const toolInfo = this.toolVisibility.getToolInfo(toolName);
    const sourceServer = toolInfo?.sourceServer || 'unknown';

    // Check access (throws if denied)
    this.checkToolAccess(toolName);

    // Start tracking
    const startTime = Date.now();
    this.rateLimiter.startConcurrent(sessionId);
    this.rateLimiter.consume(roleId, sessionId, toolName);

    try {
      // Route the call
      const result = await this.routeToolCall(toolName, args);

      // Log success
      const durationMs = Date.now() - startTime;
      this.auditLogger.logAllowed(
        sessionId,
        roleId,
        toolName,
        sourceServer,
        args,
        durationMs
      );

      return result;
    } catch (error) {
      // Log error
      this.auditLogger.logError(
        sessionId,
        roleId,
        toolName,
        sourceServer,
        args,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      this.rateLimiter.endConcurrent(sessionId);
    }
  }

  // ============================================================================
  // Public Accessors
  // ============================================================================

  /**
   * Get current role
   */
  getCurrentRole(): Role | null {
    return this.state.currentRole;
  }

  /**
   * List available roles
   */
  listRoles(): ListRolesResult {
    return this.roleManager.listRoles(
      { includeInactive: false },
      this.state.currentRole?.id
    );
  }

  /**
   * Get visible tools count
   */
  getVisibleToolsCount(): number {
    return this.toolVisibility.getVisibleCount();
  }

  /**
   * Get connected servers
   */
  getConnectedServers(): Array<{ name: string; connected: boolean; activeForRole: boolean }> {
    return Array.from(this.state.connectedServers.values()).map(s => ({
      name: s.name,
      connected: s.connected,
      activeForRole: s.activeForRole
    }));
  }

  /**
   * Get router state metadata
   */
  getStateMetadata(): AegisRouterState['metadata'] {
    return { ...this.state.metadata };
  }

  /**
   * Get the underlying StdioRouter for direct access if needed
   */
  getStdioRouter(): StdioRouter {
    return this.stdioRouter;
  }

  /**
   * Reload roles from skill server
   */
  async reloadRoles(): Promise<void> {
    this.logger.info('Reloading roles from skill server...');

    // Reload from aegis-skills server
    await this.loadRolesFromSkillsServer();

    // Update visible tools (via ToolVisibilityManager)
    this.toolVisibility.setCurrentRole(this.state.currentRole);

    // Notify tools changed
    await this.notifyToolsChanged();

    this.logger.info('Roles reloaded');
  }

  /**
   * Route a tool call to the appropriate backend server
   * Convenience method for MCP server integration
   */
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

  /**
   * Get the current router state for external access
   */
  getState(): {
    currentRole: string | null;
    systemInstruction: string | null;
    visibleToolsCount: number;
    connectedServersCount: number;
  } {
    return {
      currentRole: this.state.currentRole?.id ?? null,
      systemInstruction: this.state.currentRole?.systemInstruction ?? null,
      visibleToolsCount: this.toolVisibility.getVisibleCount(),
      connectedServersCount: this.state.connectedServers.size
    };
  }

  // ============================================================================
  // Audit & Rate Limiting
  // ============================================================================

  /**
   * Get the audit logger instance
   */
  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  /**
   * Get the rate limiter instance
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Set quota for a role
   */
  setRoleQuota(roleId: string, quota: RoleQuota): void {
    this.rateLimiter.setQuota(roleId, quota);
    this.logger.info(`Quota set for role: ${roleId}`, quota);
  }

  /**
   * Set quotas for multiple roles
   */
  setRoleQuotas(quotas: Record<string, RoleQuota>): void {
    this.rateLimiter.setQuotas(quotas);
  }

  /**
   * Get audit statistics
   */
  getAuditStats() {
    return this.auditLogger.getStats();
  }

  /**
   * Get recent access denials
   */
  getRecentDenials(limit: number = 10) {
    return this.auditLogger.getRecentDenials(limit);
  }

  /**
   * Export audit logs as JSON
   */
  exportAuditLogs(): string {
    return this.auditLogger.exportJson();
  }

  /**
   * Export audit logs as CSV
   */
  exportAuditLogsCsv(): string {
    return this.auditLogger.exportCsv();
  }
}

// Export factory function
export function createAegisRouterCore(
  logger: Logger,
  options?: {
    rolesDir?: string;
    configFile?: string;
  }
): AegisRouterCore {
  return new AegisRouterCore(logger, options);
}
