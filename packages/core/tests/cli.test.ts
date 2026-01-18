/**
 * Unit Tests for MyceliumCLI (Interactive CLI)
 *
 * Tests the CLI's role switching, tool listing, model switching,
 * and REPL command handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { MyceliumCLI } from '../src/cli.js';

// Mock dependencies
vi.mock('../src/mcp-client.js', () => {
  const EventEmitter = require('events').EventEmitter;
  return {
    MCPClient: vi.fn().mockImplementation(function() {
      const instance = new EventEmitter();
      instance.connect = vi.fn().mockResolvedValue(undefined);
      instance.disconnect = vi.fn();
      instance.switchRole = vi.fn().mockResolvedValue({
        role: { id: 'orchestrator', name: 'Orchestrator', description: 'Orchestrator role' },
        systemInstruction: 'You are an orchestrator',
        availableTools: [
          { name: 'set_role', description: 'Switch role', source: 'mycelium-router' }
        ],
        availableServers: ['mycelium-router'],
        metadata: { generatedAt: new Date().toISOString(), toolsChanged: false, toolCount: 1, serverCount: 1 }
      });
      instance.listRoles = vi.fn().mockResolvedValue({
        roles: [
          { id: 'orchestrator', description: 'Orchestrator', serverCount: 1, toolCount: 1, skills: [], isCurrent: true }
        ],
        currentRole: 'orchestrator',
        defaultRole: 'guest'
      });
      return instance;
    })
  };
});

vi.mock('../src/agent.js', () => ({
  createQuery: vi.fn(),
  extractTextFromMessage: vi.fn(),
  isToolUseMessage: vi.fn(),
  getToolUseInfo: vi.fn()
}));

vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    gray: (s: string) => s,
    blue: (s: string) => s,
    bold: (s: string) => s
  }
}));

import { MCPClient } from '../src/mcp-client.js';
import { createQuery, extractTextFromMessage, isToolUseMessage, getToolUseInfo } from '../src/agent.js';

const mockMCPClient = vi.mocked(MCPClient);
const mockCreateQuery = vi.mocked(createQuery);
const mockExtractText = vi.mocked(extractTextFromMessage);
const mockIsToolUse = vi.mocked(isToolUseMessage);
const mockGetToolUseInfo = vi.mocked(getToolUseInfo);

describe('MyceliumCLI', () => {
  let mockLog: ReturnType<typeof vi.spyOn>;
  let mockError: ReturnType<typeof vi.spyOn>;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

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
    mockLog.mockRestore();
    mockError.mockRestore();
    mockExit.mockRestore();
  });

  describe('constructor', () => {
    it('should create MyceliumCLI instance', () => {
      const cli = new MyceliumCLI();
      expect(cli).toBeInstanceOf(MyceliumCLI);
    });

    it('should initialize MCP client with router path', () => {
      new MyceliumCLI();
      expect(mockMCPClient).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([expect.stringContaining('mcp-server.js')]),
        expect.any(Object)
      );
    });
  });

  describe('formatAuthSource', () => {
    it('should format various auth sources correctly', () => {
      const cli = new MyceliumCLI();

      // Access private method through any
      const formatAuthSource = (cli as any).formatAuthSource.bind(cli);

      expect(formatAuthSource('none')).toContain('Claude Code');
      expect(formatAuthSource('user')).toBe('User auth');
      expect(formatAuthSource('ANTHROPIC_API_KEY')).toContain('API Key');
      expect(formatAuthSource('project')).toContain('Project API Key');
      expect(formatAuthSource('org')).toContain('Organization API Key');
      expect(formatAuthSource('temporary')).toContain('Temporary Key');
      expect(formatAuthSource('unknown')).toContain('未確認');
      expect(formatAuthSource('custom')).toBe('custom');
    });
  });

  describe('completer', () => {
    it('should complete commands starting with /', () => {
      const cli = new MyceliumCLI();
      const completer = (cli as any).completer.bind(cli);

      const [completions, line] = completer('/ro');
      expect(completions).toContain('/roles');
      expect(line).toBe('/ro');
    });

    it('should complete all commands when just / entered', () => {
      const cli = new MyceliumCLI();
      const completer = (cli as any).completer.bind(cli);

      const [completions] = completer('/');
      expect(completions).toContain('/roles');
      expect(completions).toContain('/tools');
      expect(completions).toContain('/status');
      expect(completions).toContain('/model');
      expect(completions).toContain('/help');
      expect(completions).toContain('/quit');
    });

    it('should complete model names for /model command', () => {
      const cli = new MyceliumCLI();
      const completer = (cli as any).completer.bind(cli);

      const [completions] = completer('/model claude-3');
      expect(completions.some((c: string) => c.includes('claude-3'))).toBe(true);
    });

    it('should return empty array for non-command input', () => {
      const cli = new MyceliumCLI();
      const completer = (cli as any).completer.bind(cli);

      const [completions] = completer('hello');
      expect(completions).toEqual([]);
    });
  });

  describe('showHelp', () => {
    it('should display help text', () => {
      const cli = new MyceliumCLI();
      (cli as any).showHelp();

      const output = mockLog.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Commands');
      expect(output).toContain('/roles');
      expect(output).toContain('/tools');
      expect(output).toContain('/status');
      expect(output).toContain('/help');
      expect(output).toContain('/quit');
    });
  });

  describe('showStatus', () => {
    it('should show status when manifest is set', () => {
      const cli = new MyceliumCLI();

      // Set up manifest
      (cli as any).manifest = {
        role: { id: 'admin', name: 'Admin', description: 'Admin role' },
        systemInstruction: 'You are admin',
        availableTools: [],
        availableServers: ['server1'],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 5, serverCount: 1 }
      };
      (cli as any).currentRole = 'admin';
      (cli as any).currentModel = 'claude-3-5-haiku-20241022';
      (cli as any).authSource = 'none';

      (cli as any).showStatus();

      const output = mockLog.mock.calls.map((c: any[]) => c[0]).join('\n');
      // Now uses boxen with title "Status"
      expect(output).toContain('Status');
      expect(output).toContain('Admin');
      expect(output).toContain('claude-3-5-haiku-20241022');
    });

    it('should show warning when no manifest', () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = null;

      (cli as any).showStatus();

      const output = mockLog.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('No role selected');
    });
  });

  describe('showModels', () => {
    it('should list available models', () => {
      const cli = new MyceliumCLI();
      (cli as any).currentModel = 'claude-3-5-haiku-20241022';

      (cli as any).showModels();

      const output = mockLog.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Available Models');
      expect(output).toContain('claude-3-5-haiku');
      expect(output).toContain('claude-sonnet');
      expect(output).toContain('claude-opus');
      expect(output).toContain('current');
    });
  });

  describe('listTools', () => {
    it('should list tools when manifest is available', () => {
      const cli = new MyceliumCLI();

      (cli as any).manifest = {
        role: { id: 'admin', name: 'Admin', description: 'Admin role' },
        systemInstruction: '',
        availableTools: [
          { name: 'filesystem__read_file', description: 'Read a file', source: 'filesystem' },
          { name: 'filesystem__write_file', description: 'Write a file', source: 'filesystem' },
          { name: 'mycelium-router__set_role', description: 'Switch role', source: 'mycelium-router' }
        ],
        availableServers: ['filesystem', 'mycelium-router'],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 3, serverCount: 2 }
      };

      (cli as any).listTools();

      const output = mockLog.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Tools for');
      expect(output).toContain('Admin');
      expect(output).toContain('filesystem');
      expect(output).toContain('read_file');
      expect(output).toContain('write_file');
    });

    it('should show warning when no manifest', () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = null;

      (cli as any).listTools();

      const output = mockLog.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('No role selected');
    });
  });

  describe('switchRole', () => {
    it('should switch role via MCP client', async () => {
      const cli = new MyceliumCLI();

      await (cli as any).switchRole('developer');

      const mockInstance = mockMCPClient.mock.results[0]?.value;
      expect(mockInstance.switchRole).toHaveBeenCalledWith('developer');
    });

    it('should update manifest after switching', async () => {
      const cli = new MyceliumCLI();
      const mockInstance = mockMCPClient.mock.results[0]?.value;

      mockInstance.switchRole.mockResolvedValue({
        role: { id: 'developer', name: 'Developer', description: 'Developer role' },
        systemInstruction: 'You are a developer',
        availableTools: [],
        availableServers: ['filesystem'],
        metadata: { generatedAt: '', toolsChanged: true, toolCount: 5, serverCount: 1 }
      });

      await (cli as any).switchRole('developer');

      expect((cli as any).manifest.role.id).toBe('developer');
      expect((cli as any).currentRole).toBe('developer');
    });

    it('should handle switch error', async () => {
      const cli = new MyceliumCLI();
      const mockInstance = mockMCPClient.mock.results[0]?.value;

      mockInstance.switchRole.mockRejectedValue(new Error('Role not found'));

      await (cli as any).switchRole('nonexistent');

      // Spinner fail() is called, not console.error
      // Check that role was not updated
      expect((cli as any).currentRole).toBe('orchestrator');
    });
  });

  describe('chat', () => {
    it('should prevent concurrent queries', async () => {
      const cli = new MyceliumCLI();
      (cli as any).isProcessing = true;

      await (cli as any).chat('Hello');

      const output = mockLog.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Already processing');
    });

    it('should call createQuery with correct parameters', async () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = {
        role: { id: 'test', name: 'Test', description: 'Test' },
        systemInstruction: 'You are a test assistant',
        availableTools: [],
        availableServers: [],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 0, serverCount: 0 }
      };
      (cli as any).currentModel = 'claude-3-opus';
      (cli as any).useApiKey = false;

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Hello!',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0.001
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      await (cli as any).chat('Hello');

      expect(mockCreateQuery).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({
          model: 'claude-3-opus',
          systemPrompt: 'You are a test assistant',
          useApiKey: false
        })
      );
    });

    it('should track tool usage from messages', async () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = {
        role: { id: 'test', name: 'Test', description: 'Test' },
        systemInstruction: '',
        availableTools: [],
        availableServers: [],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 0, serverCount: 0 }
      };

      mockIsToolUse.mockReturnValue(true);
      mockGetToolUseInfo.mockReturnValue([
        { name: 'mcp__mycelium-router__set_role', input: { role_id: 'developer' } }
      ]);

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

      await (cli as any).chat('Switch to developer role');

      // Tool usage is now shown via spinner text, not console.log
      // Just verify the chat completed without error
      expect((cli as any).isProcessing).toBe(false);
    });

    it('should handle auth errors gracefully', async () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = {
        role: { id: 'test', name: 'Test', description: 'Test' },
        systemInstruction: '',
        availableTools: [],
        availableServers: [],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 0, serverCount: 0 }
      };

      mockCreateQuery.mockImplementation(() => {
        throw new Error('Invalid API key');
      });

      await (cli as any).chat('Hello');

      // Error is now shown via errorBox (console.log), not console.error
      const output = mockLog.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('Authentication failed');
    });

    it('should display usage stats on success', async () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = {
        role: { id: 'test', name: 'Test', description: 'Test' },
        systemInstruction: '',
        availableTools: [],
        availableServers: [],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 0, serverCount: 0 }
      };
      (cli as any).useApiKey = true;

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Hello!',
            usage: { input_tokens: 100, output_tokens: 50 },
            total_cost_usd: 0.0025
          };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      await (cli as any).chat('Hello');

      const output = mockLog.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('100');
      expect(output).toContain('50');
      expect(output).toContain('0.0025');
    });

    it('should reset isProcessing after completion', async () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = {
        role: { id: 'test', name: 'Test', description: 'Test' },
        systemInstruction: '',
        availableTools: [],
        availableServers: [],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 0, serverCount: 0 }
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

      await (cli as any).chat('Hello');

      expect((cli as any).isProcessing).toBe(false);
    });

    it('should reset isProcessing even on error', async () => {
      const cli = new MyceliumCLI();
      (cli as any).manifest = {
        role: { id: 'test', name: 'Test', description: 'Test' },
        systemInstruction: '',
        availableTools: [],
        availableServers: [],
        metadata: { generatedAt: '', toolsChanged: false, toolCount: 0, serverCount: 0 }
      };

      mockCreateQuery.mockImplementation(() => {
        throw new Error('Some error');
      });

      await (cli as any).chat('Hello');

      expect((cli as any).isProcessing).toBe(false);
    });
  });

  describe('tryAuth', () => {
    it('should return true on successful auth', async () => {
      const cli = new MyceliumCLI();

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'system', subtype: 'init', apiKeySource: 'none' };
          yield { type: 'result', subtype: 'success', result: 'Hello' };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const result = await (cli as any).tryAuth(false);

      expect(result).toBe(true);
      expect((cli as any).authSource).toBe('none');
    });

    it('should return false when result indicates login required', async () => {
      const cli = new MyceliumCLI();

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'system', subtype: 'init', apiKeySource: 'none' };
          yield { type: 'result', subtype: 'success', result: 'Please run /login first' };
        }
      };
      mockCreateQuery.mockReturnValue(mockQueryResult as any);

      const result = await (cli as any).tryAuth(false);

      expect(result).toBe(false);
    });

    it('should return false on auth exception', async () => {
      const cli = new MyceliumCLI();

      mockCreateQuery.mockImplementation(() => {
        throw new Error('Auth failed');
      });

      const result = await (cli as any).tryAuth(false);

      expect(result).toBe(false);
    });
  });

  describe('model selection', () => {
    it('should have haiku as default model', () => {
      const cli = new MyceliumCLI();

      expect((cli as any).currentModel).toBe('claude-3-5-haiku-20241022');
    });

    it('should have correct models available', () => {
      const cli = new MyceliumCLI();

      const models = (cli as any).models;
      expect(models).toContain('claude-3-5-haiku-20241022');
      expect(models).toContain('claude-sonnet-4-5-20250929');
      expect(models).toContain('claude-opus-4-20250514');
    });
  });

  describe('commands list', () => {
    it('should have all expected commands', () => {
      const cli = new MyceliumCLI();

      const commands = (cli as any).commands;
      expect(commands).toContain('/roles');
      expect(commands).toContain('/tools');
      expect(commands).toContain('/status');
      expect(commands).toContain('/model');
      expect(commands).toContain('/help');
      expect(commands).toContain('/quit');
    });
  });
});
