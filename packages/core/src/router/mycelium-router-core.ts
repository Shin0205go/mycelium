// ============================================================================
// MYCELIUM Router Core - Central Routing and Role Management
// The "司令塔" (command center) for multi-server MCP routing
// ============================================================================

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { StdioRouter, type UpstreamServerInfo, type MCPServerConfig } from '@mycelium/gateway';
import { RoleManager, createRoleManager, ToolVisibilityManager, createToolVisibilityManager, RoleMemoryStore, createRoleMemoryStore, type MemoryEntry, type SaveMemoryOptions, type MemorySearchOptions } from '../rbac/index.js';
import { IdentityResolver, createIdentityResolver, type SkillDefinition, type AgentIdentity, type IdentityResolution, type IdentityConfig } from '@mycelium/a2a';
import { AuditLogger, createAuditLogger } from '@mycelium/audit';
import { RateLimiter, createRateLimiter, type RoleQuota } from '@mycelium/audit';
import type {
  Role,
  ToolInfo,
  ListRolesResult,
  SkillManifest,
  ThinkingSignature,
  ToolCallContext
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
  private stdioRouter: StdioRouter;
  private roleManager: RoleManager;
  private toolVisibility: ToolVisibilityManager;
  private auditLogger: AuditLogger;
  private rateLimiter: RateLimiter;
  private memoryStore: RoleMemoryStore;
  private identityResolver: IdentityResolver;

  // Router state
  private state: MyceliumRouterState;

  // Current identity resolution result
  private currentIdentity: IdentityResolution | null = null;

  // Notification callback for tools/list_changed
  private toolsChangedCallback?: () => Promise<void>;

  // Initialization state
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  // A2A mode: when true, set_role tool is disabled
  private a2aMode: boolean = false;

  // Current thinking context for the next tool call
  // Set this before executeToolCall to capture "why" in audit logs
  private pendingThinkingContext: ThinkingSignature | null = null;

  constructor(
    logger: Logger,
    options?: {
      rolesDir?: string;
      configFile?: string;
      memoryDir?: string;
      identityConfigPath?: string;
      a2aMode?: boolean;
      cwd?: string;
    }
  ) {
    super();
    this.logger = logger;
    this.a2aMode = options?.a2aMode ?? false;

    // Initialize StdioRouter for managing upstream servers
    this.stdioRouter = new StdioRouter(logger, { cwd: options?.cwd });

    // Initialize role manager
    this.roleManager = createRoleManager(logger);

    // Initialize tool visibility manager (with A2A mode awareness)
    this.toolVisibility = createToolVisibilityManager(logger, this.roleManager, {
      hideSetRoleTool: this.a2aMode
    });

    // Initialize audit logger
    this.auditLogger = createAuditLogger(logger);

    // Initialize rate limiter
    this.rateLimiter = createRateLimiter(logger);

    // Initialize role memory store
    this.memoryStore = createRoleMemoryStore(options?.memoryDir || './memory');

    // Initialize identity resolver
    this.identityResolver = createIdentityResolver(logger);

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
      sessionId: this.state.metadata.sessionId,
      a2aMode: this.a2aMode
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
  // A2A Identity Resolution
  // ============================================================================

  /**
   * Load identity configuration from file
   */
  async loadIdentityConfig(configPath: string): Promise<void> {
    await this.identityResolver.loadFromFile(configPath);
    this.logger.info(`Identity configuration loaded from ${configPath}`);
  }

  /**
   * Resolve agent identity and set role automatically (A2A mode)
   *
   * This is the main entry point for A2A connections. Instead of
   * using set_role, agents are assigned roles based on their identity
   * (clientInfo.name from MCP handshake).
   *
   * @param identity Agent identity from MCP connection
   * @returns The resolved role information
   */
  async setRoleFromIdentity(identity: AgentIdentity): Promise<AgentManifest> {
    this.logger.info(`🔐 A2A Identity resolution for: ${identity.name}`);

    // Resolve identity to role
    const resolution = this.identityResolver.resolve(identity);
    this.currentIdentity = resolution;

    // Check if the resolved role exists
    const role = this.state.availableRoles.get(resolution.roleId);
    if (!role) {
      this.logger.warn(`Resolved role '${resolution.roleId}' not found, using default`);
      const defaultRoleId = this.roleManager.getDefaultRoleId();
      const defaultRole = this.state.availableRoles.get(defaultRoleId);

      if (!defaultRole) {
        throw new Error(`No valid role found for identity: ${identity.name}`);
      }

      // Update resolution with fallback role
      resolution.roleId = defaultRoleId;
    }

    // Set the role internally (without exposing set_role tool)
    const manifest = await this.setRole({
      role: resolution.roleId,
      includeToolDescriptions: true
    });

    this.logger.info(`✅ A2A Identity resolved: ${identity.name} → ${resolution.roleId}`, {
      matchedSkills: resolution.matchedSkills,
      matchedRule: resolution.matchedRule?.description,
      isTrusted: resolution.isTrusted
    });

    return manifest;
  }

  /**
   * Get the current identity resolution
   */
  getCurrentIdentity(): IdentityResolution | null {
    return this.currentIdentity;
  }

  /**
   * Check if running in A2A mode
   */
  isA2AMode(): boolean {
    return this.a2aMode;
  }

  /**
   * Enable A2A mode (disables set_role tool)
   */
  enableA2AMode(): void {
    this.a2aMode = true;
    this.toolVisibility.setHideSetRoleTool(true);
    this.logger.info('A2A mode enabled - set_role tool disabled');
  }

  /**
   * Disable A2A mode (enables set_role tool)
   */
  disableA2AMode(): void {
    this.a2aMode = false;
    this.toolVisibility.setHideSetRoleTool(false);
    this.logger.info('A2A mode disabled - set_role tool enabled');
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

      // Load identity rules from skills (A2A skill-based matching)
      this.identityResolver.clearRules();
      this.identityResolver.loadFromSkills(skillManifest.skills);

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

      // Log identity statistics
      const identityStats = this.identityResolver.getStats();
      this.logger.info(`✅ Loaded ${this.state.availableRoles.size} roles from ${skillManifest.skills.length} skills`, {
        identityRules: identityStats.totalRules,
        rulesByRole: identityStats.rulesByRole
      });
      return true;

    } catch (error) {
      this.logger.error('Failed to load roles from mycelium-skills server:', error);
      return false;
    }
  }

  /**
   * Transform skills data from mycelium-skills to SkillDefinition format
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
        grants: skill.grants ? {
          memory: skill.grants.memory,
          memoryTeamRoles: skill.grants.memoryTeamRoles
        } : undefined,
        // A2A Identity configuration from skill (skill-based matching)
        identity: skill.identity ? {
          skillMatching: skill.identity.skillMatching || [],
          trustedPrefixes: skill.identity.trustedPrefixes
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

    // Handle set_role - reject in A2A mode
    if (method === 'tools/call' && params?.name === 'set_role') {
      if (this.a2aMode) {
        return {
          result: {
            content: [
              {
                type: 'text',
                text: 'Error: set_role is disabled in A2A mode. ' +
                  'Role is automatically assigned based on agent identity at connection time.'
              }
            ],
            isError: true
          }
        };
      }
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
   * Check if the current role has memory access
   * Throws an error if access is denied
   */
  private checkMemoryAccess(): string {
    const roleId = this.state.currentRole?.id;
    if (!roleId) {
      throw new Error('No role selected. Use set_role first.');
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
   * @param toolName - The tool to execute
   * @param args - Tool arguments
   * @param thinking - Optional thinking signature to capture in audit log
   */
  async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    thinking?: ThinkingSignature
  ): Promise<any> {
    const roleId = this.state.currentRole?.id || 'none';
    const sessionId = this.state.metadata.sessionId;
    const toolInfo = this.toolVisibility.getToolInfo(toolName);
    const sourceServer = toolInfo?.sourceServer || 'unknown';

    // Use provided thinking or pending context
    const thinkingSignature = thinking || this.pendingThinkingContext;

    // Clear pending context after use
    if (this.pendingThinkingContext) {
      this.pendingThinkingContext = null;
    }

    // Check access (throws if denied)
    this.checkToolAccess(toolName);

    // Start tracking
    const startTime = Date.now();
    this.rateLimiter.startConcurrent(sessionId);
    this.rateLimiter.consume(roleId, sessionId, toolName);

    try {
      // Route the call
      const result = await this.routeToolCall(toolName, args);

      // Log success with thinking signature
      const durationMs = Date.now() - startTime;
      this.auditLogger.logAllowed(
        sessionId,
        roleId,
        toolName,
        sourceServer,
        args,
        durationMs,
        undefined, // metadata
        thinkingSignature ?? undefined
      );

      return result;
    } catch (error) {
      // Log error with thinking signature
      this.auditLogger.logError(
        sessionId,
        roleId,
        toolName,
        sourceServer,
        args,
        error instanceof Error ? error.message : String(error),
        undefined, // metadata
        thinkingSignature ?? undefined
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
   * Get the identity resolver instance
   */
  getIdentityResolver(): IdentityResolver {
    return this.identityResolver;
  }

  /**
   * Get identity resolution statistics
   */
  getIdentityStats() {
    return this.identityResolver.getStats();
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

  // ============================================================================
  // Thinking Signature Management
  // ============================================================================

  /**
   * Set thinking context for the next tool call.
   * This captures "why" the operation is being performed.
   *
   * @param thinking - The thinking signature from the model
   *
   * @example
   * ```typescript
   * router.setThinkingContext({
   *   thinking: "I need to read the file to understand the code structure...",
   *   type: 'extended_thinking',
   *   modelId: 'claude-opus-4-5-20251101',
   *   capturedAt: new Date(),
   * });
   * await router.executeToolCall('filesystem__read_file', { path: '/src/index.ts' });
   * ```
   */
  setThinkingContext(thinking: ThinkingSignature): void {
    this.pendingThinkingContext = thinking;
    this.logger.debug('Thinking context set', {
      type: thinking.type,
      modelId: thinking.modelId,
      thinkingTokens: thinking.thinkingTokens,
      thinkingLength: thinking.thinking.length,
    });
  }

  /**
   * Clear any pending thinking context without using it.
   */
  clearThinkingContext(): void {
    if (this.pendingThinkingContext) {
      this.logger.debug('Thinking context cleared without use');
      this.pendingThinkingContext = null;
    }
  }

  /**
   * Check if there is a pending thinking context.
   */
  hasThinkingContext(): boolean {
    return this.pendingThinkingContext !== null;
  }

  /**
   * Get audit entries that have thinking signatures (for transparency analysis).
   */
  getEntriesWithThinking(limit: number = 50) {
    return this.auditLogger.getEntriesWithThinking(limit);
  }

  /**
   * Export a detailed thinking report for transparency audits.
   * This includes all entries with thinking signatures and their reasoning.
   */
  exportThinkingReport(): string {
    return this.auditLogger.exportThinkingReport();
  }

  /**
   * Get thinking statistics from audit logs.
   */
  getThinkingStats() {
    const stats = this.auditLogger.getStats();
    return stats.thinkingStats;
  }
}

// Export factory function
export function createMyceliumRouterCore(
  logger: Logger,
  options?: {
    rolesDir?: string;
    configFile?: string;
    memoryDir?: string;
    identityConfigPath?: string;
    a2aMode?: boolean;
    cwd?: string;
  }
): MyceliumRouterCore {
  return new MyceliumRouterCore(logger, options);
}
