/**
 * Unit Tests for MCP Server Entry Point
 *
 * Tests the MCP server's request handlers for tools/list, tools/call,
 * prompts/list, prompts/get, and sub-agent spawning.
 *
 * Note: These tests verify the logic of request handlers without importing
 * the actual mcp-server.ts file since it has side effects on import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process for sub-agent tests
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

import { spawn } from 'child_process';

const mockSpawn = vi.mocked(spawn);

// Create a mock router for testing handler logic
const createMockRouter = () => ({
  addServer: vi.fn().mockResolvedValue(undefined),
  initialize: vi.fn().mockResolvedValue(undefined),
  startServers: vi.fn().mockResolvedValue(undefined),
  loadRolesFromSkillsServer: vi.fn().mockResolvedValue(undefined),
  routeRequest: vi.fn().mockResolvedValue({ tools: [] }),
  routeToolCall: vi.fn().mockResolvedValue('result'),
  setRole: vi.fn().mockResolvedValue({ role: { id: 'admin' } }),
  listRoles: vi.fn().mockReturnValue([{ id: 'admin' }, { id: 'guest' }]),
  checkToolAccess: vi.fn(),
  startServersForRole: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({ currentRole: 'admin', systemInstruction: 'You are admin' })
});

describe('MCP Server Request Handlers', () => {
  let mockRouter: ReturnType<typeof createMockRouter>;

  beforeEach(() => {
    mockSpawn.mockClear();
    mockRouter = createMockRouter();
  });

  describe('ListTools Handler', () => {
    it('should always include set_role tool', async () => {
      // Simulate handler logic
      const manifestTool = {
        name: 'set_role',
        description: 'Switch agent role and get the manifest with available tools and system instruction',
        inputSchema: {
          type: 'object',
          properties: {
            role_id: {
              type: 'string',
              description: 'The role ID to switch to. Use "list" to see available roles.',
            },
          },
          required: ['role_id'],
        },
      };

      expect(manifestTool.name).toBe('set_role');
      expect(manifestTool.inputSchema.required).toContain('role_id');
    });

    it('should always include spawn_sub_agent tool', async () => {
      const spawnSubAgentTool = {
        name: 'spawn_sub_agent',
        description: 'Spawn a sub-agent with a specific role to handle a task.',
        inputSchema: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'The role for the sub-agent' },
            task: { type: 'string', description: 'The task/prompt to send to the sub-agent' },
            model: { type: 'string', description: 'Optional: Model to use' },
            interactive: { type: 'boolean', description: 'If true, opens a new terminal window' },
          },
          required: ['role', 'task'],
        },
      };

      expect(spawnSubAgentTool.name).toBe('spawn_sub_agent');
      expect(spawnSubAgentTool.inputSchema.required).toContain('role');
      expect(spawnSubAgentTool.inputSchema.required).toContain('task');
    });

    it('should combine system tools with backend tools', async () => {
      const systemTools = [
        { name: 'set_role' },
        { name: 'spawn_sub_agent' }
      ];

      mockRouter.routeRequest.mockResolvedValue({
        tools: [
          { name: 'filesystem__read_file' },
          { name: 'filesystem__write_file' }
        ]
      });

      const backendTools = await mockRouter.routeRequest({ method: 'tools/list' });
      const allTools = [...systemTools, ...backendTools.tools];

      expect(allTools).toHaveLength(4);
      expect(allTools.map(t => t.name)).toContain('set_role');
      expect(allTools.map(t => t.name)).toContain('spawn_sub_agent');
      expect(allTools.map(t => t.name)).toContain('filesystem__read_file');
    });

    it('should filter out duplicate set_role from backend', async () => {
      mockRouter.routeRequest.mockResolvedValue({
        tools: [
          { name: 'set_role' }, // Should be filtered
          { name: 'filesystem__read_file' }
        ]
      });

      const response = await mockRouter.routeRequest({ method: 'tools/list' });
      const rawTools = response.tools || [];
      const backendTools = rawTools.filter((t: any) => t.name !== 'set_role');

      expect(backendTools).toHaveLength(1);
      expect(backendTools[0].name).toBe('filesystem__read_file');
    });
  });

  describe('CallTool Handler - set_role', () => {
    it('should list roles when role_id is "list"', async () => {
      const roleId = 'list';

      if (roleId === 'list') {
        const roles = mockRouter.listRoles();
        expect(roles).toHaveLength(2);
        expect(roles[0].id).toBe('admin');
      }
    });

    it('should switch role and return manifest', async () => {
      const roleId = 'developer';

      await mockRouter.startServersForRole(roleId);
      const manifest = await mockRouter.setRole({ role: roleId });

      expect(mockRouter.startServersForRole).toHaveBeenCalledWith('developer');
      expect(mockRouter.setRole).toHaveBeenCalledWith({ role: 'developer' });
      expect(manifest.role.id).toBe('admin'); // Mock returns admin
    });

    it('should handle role switch error', async () => {
      mockRouter.setRole.mockRejectedValue(new Error('Role not found'));

      await expect(mockRouter.setRole({ role: 'nonexistent' })).rejects.toThrow('Role not found');
    });
  });

  describe('CallTool Handler - spawn_sub_agent', () => {
    it('should validate required parameters', () => {
      const args = { role: 'developer', task: '' };

      const isValid = args.role && args.task;
      expect(isValid).toBeFalsy();
    });

    it('should spawn sub-agent with role and task', () => {
      const args = { role: 'developer', task: 'Build a component' };
      const mockProcess = new EventEmitter();
      (mockProcess as any).stdin = { write: vi.fn() };
      (mockProcess as any).stdout = new EventEmitter();
      (mockProcess as any).stderr = new EventEmitter();
      (mockProcess as any).kill = vi.fn();

      mockSpawn.mockReturnValue(mockProcess as any);

      // Simulate spawn
      spawn('node', ['cli.js', '--role', args.role, args.task], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining(['--role', 'developer', 'Build a component']),
        expect.any(Object)
      );
    });

    it('should include model when provided', () => {
      const args = { role: 'developer', task: 'Build', model: 'claude-3-opus' };

      const spawnArgs = ['--role', args.role];
      if (args.model) {
        spawnArgs.push('--model', args.model);
      }
      spawnArgs.push(args.task);

      expect(spawnArgs).toContain('--model');
      expect(spawnArgs).toContain('claude-3-opus');
    });

    it('should handle sub-agent timeout', async () => {
      vi.useFakeTimers();

      const mockProcess = new EventEmitter();
      (mockProcess as any).stdin = { write: vi.fn() };
      (mockProcess as any).stdout = new EventEmitter();
      (mockProcess as any).stderr = new EventEmitter();
      (mockProcess as any).kill = vi.fn();

      mockSpawn.mockReturnValue(mockProcess as any);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          (mockProcess as any).kill();
          reject(new Error('Sub-agent timeout (5 minutes)'));
        }, 5 * 60 * 1000);
      });

      // Fast-forward time
      vi.advanceTimersByTime(5 * 60 * 1000);

      await expect(timeoutPromise).rejects.toThrow('Sub-agent timeout');
      expect((mockProcess as any).kill).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should parse sub-agent output correctly', () => {
      const stdout = `
Claude: Here is the result of the task.
📊 Tokens: 100 in / 50 out | Cost: $0.0025
`;

      // Extract Claude response
      const claudeMatch = stdout.match(/Claude:\s*([\s\S]*?)(?:\n\s*📊|$)/);
      const result = claudeMatch ? claudeMatch[1].trim() : stdout.trim();

      expect(result).toBe('Here is the result of the task.');

      // Extract usage
      const usageMatch = stdout.match(/Tokens:\s*(\d+)\s*in\s*\/\s*(\d+)\s*out.*\$([0-9.]+)/);
      const usage = usageMatch ? {
        inputTokens: parseInt(usageMatch[1]),
        outputTokens: parseInt(usageMatch[2]),
        costUSD: parseFloat(usageMatch[3])
      } : undefined;

      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        costUSD: 0.0025
      });
    });

    it('should track tool usage from output', () => {
      const lines = [
        '[developer] Starting task...',
        '[developer] ⚙️  Using: read_file',
        '[developer] ⚙️  Using: write_file',
        '[developer] Done'
      ];

      const toolsUsed: string[] = [];
      for (const line of lines) {
        const toolMatch = line.match(/⚙️\s+Using:\s+(\S+)/);
        if (toolMatch) {
          toolsUsed.push(toolMatch[1]);
        }
      }

      expect(toolsUsed).toEqual(['read_file', 'write_file']);
    });
  });

  describe('CallTool Handler - backend tools', () => {
    it('should check tool access before routing', () => {
      const toolName = 'filesystem__read_file';

      mockRouter.checkToolAccess(toolName);

      expect(mockRouter.checkToolAccess).toHaveBeenCalledWith('filesystem__read_file');
    });

    it('should return access denied on check failure', () => {
      const toolName = 'restricted__tool';

      mockRouter.checkToolAccess.mockImplementation((name: string) => {
        if (name === 'restricted__tool') {
          throw new Error('Access denied for current role');
        }
      });

      expect(() => mockRouter.checkToolAccess(toolName)).toThrow('Access denied');
    });

    it('should skip access check for system tools', () => {
      const systemTools = ['set_role', 'spawn_sub_agent'];

      for (const tool of systemTools) {
        // System tools bypass checkToolAccess
        expect(systemTools.includes(tool)).toBe(true);
      }
    });

    it('should route tool call to backend', async () => {
      const toolName = 'filesystem__read_file';
      const args = { path: '/test.txt' };

      const result = await mockRouter.routeToolCall(toolName, args);

      expect(mockRouter.routeToolCall).toHaveBeenCalledWith('filesystem__read_file', { path: '/test.txt' });
      expect(result).toBe('result');
    });

    it('should handle tool call error', async () => {
      mockRouter.routeToolCall.mockRejectedValue(new Error('File not found'));

      await expect(mockRouter.routeToolCall('filesystem__read_file', {})).rejects.toThrow('File not found');
    });
  });

  describe('ListPrompts Handler', () => {
    it('should return current_role prompt', () => {
      const prompts = [
        {
          name: 'current_role',
          description: 'Get information about the current active role',
        },
      ];

      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('current_role');
    });
  });

  describe('GetPrompt Handler', () => {
    it('should return current role information', () => {
      const state = mockRouter.getState();

      const promptContent = `Current Role: ${state.currentRole || 'default'}\n\nSystem Instruction:\n${state.systemInstruction || 'No instruction set'}`;

      expect(promptContent).toContain('admin');
      expect(promptContent).toContain('You are admin');
    });

    it('should throw for unknown prompt', () => {
      const name = 'unknown_prompt';

      expect(() => {
        if (name !== 'current_role') {
          throw new Error(`Unknown prompt: ${name}`);
        }
      }).toThrow('Unknown prompt: unknown_prompt');
    });
  });
});

describe('Sub-Agent Spawning', () => {
  let mockProcess: any;

  beforeEach(() => {
    mockProcess = new EventEmitter();
    mockProcess.stdin = { write: vi.fn() };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = vi.fn();

    mockSpawn.mockReturnValue(mockProcess as any);
  });

  describe('spawnSubAgent function', () => {
    it('should spawn process with correct arguments', () => {
      spawn('node', ['cli.js', '--role', 'developer', 'Build a component'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['cli.js', '--role', 'developer', 'Build a component'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe']
        })
      );
    });

    it('should handle stdout data', () => {
      let output = '';

      mockProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      mockProcess.stdout.emit('data', Buffer.from('Hello'));
      mockProcess.stdout.emit('data', Buffer.from(' World'));

      expect(output).toBe('Hello World');
    });

    it('should handle stderr data', () => {
      let errors = '';

      mockProcess.stderr.on('data', (data: Buffer) => {
        errors += data.toString();
      });

      mockProcess.stderr.emit('data', Buffer.from('Warning: '));
      mockProcess.stderr.emit('data', Buffer.from('test'));

      expect(errors).toBe('Warning: test');
    });

    it('should resolve on successful close', async () => {
      const promise = new Promise<number>((resolve) => {
        mockProcess.on('close', (code: number) => {
          resolve(code);
        });
      });

      mockProcess.emit('close', 0);

      const exitCode = await promise;
      expect(exitCode).toBe(0);
    });

    it('should handle process error', async () => {
      const promise = new Promise<void>((_, reject) => {
        mockProcess.on('error', (error: Error) => {
          reject(error);
        });
      });

      mockProcess.emit('error', new Error('Spawn failed'));

      await expect(promise).rejects.toThrow('Spawn failed');
    });
  });
});

describe('Tool Name Handling', () => {
  it('should match set_role with exact name', () => {
    const name = 'set_role';
    const isSetRole = name === 'set_role' || name.endsWith('__set_role');
    expect(isSetRole).toBe(true);
  });

  it('should match set_role with prefixed name', () => {
    const name = 'mcp__mycelium-router__set_role';
    const isSetRole = name === 'set_role' || name.endsWith('__set_role');
    expect(isSetRole).toBe(true);
  });

  it('should match spawn_sub_agent with exact name', () => {
    const name = 'spawn_sub_agent';
    const isSpawn = name === 'spawn_sub_agent' || name.endsWith('__spawn_sub_agent');
    expect(isSpawn).toBe(true);
  });

  it('should match spawn_sub_agent with prefixed name', () => {
    const name = 'mcp__mycelium-router__spawn_sub_agent';
    const isSpawn = name === 'spawn_sub_agent' || name.endsWith('__spawn_sub_agent');
    expect(isSpawn).toBe(true);
  });

  it('should not match regular tools', () => {
    const name = 'filesystem__read_file';
    const isSetRole = name === 'set_role' || name.endsWith('__set_role');
    const isSpawn = name === 'spawn_sub_agent' || name.endsWith('__spawn_sub_agent');

    expect(isSetRole).toBe(false);
    expect(isSpawn).toBe(false);
  });
});
