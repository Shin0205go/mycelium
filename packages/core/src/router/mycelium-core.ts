// ============================================================================
// MYCELIUM Router Core - Central Routing and Role Management
// The "司令塔" (command center) for multi-server MCP routing
// ============================================================================

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { StdioRouter, type UpstreamServerInfo } from '../mcp/stdio-router.js';
import { RoleManager, createRoleManager, ToolVisibilityManager, createToolVisibilityManager, RoleMemoryStore, createRoleMemoryStore, type MemoryEntry, type SaveMemoryOptions, type MemorySearchOptions } from '../rbac/index.js';
import type {
  Role,
  ToolInfo,
  ListRolesResult,
  SkillManifest,
  MCPServerConfig,
  BaseSkillDefinition
} from '@mycelium/shared';
import type {
  MyceliumRouterState,
  SubServerInfo,
  AgentManifest,
  ManifestTool,
  RoleSwitchEvent,
  ToolsChangedEvent,
  SetRoleOptions
} from '../types/router-types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';

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
 * MyceliumCore - Central routing system for MYCELIUM
 *
 * This class serves as the "司令塔" (command center) that:
 * 1. Manages connections to multiple sub-MCP servers
 * 2. Maintains a virtual tool table filtered by current skill
 * 3. Spawns sub-agents with skill-based tool access
 * 4. Emits notifications when tools change
 */
export class MyceliumCore extends EventEmitter {
  private logger: Logger;
  private stdioRouter: StdioRouter;
  private roleManager: RoleManager;
  private toolVisibility: ToolVisibilityManager;
  private memoryStore: RoleMemoryStore;

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

    // Initialize StdioRouter for managing upstream servers
    this.stdioRouter = new StdioRouter(logger, { cwd: options?.cwd });

    // Initialize role manager
    this.roleManager = createRoleManager(logger);

    // Initialize tool visibility manager
    this.toolVisibility = createToolVisibilityManager(logger, this.roleManager);

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
        sessionId: uuidv4(),
        roleSwitchCount: 0
      }
    };

    this.logger.debug('MyceliumCore created');
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
    this.logger.info('Initializing MYCELIUM Router Core...');

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
      this.logger.info('MYCELIUM Router Core initialized successfully');

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

      const response = await this.stdioRouter.routeRequest(request);

      // Parse the response
      const result = response?.result;
      if (!result?.content?.[0]?.text) {
        this.logger.warn('No skills returned from mycelium-skills server');
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

      // Re-register ROUTER_TOOLS now that roles are loaded
      // (discoverAllTools was called before roles were loaded, so ROUTER_TOOLS may have been skipped)
      const skillDefinedRouterTools = ROUTER_TOOLS.filter(
        tool => this.roleManager.isToolDefinedInAnySkill(tool.name)
      );
      if (skillDefinedRouterTools.length > 0) {
        this.toolVisibility.registerTools(skillDefinedRouterTools, 'mycelium-router');
        this.logger.info(`Registered ${skillDefinedRouterTools.length} router tools after loading roles`);
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
      this.logger.error('Failed to load roles from mycelium-skills server:', error);
      return false;
    }
  }

  /**
   * Transform skills data from mycelium-skills to BaseSkillDefinition format
   */
  private transformSkillsToDefinitions(skillsData: any[]): BaseSkillDefinition[] {
    const definitions: BaseSkillDefinition[] = [];

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

  /**
   * Create a prompt router that can route prompts/get requests to specific servers
   */
  private createPromptRouter() {
    return {
      routeRequest: async (request: any): Promise<any> => {
        // Check if this is a targeted request (for a specific backend)
        const targetServer = request._mycelium_target_server;

        if (targetServer) {
          // Route to specific server
          this.logger.debug(`Routing prompts/get to server: ${targetServer}`);

          // Strip the _mycelium_target_server and modify request for specific server
          const { _mycelium_target_server, ...cleanRequest } = request;

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
  // Skill Assignment - Internal Implementation
  // ============================================================================

  /**
   * Set skill for the current session (internal use)
   *
   * This function:
   * 1. Fetches remote instruction (SKILL.md) from backend if configured
   * 2. Combines persona + skill instruction for the final system prompt
   * 3. Updates internal state to activate needed sub-servers
   * 4. Sends tools/list_changed notification to clients
   *
   * Flow for agent with remote skill:
   * 1. Sub-agent spawns with a skill
   * 2. MYCELIUM fetches SKILL.md from backend server via prompts/get
   * 3. MYCELIUM combines its persona definition with the skill instruction
   * 4. MYCELIUM sends tools/list_changed to client
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
   * Check if the current skill has memory access
   * Throws an error if access is denied
   */
  private checkMemoryAccess(): string {
    const roleId = this.state.currentRole?.id;
    if (!roleId) {
      throw new Error('No skill selected. Skill must be assigned at spawn time.');
    }

    if (!this.roleManager.hasMemoryAccess(roleId)) {
      throw new Error(
        `Role '${roleId}' does not have memory access. ` +
        `Memory access must be granted via a skill with grants.memory defined.`
      );
    }

    return roleId;
  }

  /**
   * Handle save_memory tool call
   */
  private async handleSaveMemory(args: Record<string, any>): Promise<any> {
    try {
      const roleId = this.checkMemoryAccess();

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
      const roleId = this.checkMemoryAccess();

      const { query, type, tags, limit, all_roles } = args;
      const canAccessAll = this.roleManager.canAccessAllMemories(roleId);

      // Roles with 'all' policy can search across all roles
      if (canAccessAll && all_roles) {
        const entries = await this.memoryStore.searchAll({
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
                  text: 'No memories found across all roles.'
                }
              ],
              isError: false
            }
          };
        }

        const formattedEntries = entries.map((e, i) =>
          `### ${i + 1}. [${e.sourceRole}] [${e.type}] ${e.id}\n${e.content}\n${e.tags ? `Tags: ${e.tags.join(', ')}` : ''}`
        ).join('\n\n');

        return {
          result: {
            content: [
              {
                type: 'text',
                text: `Found ${entries.length} memories across all roles:\n\n${formattedEntries}`
              }
            ],
            isError: false
          }
        };
      }

      // Normal search for current role
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
      const currentRoleId = this.checkMemoryAccess();
      const canAccessAll = this.roleManager.canAccessAllMemories(currentRoleId);
      const { all_roles } = args;

      // Roles with 'all' policy can see all roles' stats
      if (canAccessAll && all_roles) {
        const allStats = await this.memoryStore.getAllStats();
        const rolesWithMemory = Object.keys(allStats);

        if (rolesWithMemory.length === 0) {
          return {
            result: {
              content: [
                {
                  type: 'text',
                  text: 'No memories found across any role.'
                }
              ],
              isError: false
            }
          };
        }

        let totalEntries = 0;
        const roleBreakdown = rolesWithMemory.map(roleId => {
          const stats = allStats[roleId];
          totalEntries += stats.totalEntries;
          const types = Object.entries(stats.byType)
            .map(([t, c]) => `${t}:${c}`)
            .join(', ');
          return `  - **${roleId}**: ${stats.totalEntries} entries (${types || 'empty'})`;
        }).join('\n');

        return {
          result: {
            content: [
              {
                type: 'text',
                text: `📊 Memory Statistics (All Roles)\n\n` +
                  `Total entries across all roles: ${totalEntries}\n` +
                  `Roles with memory: ${rolesWithMemory.length}\n\n` +
                  `By role:\n${roleBreakdown}`
              }
            ],
            isError: false
          }
        };
      }

      // Normal: show current role's stats
      const roleId = args.role_id || currentRoleId;
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
   * Get the filtered tools list for the current skill
   */
  private getFilteredToolsList(): any {
    // Get visible tools from ToolVisibilityManager
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
    // Check role-based access
    this.toolVisibility.checkAccess(toolName);
  }

  /**
   * Execute a tool call
   * @param toolName - The tool to execute
   * @param args - Tool arguments
   */
  async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    // Check access (throws if denied)
    this.checkToolAccess(toolName);

    // Route the call
    return await this.routeToolCall(toolName, args);
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
  getStateMetadata(): MyceliumRouterState['metadata'] {
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

    // Reload from mycelium-skills server
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

  /**
   * Get detailed context for CLI and external tools
   * Returns current role, manifest-like data, and available resources
   */
  getContext(): {
    role: {
      id: string;
      name: string;
      description: string;
    } | null;
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
    const visibleToolsInfo = this.toolVisibility.getVisibleToolsInfo();

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
export function createMyceliumCore(
  logger: Logger,
  options?: {
    rolesDir?: string;
    configFile?: string;
    memoryDir?: string;
    cwd?: string;
  }
): MyceliumCore {
  return new MyceliumCore(logger, options);
}
