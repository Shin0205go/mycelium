/**
 * MCP Client for MYCELIUM Router
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

export interface SkillInfo {
  id: string;
  displayName: string;
  description: string;
  allowedRoles: string[];
  allowedTools: string[];
  grants?: {
    memory?: 'none' | 'isolated' | 'team' | 'all';
    memoryTeamRoles?: string[];
  };
}

export interface ListSkillsResult {
  skills: SkillInfo[];
}

export interface SkillCommandInfo {
  command: string;
  description: string;
  skillId: string;
  skillName: string;
  handlerType: 'tool' | 'script';
  toolName?: string;
  scriptPath?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
    default?: string;
  }>;
  usage?: string;
}

export interface ListCommandsResult {
  commands: SkillCommandInfo[];
}

export interface ToolCommandInfo {
  command: string;           // スラッシュコマンド名
  fullToolName: string;      // 完全なツール名 (server__tool)
  source: string;            // サーバー名
  description?: string;      // ツールの説明
}

export class MCPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private requestId: number = 0;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
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
        } catch {
          // Ignore non-JSON output
        }
      }
    }
  }

  private handleMessage(message: { method?: string; id?: number; error?: { message?: string }; result?: unknown }): void {
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

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
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

  private async initialize(): Promise<unknown> {
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
      name: 'mycelium-router__list_roles',
      arguments: {}
    }) as { content?: Array<{ text?: string }>; isError?: boolean };

    const text = result?.content?.[0]?.text;
    if (!text) {
      throw new Error('Failed to list roles: no response');
    }

    // Check if response is an error message (not JSON)
    if (result.isError || text.startsWith('Error:') || text.startsWith('Access denied:')) {
      throw new Error(text);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Failed to list roles: ${text}`);
    }
  }

  async switchRole(roleId: string): Promise<AgentManifest> {
    const result = await this.sendRequest('tools/call', {
      name: 'set_role',
      arguments: { role_id: roleId }
    }) as { content?: Array<{ text?: string }>; isError?: boolean };

    const text = result?.content?.[0]?.text;
    if (!text) {
      throw new Error('Failed to switch role: no response');
    }

    // Check if response is an error message (not JSON)
    if (result.isError || text.startsWith('Error:') || text.startsWith('Access denied:')) {
      throw new Error(text);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Failed to switch role: ${text}`);
    }
  }

  async listTools(): Promise<unknown[]> {
    const result = await this.sendRequest('tools/list', {}) as { tools?: unknown[] };
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    return result;
  }

  async listSkills(role?: string): Promise<ListSkillsResult> {
    const result = await this.sendRequest('tools/call', {
      name: 'mycelium-skills__list_skills',
      arguments: role ? { role } : {}
    }) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

    // Check for error response
    if (result?.isError) {
      const errorText = result?.content?.[0]?.text || 'Unknown error';
      throw new Error(errorText);
    }

    const text = result?.content?.[0]?.text;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Failed to parse response: ${text.substring(0, 100)}`);
      }
    }
    throw new Error('Empty response from list_skills');
  }

  async listCommands(role?: string): Promise<ListCommandsResult> {
    const result = await this.sendRequest('tools/call', {
      name: 'mycelium-skills__list_commands',
      arguments: role ? { role } : {}
    }) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

    // Check for error response
    if (result?.isError) {
      const errorText = result?.content?.[0]?.text || 'Unknown error';
      throw new Error(errorText);
    }

    const text = result?.content?.[0]?.text;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Failed to parse response: ${text.substring(0, 100)}`);
      }
    }
    throw new Error('Empty response from list_commands');
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
  }
}
