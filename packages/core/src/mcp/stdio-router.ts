// ============================================================================
// MYCELIUM - StdioRouter Stub
// Minimal implementation for skill-based worker pattern
// ============================================================================

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import type { Logger, MCPServerConfig } from '@mycelium/shared';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

/** Timeout constants */
const TIMEOUTS = {
  SERVER_START: 30000,
  REQUEST: 30000,
  SHUTDOWN: 5000,
};

export interface UpstreamServerInfo {
  name: string;
  config: MCPServerConfig;
  process?: ChildProcess;
  connected: boolean;
  buffer: string;
}

/**
 * StdioRouter - Manages connections to upstream MCP servers
 * Minimal implementation for skill-based routing
 */
export class StdioRouter extends EventEmitter {
  private upstreamServers = new Map<string, UpstreamServerInfo>();
  private logger: Logger;
  private cwd?: string;
  private pendingRequests = new Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    targetServer?: string;
  }>();

  constructor(logger: Logger, options?: { cwd?: string }) {
    super();
    this.logger = logger;
    this.cwd = options?.cwd;
  }

  /**
   * Add server from configuration
   */
  addServerFromConfig(name: string, config: MCPServerConfig): void {
    this.upstreamServers.set(name, {
      name,
      config,
      connected: false,
      buffer: '',
    });
    this.logger.debug(`Added server config: ${name}`);
  }

  /**
   * Load servers from Claude Desktop config format
   */
  loadServersFromDesktopConfig(config: { mcpServers: Record<string, MCPServerConfig> }): void {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      this.addServerFromConfig(name, serverConfig);
    }
  }

  /**
   * Get available servers
   */
  getAvailableServers(): Array<{ name: string; connected: boolean }> {
    return Array.from(this.upstreamServers.values()).map(s => ({
      name: s.name,
      connected: s.connected,
    }));
  }

  /**
   * Start all configured servers
   */
  async startServers(): Promise<void> {
    const startPromises = Array.from(this.upstreamServers.keys()).map(
      name => this.startServer(name)
    );
    await Promise.allSettled(startPromises);
  }

  /**
   * Start specific servers by name
   */
  async startServersByName(names: string[]): Promise<void> {
    const startPromises = names.map(name => this.startServer(name));
    await Promise.allSettled(startPromises);
  }

  /**
   * Start a single server
   */
  private async startServer(name: string): Promise<void> {
    const server = this.upstreamServers.get(name);
    if (!server) {
      this.logger.warn(`Server not found: ${name}`);
      return;
    }

    if (server.connected) {
      return;
    }

    try {
      const { command, args = [], env = {} } = server.config;

      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        cwd: this.cwd,
      });

      server.process = proc;

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        server.buffer += data.toString();
        this.processBuffer(server);
      });

      // Handle stderr
      proc.stderr?.on('data', (data: Buffer) => {
        this.logger.debug(`[${name}] stderr: ${data.toString()}`);
      });

      // Handle process events
      proc.on('error', (err) => {
        this.logger.error(`[${name}] process error: ${err.message}`);
        server.connected = false;
      });

      proc.on('close', (code) => {
        this.logger.debug(`[${name}] process closed with code ${code}`);
        server.connected = false;
      });

      // Send initialize request
      await this.initializeServer(server);

      server.connected = true;
      this.logger.info(`Server started: ${name}`);

    } catch (error) {
      this.logger.error(`Failed to start server ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize a server with MCP handshake
   */
  private async initializeServer(server: UpstreamServerInfo): Promise<void> {
    const initRequest = {
      jsonrpc: '2.0',
      id: `init-${server.name}-${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'mycelium-router',
          version: '1.0.0',
        },
      },
    };

    await this.sendToServer(server, initRequest);

    // Send initialized notification
    const notif = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    this.sendToServerNoWait(server, notif);
  }

  /**
   * Process buffered data from server
   */
  private processBuffer(server: UpstreamServerInfo): void {
    const lines = server.buffer.split('\n');
    server.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.handleServerMessage(server.name, msg);
      } catch (e) {
        this.logger.debug(`[${server.name}] Non-JSON line: ${line}`);
      }
    }
  }

  /**
   * Handle message from server
   */
  private handleServerMessage(serverName: string, msg: any): void {
    if (msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(msg.error);
        } else {
          pending.resolve(msg);
        }
      }
    }
  }

  /**
   * Send request to specific server and wait for response
   */
  private sendToServer(server: UpstreamServerInfo, request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!server.process?.stdin) {
        reject(new Error(`Server ${server.name} not connected`));
        return;
      }

      const id = request.id;
      this.pendingRequests.set(id, { resolve, reject, targetServer: server.name });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for ${server.name}`));
      }, TIMEOUTS.REQUEST);

      const originalResolve = resolve;
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        targetServer: server.name,
      });

      server.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Send to server without waiting for response
   */
  private sendToServerNoWait(server: UpstreamServerInfo, msg: any): void {
    if (server.process?.stdin) {
      server.process.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  /**
   * Route a request to appropriate server
   */
  async routeRequest(request: any): Promise<any> {
    // For tools/list, aggregate from all servers
    if (request.method === 'tools/list') {
      return this.aggregateToolsList();
    }

    // For tool calls, route to appropriate server
    if (request.method === 'tools/call') {
      const toolName = request.params?.name || '';
      const serverName = this.getServerForTool(toolName);
      if (serverName) {
        // Strip the server prefix from tool name before sending to backend
        const originalToolName = this.stripServerPrefix(toolName, serverName);
        const modifiedRequest = {
          ...request,
          params: {
            ...request.params,
            name: originalToolName,
          },
        };
        return this.routeToServer(serverName, modifiedRequest);
      }
    }

    // Default: try all connected servers
    for (const server of this.upstreamServers.values()) {
      if (server.connected) {
        try {
          return await this.sendToServer(server, request);
        } catch (e) {
          continue;
        }
      }
    }

    throw new Error('No connected servers available');
  }

  /**
   * Route request to specific server
   */
  async routeToServer(serverName: string, request: any): Promise<any> {
    const server = this.upstreamServers.get(serverName);
    if (!server || !server.connected) {
      throw new Error(`Server ${serverName} not available`);
    }
    return this.sendToServer(server, request);
  }

  /**
   * Aggregate tools/list from all connected servers
   */
  private async aggregateToolsList(): Promise<any> {
    const allTools: any[] = [];

    for (const server of this.upstreamServers.values()) {
      if (!server.connected) continue;

      try {
        const response = await this.sendToServer(server, {
          jsonrpc: '2.0',
          id: `tools-${server.name}-${Date.now()}`,
          method: 'tools/list',
          params: {},
        });

        if (response.result?.tools) {
          // Prefix tool names with server name
          for (const tool of response.result.tools) {
            allTools.push({
              ...tool,
              name: `${server.name}__${tool.name}`,
            });
          }
        }
      } catch (e) {
        this.logger.debug(`Failed to get tools from ${server.name}`);
      }
    }

    return { result: { tools: allTools } };
  }

  /**
   * Get server name from prefixed tool name
   */
  private getServerForTool(toolName: string): string | undefined {
    const parts = toolName.split('__');
    if (parts.length >= 2) {
      const serverName = parts[0];
      if (this.upstreamServers.has(serverName)) {
        return serverName;
      }
    }
    return undefined;
  }

  /**
   * Strip server prefix from tool name
   * e.g., "mycelium-sandbox__bash" -> "bash"
   */
  private stripServerPrefix(toolName: string, serverName: string): string {
    const prefix = `${serverName}__`;
    if (toolName.startsWith(prefix)) {
      return toolName.slice(prefix.length);
    }
    return toolName;
  }

  /**
   * Stop all servers
   */
  async stopServers(): Promise<void> {
    for (const server of this.upstreamServers.values()) {
      if (server.process) {
        server.process.kill();
        server.connected = false;
      }
    }
    this.upstreamServers.clear();
  }
}
