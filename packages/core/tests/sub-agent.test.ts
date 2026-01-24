/**
 * Unit Tests for SubAgent (Non-interactive mode)
 *
 * Tests the SubAgent class for non-interactive CLI mode,
 * including query execution, stdin reading, and output formatting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubAgent, type SubAgentResult } from '../src/sub-agent.js';
import type { CliArgs } from '../src/args.js';

// Mock dependencies
vi.mock('../src/mcp-client.js', () => {
  return {
    MCPClient: vi.fn().mockImplementation(function() {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        switchRole: vi.fn().mockResolvedValue({
          role: { id: 'test', name: 'Test', description: 'Test role' },
          systemInstruction: 'You are a test agent',
          availableTools: [],
          availableServers: [],
          metadata: { generatedAt: new Date().toISOString(), toolsChanged: false, toolCount: 0, serverCount: 0 }
        })
      };
    })
  };
});

vi.mock('../src/agent.js', () => ({
  createQuery: vi.fn(),
  extractTextFromMessage: vi.fn(),
  isToolUseMessage: vi.fn(),
  getToolUseInfo: vi.fn()
}));

import { MCPClient } from '../src/mcp-client.js';
import { createQuery, extractTextFromMessage, isToolUseMessage, getToolUseInfo } from '../src/agent.js';

const mockMCPClient = vi.mocked(MCPClient);
const mockCreateQuery = vi.mocked(createQuery);
const mockExtractText = vi.mocked(extractTextFromMessage);
const mockIsToolUse = vi.mocked(isToolUseMessage);
const mockGetToolUseInfo = vi.mocked(getToolUseInfo);

describe('SubAgent', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockLog: ReturnType<typeof vi.spyOn>;
  let mockError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset mocks
    mockMCPClient.mockClear();
    mockCreateQuery.mockReset();
    mockExtractText.mockReset();
    mockIsToolUse.mockReset();
    mockGetToolUseInfo.mockReset();

    // Default mock implementations
    mockIsToolUse.mockReturnValue(false);
    mockGetToolUseInfo.mockReturnValue([]);
    mockExtractText.mockReturnValue(null);
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockLog.mockRestore();
    mockError.mockRestore();
  });

  describe('constructor', () => {
    it('should create SubAgent with args', () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test'
      };

      const agent = new SubAgent(args);

      expect(agent).toBeInstanceOf(SubAgent);
    });

    it('should initialize MCP client', () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test'
      };

      new SubAgent(args);

      expect(mockMCPClient).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([expect.stringContaining('mcp-server.js')]),
        expect.any(Object)
      );
    });
  });

  describe('run', () => {
    it('should exit with error when no prompt provided', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: undefined
      };

      // Mock stdin as TTY (no pipe input)
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockExit).toHaveBeenCalledWith(1);

      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('should connect to MCP and switch role', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt',
        role: 'developer'
      };

      // Setup successful query
      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      // Verify MCP client was instantiated
      expect(mockMCPClient).toHaveBeenCalled();
      // Verify connect and switchRole were called on the instance
      const mockInstance = mockMCPClient.mock.results[0]?.value;
      expect(mockInstance.connect).toHaveBeenCalled();
      expect(mockInstance.switchRole).toHaveBeenCalledWith('developer');
    });

    it('should use orchestrator as default role', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      const mockInstance = mockMCPClient.mock.results[0]?.value;
      expect(mockInstance.switchRole).toHaveBeenCalledWith('orchestrator');
    });

    it('should pass custom model to createQuery', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt',
        model: 'claude-3-opus'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockCreateQuery).toHaveBeenCalledWith(
        'test prompt',
        expect.objectContaining({
          model: 'claude-3-opus'
        })
      );
    });

    it('should exit with 0 on success', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Success result',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should exit with 1 on error', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'error',
            errors: ['Something went wrong']
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should disconnect on completion', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      const mockInstance = mockMCPClient.mock.results[0]?.value;
      expect(mockInstance.disconnect).toHaveBeenCalled();
    });
  });

  describe('tool tracking', () => {
    it('should collect tool usage from messages', async () => {
      const args: CliArgs = {
        interactive: false,
        json: true,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      mockIsToolUse.mockReturnValueOnce(true).mockReturnValue(false);
      mockGetToolUseInfo.mockReturnValueOnce([
        { name: 'mcp__mycelium-router__read_file', input: {} },
        { name: 'mcp__mycelium-router__write_file', input: {} }
      ]).mockReturnValue([]);

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'assistant', message: { content: [] } };
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      // Check JSON output includes tools used
      const logCalls = mockLog.mock.calls;
      const jsonOutput = logCalls.find(call => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.toolsUsed !== undefined;
        } catch {
          return false;
        }
      });

      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput![0]);
      expect(parsed.toolsUsed).toContain('read_file');
      expect(parsed.toolsUsed).toContain('write_file');
    });
  });

  describe('output formatting', () => {
    it('should output JSON format when --json flag is set', async () => {
      const args: CliArgs = {
        interactive: false,
        json: true,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);
      mockExtractText.mockReturnValue('Done');

      const agent = new SubAgent(args);
      await agent.run();

      const logCalls = mockLog.mock.calls;
      const jsonCall = logCalls.find(call => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.success).toBe(true);
      expect(parsed.role).toBe('orchestrator');
    });

    it('should output plain text when --json flag is not set', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello World' }] } };
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Hello World',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);
      mockExtractText.mockReturnValue('Hello World');

      const agent = new SubAgent(args);
      await agent.run();

      // Check that result was logged (not as JSON)
      const logCalls = mockLog.mock.calls;
      expect(logCalls.some(call => call[0] === 'Hello World')).toBe(true);
    });

    it('should output JSON error format when --json flag is set', async () => {
      const args: CliArgs = {
        interactive: false,
        json: true,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'error',
            errors: ['Failed to process']
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      const logCalls = mockLog.mock.calls;
      const jsonCall = logCalls.find(call => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.success === false;
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Failed to process');
    });
  });

  describe('error handling', () => {
    it('should handle MCP connection error', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      // Override mock to reject on connect
      mockMCPClient.mockImplementationOnce(function() {
        return {
          connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
          disconnect: vi.fn(),
          switchRole: vi.fn()
        };
      });

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockError).toHaveBeenCalledWith('Error: Connection refused');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle role switch error', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      // Override mock to reject on switchRole
      mockMCPClient.mockImplementationOnce(function() {
        return {
          connect: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn(),
          switchRole: vi.fn().mockRejectedValue(new Error('Role not found'))
        };
      });

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockError).toHaveBeenCalledWith('Error: Role not found');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle query execution error', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: false,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      mockCreateQuery.mockImplementation(() => {
        throw new Error('Query failed');
      });

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('useApiKey flag', () => {
    it('should pass useApiKey to createQuery', async () => {
      const args: CliArgs = {
        interactive: false,
        json: false,
        useApiKey: true,
        help: false,
        version: false,
        prompt: 'test prompt'
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const agent = new SubAgent(args);
      await agent.run();

      expect(mockCreateQuery).toHaveBeenCalledWith(
        'test prompt',
        expect.objectContaining({
          useApiKey: true
        })
      );
    });
  });
});
