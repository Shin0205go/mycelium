/**
 * Unit Tests for Agent SDK Integration
 *
 * Tests the agent module's SDK configuration, query creation,
 * message extraction, and tool use detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAgentOptions,
  runQuery,
  createQuery,
  extractTextFromMessage,
  isToolUseMessage,
  getToolUseInfo,
  hasThinkingContent,
  extractThinkingFromMessage,
  createThinkingSignature,
  combineThinkingFromMessages,
  type AgentConfig,
  type ExtractedThinking
} from '../src/agent.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Mock the SDK query function
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}));

import { query as mockQuery } from '@anthropic-ai/claude-agent-sdk';
const mockedQuery = vi.mocked(mockQuery);

describe('createAgentOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('default configuration', () => {
    it('should return options with MYCELIUM Router as MCP server', () => {
      const options = createAgentOptions();

      expect(options.mcpServers).toBeDefined();
      expect(options.mcpServers!['mycelium-router']).toBeDefined();
      expect(options.mcpServers!['mycelium-router'].command).toBe('node');
    });

    it('should disable built-in tools', () => {
      const options = createAgentOptions();

      expect(options.tools).toEqual([]);
    });

    it('should set bypassPermissions mode by default', () => {
      const options = createAgentOptions();

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('should set default model to claude-sonnet', () => {
      const options = createAgentOptions();

      expect(options.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('should set default maxTurns to 50', () => {
      const options = createAgentOptions();

      expect(options.maxTurns).toBe(50);
    });

    it('should disable session persistence', () => {
      const options = createAgentOptions();

      expect(options.persistSession).toBe(false);
    });

    it('should enable partial messages by default', () => {
      const options = createAgentOptions();

      expect(options.includePartialMessages).toBe(true);
    });
  });

  describe('custom configuration', () => {
    it('should use custom model when provided', () => {
      const options = createAgentOptions({ model: 'claude-3-opus' });

      expect(options.model).toBe('claude-3-opus');
    });

    it('should use custom cwd when provided', () => {
      const options = createAgentOptions({ cwd: '/custom/path' });

      expect(options.cwd).toBe('/custom/path');
    });

    it('should use current directory as default cwd', () => {
      const options = createAgentOptions();

      expect(options.cwd).toBe(process.cwd());
    });

    it('should use custom system prompt when provided', () => {
      const options = createAgentOptions({ systemPrompt: 'You are a helpful assistant' });

      expect(options.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should use custom permission mode when provided', () => {
      const options = createAgentOptions({ permissionMode: 'acceptEdits' });

      expect(options.permissionMode).toBe('acceptEdits');
    });

    it('should use custom maxTurns when provided', () => {
      const options = createAgentOptions({ maxTurns: 10 });

      expect(options.maxTurns).toBe(10);
    });

    it('should allow disabling partial messages', () => {
      const options = createAgentOptions({ includePartialMessages: false });

      expect(options.includePartialMessages).toBe(false);
    });
  });

  describe('API key handling', () => {
    it('should exclude ANTHROPIC_API_KEY when useApiKey is false', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const options = createAgentOptions({ useApiKey: false });

      expect(options.env).toBeDefined();
      expect(options.env!.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('should include ANTHROPIC_API_KEY when useApiKey is true', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const options = createAgentOptions({ useApiKey: true });

      expect(options.env).toBeDefined();
      expect(options.env!.ANTHROPIC_API_KEY).toBe('test-key');
    });

    it('should default to not using API key (Claude Code auth)', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const options = createAgentOptions();

      expect(options.env!.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('should preserve other environment variables', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OTHER_VAR = 'other-value';

      const options = createAgentOptions({ useApiKey: false });

      expect(options.env!.OTHER_VAR).toBe('other-value');
    });
  });
});

describe('createQuery', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('should call SDK query with prompt and options', () => {
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {}
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    createQuery('Hello');

    expect(mockedQuery).toHaveBeenCalledWith({
      prompt: 'Hello',
      options: expect.objectContaining({
        mcpServers: expect.any(Object),
        tools: []
      })
    });
  });

  it('should pass custom config to options', () => {
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {}
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    createQuery('Hello', { model: 'custom-model', maxTurns: 5 });

    expect(mockedQuery).toHaveBeenCalledWith({
      prompt: 'Hello',
      options: expect.objectContaining({
        model: 'custom-model',
        maxTurns: 5
      })
    });
  });

  it('should return the query result', () => {
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'result', subtype: 'success' };
      }
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    const result = createQuery('Hello');

    expect(result).toBe(mockQueryResult);
  });
});

describe('runQuery', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('should return success result with text and usage', async () => {
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'Hello, world!',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0.001
        };
      }
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    const result = await runQuery('Hello');

    expect(result).toEqual({
      success: true,
      result: 'Hello, world!',
      error: undefined,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        costUSD: 0.001
      }
    });
  });

  it('should return error result on failure', async () => {
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'result',
          subtype: 'error',
          errors: ['Something went wrong']
        };
      }
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    const result = await runQuery('Hello');

    expect(result).toEqual({
      success: false,
      result: undefined,
      error: 'Something went wrong',
      usage: undefined
    });
  });

  it('should return error subtype when no errors array', async () => {
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'result',
          subtype: 'cancelled'
        };
      }
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    const result = await runQuery('Hello');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Error: cancelled');
  });

  it('should call onMessage callback for each message', async () => {
    const messages: any[] = [];
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } };
        yield { type: 'result', subtype: 'success', result: 'Done', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
      }
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    await runQuery('Hello', {}, (msg) => messages.push(msg));

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('assistant');
    expect(messages[1].type).toBe('result');
  });

  it('should handle exceptions from query', async () => {
    mockedQuery.mockImplementation(() => {
      throw new Error('Connection failed');
    });

    const result = await runQuery('Hello');

    expect(result).toEqual({
      success: false,
      error: 'Connection failed'
    });
  });

  it('should handle async iterator exceptions', async () => {
    const mockQueryResult = {
      [Symbol.asyncIterator]: async function* () {
        throw new Error('Stream error');
      }
    };
    mockedQuery.mockReturnValue(mockQueryResult as any);

    const result = await runQuery('Hello');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Stream error');
  });
});

describe('extractTextFromMessage', () => {
  it('should extract text from assistant message with text content', () => {
    const message: SDKMessage = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'World' }
        ]
      }
    } as SDKMessage;

    const result = extractTextFromMessage(message);

    expect(result).toBe('Hello World');
  });

  it('should return null for non-assistant messages', () => {
    const message = {
      type: 'user',
      message: { content: [{ type: 'text', text: 'Hello' }] }
    } as SDKMessage;

    const result = extractTextFromMessage(message);

    expect(result).toBeNull();
  });

  it('should return null when assistant message has no content', () => {
    const message = {
      type: 'assistant',
      message: {}
    } as SDKMessage;

    const result = extractTextFromMessage(message);

    expect(result).toBeNull();
  });

  it('should filter out non-text content blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: '123', name: 'test', input: {} },
          { type: 'text', text: 'Result: ' },
          { type: 'text', text: 'success' }
        ]
      }
    } as SDKMessage;

    const result = extractTextFromMessage(message);

    expect(result).toBe('Result: success');
  });

  it('should return empty string when no text blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: '123', name: 'test', input: {} }
        ]
      }
    } as SDKMessage;

    const result = extractTextFromMessage(message);

    expect(result).toBe('');
  });
});

describe('isToolUseMessage', () => {
  it('should return true for message with tool_use content', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: '123', name: 'test', input: {} }
        ]
      }
    } as SDKMessage;

    expect(isToolUseMessage(message)).toBe(true);
  });

  it('should return true for message with mixed content including tool_use', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Using tool...' },
          { type: 'tool_use', id: '123', name: 'test', input: {} }
        ]
      }
    } as SDKMessage;

    expect(isToolUseMessage(message)).toBe(true);
  });

  it('should return false for message with only text content', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello' }
        ]
      }
    } as SDKMessage;

    expect(isToolUseMessage(message)).toBe(false);
  });

  it('should return false for non-assistant messages', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_use', id: '123', name: 'test', input: {} }
        ]
      }
    } as SDKMessage;

    expect(isToolUseMessage(message)).toBe(false);
  });

  it('should return false when message has no content', () => {
    const message = {
      type: 'assistant',
      message: {}
    } as SDKMessage;

    expect(isToolUseMessage(message)).toBe(false);
  });
});

describe('getToolUseInfo', () => {
  it('should extract tool use info from message', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: '123', name: 'read_file', input: { path: '/test.txt' } }
        ]
      }
    } as SDKMessage;

    const result = getToolUseInfo(message);

    expect(result).toEqual([
      { name: 'read_file', input: { path: '/test.txt' } }
    ]);
  });

  it('should extract multiple tool uses', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: '1', name: 'tool_a', input: { arg: 'a' } },
          { type: 'text', text: 'Between tools' },
          { type: 'tool_use', id: '2', name: 'tool_b', input: { arg: 'b' } }
        ]
      }
    } as SDKMessage;

    const result = getToolUseInfo(message);

    expect(result).toEqual([
      { name: 'tool_a', input: { arg: 'a' } },
      { name: 'tool_b', input: { arg: 'b' } }
    ]);
  });

  it('should return empty array for non-assistant messages', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_use', id: '123', name: 'test', input: {} }
        ]
      }
    } as SDKMessage;

    const result = getToolUseInfo(message);

    expect(result).toEqual([]);
  });

  it('should return empty array when message has no content', () => {
    const message = {
      type: 'assistant',
      message: {}
    } as SDKMessage;

    const result = getToolUseInfo(message);

    expect(result).toEqual([]);
  });

  it('should return empty array when no tool_use blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello' }
        ]
      }
    } as SDKMessage;

    const result = getToolUseInfo(message);

    expect(result).toEqual([]);
  });
});

// ============================================================================
// Thinking Signature Extraction Tests (Extended Thinking Support)
// ============================================================================

describe('hasThinkingContent', () => {
  it('should return true for message with thinking block', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'I need to analyze this...' }
        ]
      }
    } as SDKMessage;

    expect(hasThinkingContent(message)).toBe(true);
  });

  it('should return true for message with thinking and text blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me think...' },
          { type: 'text', text: 'Here is my response' }
        ]
      }
    } as SDKMessage;

    expect(hasThinkingContent(message)).toBe(true);
  });

  it('should return false for message without thinking block', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Just text' }
        ]
      }
    } as SDKMessage;

    expect(hasThinkingContent(message)).toBe(false);
  });

  it('should return false for non-assistant messages', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          { type: 'thinking', thinking: 'thinking' }
        ]
      }
    } as SDKMessage;

    expect(hasThinkingContent(message)).toBe(false);
  });

  it('should return false when message has no content', () => {
    const message = {
      type: 'assistant',
      message: {}
    } as SDKMessage;

    expect(hasThinkingContent(message)).toBe(false);
  });
});

describe('extractThinkingFromMessage', () => {
  it('should extract thinking content from assistant message', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'I need to read the file first' }
        ]
      }
    } as SDKMessage;

    const result = extractThinkingFromMessage(message);

    expect(result).not.toBeNull();
    expect(result?.thinking).toBe('I need to read the file first');
    expect(result?.hasToolUse).toBe(false);
  });

  it('should combine multiple thinking blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'First, analyze the problem' },
          { type: 'thinking', thinking: 'Then, consider the solution' }
        ]
      }
    } as SDKMessage;

    const result = extractThinkingFromMessage(message);

    expect(result?.thinking).toBe('First, analyze the problem\n\nThen, consider the solution');
  });

  it('should detect tool_use alongside thinking', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'I should read this file' },
          { type: 'tool_use', id: '123', name: 'read_file', input: { path: '/test.ts' } }
        ]
      }
    } as SDKMessage;

    const result = extractThinkingFromMessage(message);

    expect(result?.hasToolUse).toBe(true);
  });

  it('should include provided modelId', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'thinking' }
        ]
      }
    } as SDKMessage;

    const result = extractThinkingFromMessage(message, 'claude-opus-4-5-20251101');

    expect(result?.modelId).toBe('claude-opus-4-5-20251101');
  });

  it('should extract modelId from message if not provided', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'thinking' }
        ],
        model: 'claude-3-opus'
      }
    } as SDKMessage;

    const result = extractThinkingFromMessage(message);

    expect(result?.modelId).toBe('claude-3-opus');
  });

  it('should return null for non-assistant messages', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          { type: 'thinking', thinking: 'thinking' }
        ]
      }
    } as SDKMessage;

    const result = extractThinkingFromMessage(message);

    expect(result).toBeNull();
  });

  it('should return null when no thinking blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Just text' }
        ]
      }
    } as SDKMessage;

    const result = extractThinkingFromMessage(message);

    expect(result).toBeNull();
  });
});

describe('createThinkingSignature', () => {
  it('should create a valid thinking signature', () => {
    const extracted: ExtractedThinking = {
      thinking: 'I analyzed the code and found a bug',
      hasToolUse: true,
      modelId: 'claude-opus-4-5-20251101'
    };

    const signature = createThinkingSignature(extracted, 150);

    expect(signature.thinking).toBe('I analyzed the code and found a bug');
    expect(signature.type).toBe('extended_thinking');
    expect(signature.modelId).toBe('claude-opus-4-5-20251101');
    expect(signature.thinkingTokens).toBe(150);
    expect(signature.capturedAt).toBeInstanceOf(Date);
  });

  it('should work without thinking tokens', () => {
    const extracted: ExtractedThinking = {
      thinking: 'Simple thinking',
      hasToolUse: false
    };

    const signature = createThinkingSignature(extracted);

    expect(signature.thinking).toBe('Simple thinking');
    expect(signature.thinkingTokens).toBeUndefined();
  });
});

describe('combineThinkingFromMessages', () => {
  it('should combine thinking from multiple messages', () => {
    const messages: SDKMessage[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'First thought' }
          ]
        }
      } as SDKMessage,
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Some text' }
          ]
        }
      } as SDKMessage,
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Second thought' },
            { type: 'tool_use', id: '1', name: 'test', input: {} }
          ]
        }
      } as SDKMessage
    ];

    const result = combineThinkingFromMessages(messages);

    expect(result).not.toBeNull();
    expect(result?.thinking).toBe('First thought\n\n---\n\nSecond thought');
    expect(result?.hasToolUse).toBe(true);
  });

  it('should return null when no messages have thinking', () => {
    const messages: SDKMessage[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Just text' }
          ]
        }
      } as SDKMessage
    ];

    const result = combineThinkingFromMessages(messages);

    expect(result).toBeNull();
  });

  it('should capture modelId from messages', () => {
    const messages: SDKMessage[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'thinking' }
          ],
          model: 'claude-3-opus'
        }
      } as SDKMessage
    ];

    const result = combineThinkingFromMessages(messages);

    expect(result?.modelId).toBe('claude-3-opus');
  });

  it('should use provided modelId over message modelId', () => {
    const messages: SDKMessage[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'thinking' }
          ],
          model: 'claude-3-opus'
        }
      } as SDKMessage
    ];

    const result = combineThinkingFromMessages(messages, 'override-model');

    expect(result?.modelId).toBe('override-model');
  });

  it('should detect tool use across any message', () => {
    const messages: SDKMessage[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'thinking only' }
          ]
        }
      } as SDKMessage,
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'thinking with tool' },
            { type: 'tool_use', id: '1', name: 'test', input: {} }
          ]
        }
      } as SDKMessage
    ];

    const result = combineThinkingFromMessages(messages);

    expect(result?.hasToolUse).toBe(true);
  });
});
