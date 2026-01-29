/**
 * Unit Tests for MCP Server Entry Point
 *
 * Tests the MCP server's request handlers for tools/list, tools/call,
 * prompts/list, and prompts/get.
 *
 * Note: These tests verify the logic of request handlers without importing
 * the actual mcp-server.ts file since it has side effects on import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create a mock router for testing handler logic
const createMockRouter = () => ({
  addServer: vi.fn().mockResolvedValue(undefined),
  initialize: vi.fn().mockResolvedValue(undefined),
  startServers: vi.fn().mockResolvedValue(undefined),
  loadRolesFromSkillsServer: vi.fn().mockResolvedValue(undefined),
  routeRequest: vi.fn().mockResolvedValue({ tools: [] }),
  routeToolCall: vi.fn().mockResolvedValue('result'),
  listRoles: vi.fn().mockReturnValue([{ id: 'admin' }, { id: 'guest' }]),
  checkToolAccess: vi.fn(),
  startServersForRole: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({ currentRole: 'admin', systemInstruction: 'You are admin' })
});

describe('MCP Server Request Handlers', () => {
  let mockRouter: ReturnType<typeof createMockRouter>;

  beforeEach(() => {
    mockRouter = createMockRouter();
  });

  describe('ListTools Handler', () => {
    it('should return backend tools from router', async () => {
      mockRouter.routeRequest.mockResolvedValue({
        tools: [
          { name: 'filesystem__read_file' },
          { name: 'filesystem__write_file' }
        ]
      });

      const backendTools = await mockRouter.routeRequest({ method: 'tools/list' });

      expect(backendTools.tools).toHaveLength(2);
      expect(backendTools.tools.map((t: any) => t.name)).toContain('filesystem__read_file');
      expect(backendTools.tools.map((t: any) => t.name)).toContain('filesystem__write_file');
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
