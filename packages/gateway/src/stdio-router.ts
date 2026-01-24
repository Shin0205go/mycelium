// ============================================================================
// AEGIS Gateway - MCP stdio Router
// Manages and routes to multiple upstream MCP servers via stdio
// ============================================================================

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { TIMEOUTS } from './constants.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { Logger, MCPServerConfig } from '@mycelium/shared';

export interface UpstreamServerInfo {
  name: string;
  config: MCPServerConfig;
  process?: ChildProcess;
  connected: boolean;
  buffer: string;
}

export class StdioRouter extends EventEmitter {
  private upstreamServers = new Map<string, UpstreamServerInfo>();
  private logger: Logger;
  private cwd?: string;
  private currentRequestId?: string | number;
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
   * Add server from Claude Desktop config format
   */
  addServerFromConfig(name: string, config: MCPServerConfig): void {
    this.upstreamServers.set(name, {
      name,
      config,
      connected: false,
      buffer: ''
    });
    this.logger.info(`Configured upstream server: ${name}`, {
      command: config.command,
      args: config.args
    });
  }

  /**
   * Load multiple servers from claude_desktop_config.json format
   */
  loadServersFromDesktopConfig(config: { mcpServers: Record<string, MCPServerConfig> }): void {
    Object.entries(config.mcpServers).forEach(([name, serverConfig]) => {
      // Exclude AEGIS proxy itself
      if (name !== 'aegis-proxy' && name !== 'aegis') {
        this.addServerFromConfig(name, serverConfig);
      }
    });
  }

  /**
   * Start all configured servers
   */
  async startServers(): Promise<void> {
    const startPromises = Array.from(this.upstreamServers.entries()).map(
      async ([name, server]) => {
        try {
          await this.startServer(name, server);
        } catch (error) {
          this.logger.error(`Failed to start server ${name}:`, { error: String(error) });
        }
      }
    );

    await Promise.all(startPromises);
  }

  /**
   * Start specific servers by name (if not already started)
   */
  async startServersByName(serverNames: string[]): Promise<void> {
    const startPromises = serverNames.map(async (name) => {
      const server = this.upstreamServers.get(name);
      if (!server) {
        this.logger.warn(`Server not configured: ${name}`);
        return;
      }
      if (server.connected) {
        this.logger.debug(`Server already connected: ${name}`);
        return;
      }
      try {
        this.logger.info(`Starting server: ${name}`);
        await this.startServer(name, server);
      } catch (error) {
        this.logger.error(`Failed to start server ${name}:`, { error: String(error) });
      }
    });

    await Promise.all(startPromises);
  }

  /**
   * Check if a server is connected
   */
  isServerConnected(name: string): boolean {
    const server = this.upstreamServers.get(name);
    return server?.connected ?? false;
  }

  private async startServer(name: string, server: UpstreamServerInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Expand environment variables
        const expandedEnv: Record<string, string> = {};
        if (server.config.env) {
          for (const [key, value] of Object.entries(server.config.env)) {
            if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
              const varName = value.slice(2, -1);
              expandedEnv[key] = process.env[varName] || '';
            } else {
              expandedEnv[key] = value as string;
            }
          }
        }

        const env = {
          ...process.env,
          ...expandedEnv
        };

        this.logger.info(`Starting upstream server ${name}`);
        this.logger.debug(`  Command: ${server.config.command}`);
        this.logger.debug(`  Args: ${(server.config.args || []).join(' ')}`);
        this.logger.debug(`  Env: ${JSON.stringify(expandedEnv)}`);

        const proc = spawn(server.config.command, server.config.args || [], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: this.cwd
        });

        server.process = proc;
        // connected remains false until server actually responds
        server.connected = false;

        // stdout processing
        proc.stdout?.on('data', (data) => {
          const text = data.toString();
          server.buffer += text;

          // Log first data (but don't mark as connected yet)
          if (!server.connected) {
            this.logger.debug(`[${name}] First stdout data received: ${text.substring(0, 200)}`);

            // Special logging for history-mcp
            if (name === 'history-mcp') {
              this.logger.info(`HISTORY-MCP: First response received (waiting for initialization)`);
            }
          }

          // Look for JSON-RPC messages
          const lines = server.buffer.split('\n');
          server.buffer = lines.pop() || '';

          lines.forEach(line => {
            if (line.trim()) {
              try {
                const message = JSON.parse(line);
                this.handleUpstreamMessage(name, message);
              } catch (error) {
                // Ignore non-JSON output
                this.logger.debug(`Non-JSON output from ${name}: ${line}`);
              }
            }
          });
        });

        // stderr processing (MCP server log output)
        proc.stderr?.on('data', (data) => {
          const message = data.toString().trim();

          // Log initialization messages (but don't change connection state)
          if (!server.connected && (
            message.toLowerCase().includes('running on stdio') ||
            message.toLowerCase().includes('server running') ||
            message.toLowerCase().includes('server started') ||
            message.toLowerCase().includes('listening') ||
            message.toLowerCase().includes('mcp server started')
          )) {
            this.logger.info(`${name} startup message detected: ${message}`);
            this.logger.info(`Waiting for MCP initialization handshake...`);
          }

          // Record error-level messages as warnings
          if (message.toLowerCase().includes('error') || message.toLowerCase().includes('fail')) {
            this.logger.warn(`[${name}] ${message}`);
          } else {
            // Normal logs at debug level
            this.logger.debug(`[${name}] ${message}`);
          }
        });

        // Process exit handling
        proc.on('close', (code) => {
          this.logger.info(`Server ${name} exited with code ${code}`);
          server.connected = false;
          server.process = undefined;

          // Auto restart
          setTimeout(() => {
            if (this.upstreamServers.has(name)) {
              this.startServer(name, server).catch(err => {
                this.logger.error(`Failed to restart ${name}:`, err);
              });
            }
          }, TIMEOUTS.CONTEXT_ENRICHMENT);
        });

        proc.on('error', (error) => {
          this.logger.error(`Failed to start ${name}:`, { error: error.message });
          this.logger.error(`Command was: ${server.config.command} ${(server.config.args || []).join(' ')}`);
          server.connected = false;
          reject(error);
        });

        // Wait for MCP server initialization
        let initTimeout: NodeJS.Timeout;
        const waitForInit = () => {
          return new Promise<void>((waitResolve, waitReject) => {
            let initialized = false;

            // MCP standard initialization handshake
            const sendInitializeRequest = () => {
              if (initialized || !server.process || !server.process.stdin) {
                this.logger.debug(`Skipping initialize request for ${name}: initialized=${initialized}, process=${!!server.process}, stdin=${!!server.process?.stdin}`);
                return;
              }

              const initRequest = {
                jsonrpc: '2.0',
                id: 0, // Initialize request always uses ID 0
                method: 'initialize',
                params: {
                  protocolVersion: LATEST_PROTOCOL_VERSION,
                  clientInfo: {
                    name: 'AEGIS Policy Enforcement Proxy',
                    version: '1.0.0'
                  },
                  capabilities: {}
                }
              };

              this.logger.info(`Sending initialize request to ${name}`);

              // Register init request in pendingRequests (with dummy resolve/reject)
              this.pendingRequests.set(initRequest.id, {
                resolve: () => {},
                reject: () => {},
                targetServer: name
              });

              // Initialize response handler
              const initResponseHandler = (message: any) => {
                if (message.id === initRequest.id) {
                  if (message.result) {
                    this.logger.info(`${name} initialized successfully`, {
                      protocolVersion: message.result.protocolVersion,
                      serverInfo: message.result.serverInfo
                    });

                    // Send initialized notification
                    const initializedNotification = {
                      jsonrpc: '2.0',
                      method: 'initialized',
                      params: {}
                    };
                    if (server.process && server.process.stdin) {
                      server.process.stdin.write(JSON.stringify(initializedNotification) + '\n');
                    }

                    // Now mark as connected
                    server.connected = true;
                    initialized = true;
                    clearTimeout(initTimeout);

                    // Cleanup event listener and pending request
                    this.removeListener(`response-${initRequest.id}`, initResponseHandler);
                    this.pendingRequests.delete(initRequest.id);

                    waitResolve();
                  } else if (message.error) {
                    this.logger.error(`${name} initialization failed:`, message.error);
                    this.pendingRequests.delete(initRequest.id);
                    waitReject(new Error(`${name} initialization failed: ${message.error.message}`));
                  }
                }
              };

              this.on(`response-${initRequest.id}`, initResponseHandler);

              // Actually send the request
              if (server.process && server.process.stdin) {
                server.process.stdin.write(JSON.stringify(initRequest) + '\n');
              } else {
                this.logger.warn(`Cannot send initialize request to ${name}: process or stdin not available`);
              }
            };

            // Timeout setting (10 seconds)
            initTimeout = setTimeout(() => {
              if (!initialized) {
                // Some servers like history-mcp may not send init messages
                // Allow connection if process is still running
                if (server.process && !server.process.killed) {
                  this.logger.warn(`Server ${name} initialization timeout, but process is running - marking as connected`);
                  server.connected = true;
                  initialized = true;
                  waitResolve();
                } else {
                  waitReject(new Error(`Server ${name} initialization timeout`));
                }
              }
            }, 10000);

            // Send initialize request after process starts
            setTimeout(sendInitializeRequest, 500);

            // Check for initialization completion
            const checkInit = () => {
              if (server.connected) {
                initialized = true;
                clearTimeout(initTimeout);
                this.logger.info(`Successfully started upstream server: ${name}`);
                waitResolve();
              } else {
                // Recheck after 100ms
                setTimeout(checkInit, 100);
              }
            };

            checkInit();
          });
        };

        waitForInit()
          .then(() => resolve())
          .catch((err) => reject(err));

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Route request to appropriate upstream server
   */
  async routeRequest(request: any): Promise<any> {
    const { method, params, id } = request;

    this.logger.debug(`Routing request: ${method} (id: ${id})`);

    // Debug: show current connection state
    this.logger.info(`Current server connections:`, {
      servers: this.getAvailableServers()
    });

    // tools/list and resources/list aggregate from all servers
    if (method === 'tools/list' || method === 'resources/list') {
      this.logger.debug(`Aggregating ${method} from all servers`);
      return await this.aggregateListResponses(method, params, id);
    }

    // Other requests go to single server
    const targetServer = this.selectTargetServer(method, params);

    this.logger.info(`Selected target server: ${targetServer} for ${method}`, {
      toolName: params?.name,
      resourceUri: params?.uri
    });

    if (!targetServer) {
      throw new Error(`No upstream server available for ${method}`);
    }

    const server = this.upstreamServers.get(targetServer);
    if (!server?.connected || !server.process) {
      this.logger.error(`Server ${targetServer} is not connected`, {
        connected: server?.connected,
        hasProcess: !!server?.process
      });
      throw new Error(`Upstream server ${targetServer} is not connected`);
    }

    // For tools/call, remove server prefix
    let modifiedRequest = request;
    if (method === 'tools/call' && params?.name) {
      const toolName = params.name;
      const prefix = `${targetServer}__`;
      if (toolName.startsWith(prefix)) {
        // Create request without prefix
        modifiedRequest = {
          ...request,
          params: {
            ...params,
            name: toolName.substring(prefix.length)
          }
        };
        this.logger.debug(`Removed prefix from tool name: ${toolName} -> ${modifiedRequest.params.name}`);
      }
    }

    return new Promise((resolve, reject) => {
      this.currentRequestId = id;
      this.pendingRequests.set(id, { resolve, reject, targetServer });

      // Timeout setting
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for ${method}`));
      }, 30000);

      // Send request (using modified request)
      const requestStr = JSON.stringify(modifiedRequest);
      this.logger.info(`Sending request to ${targetServer}:`, {
        id: modifiedRequest.id,
        method: modifiedRequest.method,
        params: modifiedRequest.params
      });
      server.process!.stdin?.write(requestStr + '\n');

      // Wait for response
      const responseHandler = (response: any) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        this.removeListener(`response-${id}`, responseHandler);
        resolve(response);
      };
      this.on(`response-${id}`, responseHandler);
    });
  }

  /**
   * Route a request directly to a specific server
   * Used for targeted requests like prompts/get to a specific backend
   */
  async routeToServer(serverName: string, request: any): Promise<any> {
    const { method, id } = request;

    this.logger.debug(`Routing request directly to server: ${serverName}, method: ${method}`);

    const server = this.upstreamServers.get(serverName);
    if (!server) {
      throw new Error(`Server '${serverName}' not found`);
    }

    if (!server.connected || !server.process) {
      this.logger.error(`Server ${serverName} is not connected`, {
        connected: server.connected,
        hasProcess: !!server.process
      });
      throw new Error(`Server '${serverName}' is not connected`);
    }

    return new Promise((resolve, reject) => {
      this.currentRequestId = id;
      this.pendingRequests.set(id, { resolve, reject, targetServer: serverName });

      // Timeout setting
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for ${method} on server ${serverName}`));
      }, 30000);

      // Send request
      const requestStr = JSON.stringify(request);
      this.logger.info(`Sending targeted request to ${serverName}:`, {
        id: request.id,
        method: request.method
      });
      server.process!.stdin?.write(requestStr + '\n');

      // Wait for response
      const responseHandler = (response: any) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        this.removeListener(`response-${id}`, responseHandler);
        resolve(response);
      };
      this.on(`response-${id}`, responseHandler);
    });
  }

  /**
   * Aggregate list responses from multiple servers
   */
  private async aggregateListResponses(method: string, params: any, id: number): Promise<any> {
    // Debug: check connected servers
    const connectedServers = Array.from(this.upstreamServers.entries())
      .filter(([_, server]) => server.connected);

    this.logger.info(`Aggregating ${method} from ${connectedServers.length} connected servers`);
    connectedServers.forEach(([name, server]) => {
      this.logger.info(`  ${name}: connected=${server.connected}, hasProcess=${!!server.process}`);
      if (name === 'history-mcp') {
        this.logger.info(`  HISTORY-MCP STATUS: connected=${server.connected}, pid=${server.process?.pid}`);
      }
    });

    // Request ID counter (standard format)
    const requestIdBase = typeof id === 'number' ? id : Date.now();

    const responses = await Promise.allSettled(
      connectedServers.map(([name, _], index) =>
        this.sendRequestToServer(name, {
          method,
          params,
          id: requestIdBase + index,
          jsonrpc: '2.0'
        })
      )
    );

    // Debug: check response status
    responses.forEach((r, i) => {
      const serverName = connectedServers[i][0];
      if (r.status === 'fulfilled') {
        this.logger.debug(`${serverName} response: success`);
      } else {
        this.logger.warn(`${serverName} response: failed - ${r.reason}`);
      }
    });

    const successfulResponses = responses
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);

    if (method === 'tools/list') {
      const allTools: any[] = [];

      // Add server prefix to tools
      responses.forEach((response, index) => {
        if (response.status === 'fulfilled') {
          const serverName = connectedServers[index][0];
          const result = (response as PromiseFulfilledResult<any>).value;

          if (result.result?.tools) {
            result.result.tools.forEach((tool: any) => {
              // Add server name as prefix
              const prefixedName = `${serverName}__${tool.name}`;
              allTools.push({
                ...tool,
                name: prefixedName
              });

              // Special logging for history-mcp tools
              if (serverName === 'history-mcp') {
                this.logger.info(`  HISTORY-MCP TOOL: ${prefixedName}`);
              }
            });
          }
        }
      });

      this.logger.info(`Aggregated ${allTools.length} tools total`);

      return { result: { tools: allTools } };
    } else if (method === 'resources/list') {
      const allResources = successfulResponses
        .filter(r => r.result?.resources)
        .flatMap(r => r.result.resources);
      return { result: { resources: allResources } };
    }

    return { result: {} };
  }

  /**
   * Send request to specific server
   */
  private async sendRequestToServer(serverName: string, request: any): Promise<any> {
    const server = this.upstreamServers.get(serverName);
    if (!server?.connected || !server.process) {
      this.logger.error(`Server ${serverName} is not connected`, {
        hasServer: !!server,
        connected: server?.connected,
        hasProcess: !!server?.process
      });
      throw new Error(`Server ${serverName} is not connected`);
    }

    // Detailed logging for history-mcp requests
    if (serverName === 'history-mcp') {
      this.logger.info(`HISTORY-MCP SENDING REQUEST:`, {
        method: request.method,
        id: request.id,
        params: request.params,
        pid: server.process?.pid
      });
    }

    // For tools/call, remove server prefix
    let modifiedRequest = request;
    if (request.method === 'tools/call' && request.params?.name) {
      const toolName = request.params.name;
      const prefix = `${serverName}__`;
      if (toolName.startsWith(prefix)) {
        modifiedRequest = {
          ...request,
          params: {
            ...request.params,
            name: toolName.substring(prefix.length)
          }
        };
        this.logger.debug(`[sendRequestToServer] Removed prefix: ${toolName} -> ${modifiedRequest.params.name}`);

        if (serverName === 'history-mcp') {
          this.logger.info(`HISTORY-MCP STRIPPED TOOL NAME: ${modifiedRequest.params.name}`);
        }
      }
    }

    return new Promise((resolve, reject) => {
      const requestId = request.id;
      this.pendingRequests.set(requestId, { resolve, reject, targetServer: serverName });

      this.logger.debug(`Pending request registered: ${requestId} -> ${serverName}`);

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.logger.error(`Request timeout for ${serverName} - method: ${modifiedRequest.method}, id: ${requestId}`);

        if (serverName === 'history-mcp') {
          this.logger.error(`HISTORY-MCP TIMEOUT after 30s`);
        }

        reject(new Error(`Request timeout for ${serverName}`));
      }, 30000);

      const jsonRequest = JSON.stringify(modifiedRequest) + '\n';

      if (serverName === 'history-mcp') {
        this.logger.info(`HISTORY-MCP WRITING TO STDIN:`, { request: jsonRequest.trim() });
      }

      server.process!.stdin?.write(jsonRequest);

      const responseHandler = (response: any) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        this.removeListener(`response-${requestId}`, responseHandler);

        if (serverName === 'history-mcp') {
          this.logger.info(`HISTORY-MCP RESPONSE RECEIVED:`, {
            id: response.id,
            hasResult: !!response.result,
            hasError: !!response.error
          });
        }

        resolve(response);
      };
      this.on(`response-${requestId}`, responseHandler);
    });
  }

  private selectTargetServer(method: string, params: any): string | null {
    // tools/list and resources/list need aggregation from all servers
    // Return first available server here (aggregation implemented elsewhere)
    if (method === 'tools/list' || method === 'resources/list') {
      for (const [name, server] of this.upstreamServers) {
        if (server.connected) {
          this.logger.debug(`Selected server ${name} for ${method}`);
          return name;
        }
      }
    }

    // Determine server from resource URI
    if (method === 'resources/read') {
      const uri = params?.uri || '';

      // URI format: gmail://... -> gmail server
      const match = uri.match(/^([^:]+):\/\//);
      if (match) {
        const serverName = match[1];
        if (this.upstreamServers.has(serverName)) {
          return serverName;
        }
      }
    }

    // Determine server from tool name
    if (method === 'tools/call') {
      const toolName = params?.name || '';

      this.logger.debug(`Selecting server for tool: ${toolName}`);

      // Match by prefix (using __ separator)
      for (const [name, server] of this.upstreamServers) {
        if (toolName.startsWith(name + '__')) {
          this.logger.info(`Matched tool ${toolName} to server ${name}`);

          // Special check for history-mcp
          if (name === 'history-mcp') {
            this.logger.info(`HISTORY-MCP TOOL CALL: ${toolName}, connected=${server.connected}`);
          }

          return name;
        }
      }

      this.logger.warn(`No server found for tool: ${toolName}`);
    }

    // Default: first available server
    for (const [name, server] of this.upstreamServers) {
      if (server.connected) {
        return name;
      }
    }

    return null;
  }

  private handleUpstreamMessage(serverName: string, message: any): void {
    // Detailed logging for history-mcp messages
    if (serverName === 'history-mcp') {
      this.logger.info(`HISTORY-MCP MESSAGE:`, { message: JSON.stringify(message) });
    } else {
      this.logger.debug(`Received message from ${serverName}:`, { message: JSON.stringify(message).substring(0, 200) });
    }

    // Handle ID 0 as well (exclude only undefined and null)
    if (message.id !== undefined && message.id !== null) {
      this.logger.debug(`Checking pending request for ID ${message.id}, has: ${this.pendingRequests.has(message.id)}`);

      if (this.pendingRequests.has(message.id)) {
        // Return response to corresponding request
        this.logger.info(`Response received for request ${message.id} from ${serverName}`);

        // Detailed check for history-mcp
        if (serverName === 'history-mcp') {
          this.logger.info(`HISTORY-MCP RESPONSE ID ${message.id}:`, { message: JSON.stringify(message) });
        }

        this.emit(`response-${message.id}`, message);
      } else {
        this.logger.warn(`Response for unknown request ID ${message.id} from ${serverName}`);
      }
    } else if (message.method) {
      // Notification message
      this.logger.debug(`Notification from ${serverName}: ${message.method}`);

      // Handle $/notification format
      if (message.method === '$/notification' && message.params) {
        const notificationMethod = message.params.method;
        const notificationParams = message.params.params || {};

        this.logger.info(`Upstream notification from ${serverName}: ${notificationMethod}`, {
          params: notificationParams
        });

        // Special handling for resources/listChanged
        if (notificationMethod === 'resources/listChanged') {
          this.emit('upstreamNotification', {
            serverName,
            notificationMethod,
            notificationParams
          });
        }
      }

      // Also support traditional notification format
      this.emit('notification', { from: serverName, message });
    } else {
      this.logger.debug(`Unknown message type from ${serverName}:`, message);
    }
  }

  /**
   * Stop all upstream servers
   */
  async stopServers(): Promise<void> {
    const stopPromises = Array.from(this.upstreamServers.values()).map(server => {
      if (server.process) {
        return new Promise<void>((resolve) => {
          server.process!.on('close', () => resolve());
          server.process!.kill('SIGTERM');

          // Force kill timeout
          setTimeout(() => {
            if (server.process) {
              server.process.kill('SIGKILL');
            }
            resolve();
          }, 5000);
        });
      }
      return Promise.resolve();
    });

    await Promise.all(stopPromises);
    this.upstreamServers.clear();
  }

  /**
   * Get list of available servers
   */
  getAvailableServers(): Array<{ name: string; connected: boolean }> {
    return Array.from(this.upstreamServers.entries()).map(([name, server]) => ({
      name,
      connected: server.connected
    }));
  }
}
