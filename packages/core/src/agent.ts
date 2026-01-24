/**
 * Agent SDK integration for MYCELIUM CLI
 * Routes all tool calls through MYCELIUM Router, excluding built-in tools
 */

import { query, type SDKMessage, type Query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve paths relative to monorepo root
// When running from dist/, __dirname is packages/core/dist
// When running from src/ (tsx), __dirname is packages/core/src
// Either way, go up to packages/core, then to packages/, then to monorepo root
const projectRoot = join(__dirname, '..', '..', '..');
const MYCELIUM_ROUTER_PATH = process.env.MYCELIUM_ROUTER_PATH ||
  join(projectRoot, 'packages', 'core', 'dist', 'mcp-server.js');
const MYCELIUM_CONFIG_PATH = process.env.MYCELIUM_CONFIG_PATH ||
  join(projectRoot, 'config.json');

export interface AgentConfig {
  model?: string;
  cwd?: string;
  systemPrompt?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';
  allowDangerouslySkipPermissions?: boolean;
  maxTurns?: number;
  includePartialMessages?: boolean;
  useApiKey?: boolean; // true = use ANTHROPIC_API_KEY, false = use Claude Code auth
}

export interface AgentResult {
  success: boolean;
  result?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
}

/**
 * Create agent options with MYCELIUM Router as the only tool source
 */
export function createAgentOptions(config: AgentConfig = {}): Options {
  // Determine which env to use based on useApiKey flag
  let envToUse: Record<string, string>;

  if (config.useApiKey) {
    // Use ANTHROPIC_API_KEY (課金)
    envToUse = process.env as Record<string, string>;
  } else {
    // Remove ANTHROPIC_API_KEY to use Claude Code auth (Max plan)
    const { ANTHROPIC_API_KEY, ...envWithoutApiKey } = process.env;
    envToUse = envWithoutApiKey as Record<string, string>;
  }

  return {
    // Disable all built-in tools
    tools: [],

    // Use appropriate auth
    env: envToUse,

    // Route everything through MYCELIUM Router
    mcpServers: {
      'mycelium-router': {
        command: 'node',
        args: [MYCELIUM_ROUTER_PATH],
        env: {
          MYCELIUM_CONFIG_PATH
        }
      }
    },

    // Configuration
    model: config.model || 'claude-sonnet-4-5-20250929',
    cwd: config.cwd || process.cwd(),
    systemPrompt: config.systemPrompt,
    // Use bypassPermissions for MCP tools - MYCELIUM Router handles access control
    permissionMode: config.permissionMode || 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: config.maxTurns || 50,
    includePartialMessages: config.includePartialMessages ?? true,

    // Don't persist sessions for CLI usage
    persistSession: false
  };
}

/**
 * Run a single query through the agent
 */
export async function runQuery(
  prompt: string,
  config: AgentConfig = {},
  onMessage?: (message: SDKMessage) => void
): Promise<AgentResult> {
  const options = createAgentOptions(config);

  try {
    const queryResult = query({ prompt, options });

    let result: string | undefined;
    let usage: AgentResult['usage'] | undefined;
    let error: string | undefined;

    for await (const message of queryResult) {
      // Callback for streaming
      if (onMessage) {
        onMessage(message);
      }

      // Capture result
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          result = message.result;
          usage = {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            costUSD: message.total_cost_usd
          };
        } else {
          error = message.errors?.join(', ') || `Error: ${message.subtype}`;
        }
      }
    }

    return {
      success: !error,
      result,
      error,
      usage
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || String(e)
    };
  }
}

/**
 * Create a streaming query for interactive use
 */
export function createQuery(
  prompt: string,
  config: AgentConfig = {}
): Query {
  const options = createAgentOptions(config);
  return query({ prompt, options });
}

// Content block types from API
interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

/**
 * Thinking block from extended thinking models (e.g., Claude Opus 4.5)
 * Contains the model's reasoning process before making decisions
 */
interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock | { type: string };

/**
 * Extracted thinking signature from a message
 */
export interface ExtractedThinking {
  /** The thinking content */
  thinking: string;
  /** Whether this message also includes tool use */
  hasToolUse: boolean;
  /** The model that produced the thinking */
  modelId?: string;
}

/**
 * Extract text content from assistant messages
 */
export function extractTextFromMessage(message: SDKMessage): string | null {
  if (message.type === 'assistant' && message.message.content) {
    const content = message.message.content as ContentBlock[];
    const textBlocks = content.filter(
      (block): block is TextBlock => block.type === 'text'
    );
    return textBlocks.map(b => b.text).join('');
  }
  return null;
}

/**
 * Check if message is a tool use
 */
export function isToolUseMessage(message: SDKMessage): boolean {
  if (message.type === 'assistant' && message.message.content) {
    const content = message.message.content as ContentBlock[];
    return content.some(block => block.type === 'tool_use');
  }
  return false;
}

/**
 * Get tool use info from message
 */
export function getToolUseInfo(message: SDKMessage): Array<{ name: string; input: unknown }> {
  if (message.type === 'assistant' && message.message.content) {
    const content = message.message.content as ContentBlock[];
    return content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map(block => ({ name: block.name, input: block.input }));
  }
  return [];
}

/**
 * Check if message contains thinking blocks (extended thinking)
 */
export function hasThinkingContent(message: SDKMessage): boolean {
  if (message.type === 'assistant' && message.message.content) {
    const content = message.message.content as ContentBlock[];
    return content.some(block => block.type === 'thinking');
  }
  return false;
}

/**
 * Extract thinking content from assistant messages.
 * Thinking blocks are produced by models with extended thinking enabled (e.g., Claude Opus 4.5).
 *
 * @param message - The SDK message to extract thinking from
 * @param modelId - Optional model ID to include in the result
 * @returns Extracted thinking or null if no thinking found
 *
 * @example
 * ```typescript
 * for await (const message of queryResult) {
 *   const thinking = extractThinkingFromMessage(message, 'claude-opus-4-5-20251101');
 *   if (thinking && thinking.hasToolUse) {
 *     // Capture this thinking for the tool call audit log
 *     router.setThinkingContext({
 *       thinking: thinking.thinking,
 *       type: 'extended_thinking',
 *       modelId: thinking.modelId,
 *       capturedAt: new Date(),
 *     });
 *   }
 * }
 * ```
 */
export function extractThinkingFromMessage(
  message: SDKMessage,
  modelId?: string
): ExtractedThinking | null {
  if (message.type !== 'assistant' || !message.message.content) {
    return null;
  }

  const content = message.message.content as ContentBlock[];

  // Find thinking blocks
  const thinkingBlocks = content.filter(
    (block): block is ThinkingBlock => block.type === 'thinking'
  );

  if (thinkingBlocks.length === 0) {
    return null;
  }

  // Combine all thinking blocks
  const thinking = thinkingBlocks.map(b => b.thinking).join('\n\n');

  // Check if there are also tool use blocks
  const hasToolUse = content.some(block => block.type === 'tool_use');

  return {
    thinking,
    hasToolUse,
    modelId: modelId || (message.message as any).model,
  };
}

/**
 * Create a ThinkingSignature from extracted thinking.
 * This can be passed to MyceliumRouterCore.setThinkingContext() for audit logging.
 *
 * @param extracted - The extracted thinking from a message
 * @param thinkingTokens - Optional number of thinking tokens used
 * @returns ThinkingSignature object ready for use with MYCELIUM Router
 */
export function createThinkingSignature(
  extracted: ExtractedThinking,
  thinkingTokens?: number
): {
  thinking: string;
  type: 'extended_thinking' | 'chain_of_thought' | 'reasoning';
  modelId?: string;
  thinkingTokens?: number;
  capturedAt: Date;
} {
  return {
    thinking: extracted.thinking,
    type: 'extended_thinking',
    modelId: extracted.modelId,
    thinkingTokens,
    capturedAt: new Date(),
  };
}

/**
 * Get all thinking content from a stream of messages.
 * Useful for capturing the complete thinking process across multiple messages.
 *
 * @param messages - Array of SDK messages to process
 * @param modelId - Optional model ID to include
 * @returns Combined thinking content or null if none found
 */
export function combineThinkingFromMessages(
  messages: SDKMessage[],
  modelId?: string
): ExtractedThinking | null {
  const allThinking: string[] = [];
  let hasToolUse = false;
  let foundModelId: string | undefined = modelId;

  for (const message of messages) {
    const extracted = extractThinkingFromMessage(message, modelId);
    if (extracted) {
      allThinking.push(extracted.thinking);
      if (extracted.hasToolUse) {
        hasToolUse = true;
      }
      if (!foundModelId && extracted.modelId) {
        foundModelId = extracted.modelId;
      }
    }
  }

  if (allThinking.length === 0) {
    return null;
  }

  return {
    thinking: allThinking.join('\n\n---\n\n'),
    hasToolUse,
    modelId: foundModelId,
  };
}
