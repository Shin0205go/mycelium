/**
 * MCP Client for Mycelium Router
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface AgentManifest {
  role: {
    id: string;
    name: string;
    description: string;
  };
  systemInstruction: string;
  availableTools: Array<{
    name: string;
    source: string;
    description?: string;
  }>;
  availableServers: string[];
  metadata: {
    generatedAt: string;
    toolsChanged: boolean;
    toolCount: number;
    serverCount: number;
  };
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  serverCount: number;
  toolCount: number;
  skills: string[];
  isActive: boolean;
  isCurrent: boolean;
}

export interface ListRolesResult {
  roles: RoleInfo[];
  currentRole: string | null;
  defaultRole: string;
}

export class MCPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private requestId: number = 0;
  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private initialized: boolean = false;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>
  ) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.env }
      });

      this.process.stdout?.on('data', (data) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data) => {
        // Log but don't fail on stderr
        const msg = data.toString().trim();
        if (msg) {
          this.emit('log', msg);
        }
      });

      this.process.on('error', (error) => {
        reject(error);
      });

      this.process.on('close', (code) => {
        this.emit('close', code);
      });

      // Initialize MCP connection
      this.initialize()
        .then(() => {
          this.initialized = true;
          resolve();
        })
        .catch(reject);
    });
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (e) {
          // Ignore non-JSON output
        }
      }
    }
  }

  private handleMessage(message: any): void {
    // Handle notifications
    if (message.method === 'notifications/tools/list_changed') {
      this.emit('toolsChanged');
      return;
    }

    // Handle responses
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message || 'Unknown error'));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.process?.stdin) {
      throw new Error('MCP client not connected');
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params: params || {}
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: {
        name: 'mycelium-cli',
        version: '1.0.0'
      },
      capabilities: {}
    });

    // Send initialized notification
    this.process!.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {}
    }) + '\n');

    return result;
  }

  async listRoles(): Promise<ListRolesResult> {
    const result = await this.sendRequest('tools/call', {
      name: 'set_role',
      arguments: { role_id: 'list' }
    });

    const text = result?.content?.[0]?.text;
    if (text) {
      return JSON.parse(text);
    }
    throw new Error('Failed to list roles');
  }

  async switchRole(roleId: string): Promise<AgentManifest> {
    const result = await this.sendRequest('tools/call', {
      name: 'set_role',
      arguments: { role_id: roleId }
    });

    const text = result?.content?.[0]?.text;
    if (text) {
      return JSON.parse(text);
    }
    throw new Error('Failed to switch role');
  }

  async listTools(): Promise<any[]> {
    const result = await this.sendRequest('tools/list', {});
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    return result;
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
  }
}
