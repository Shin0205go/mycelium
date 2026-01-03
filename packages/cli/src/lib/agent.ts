/**
 * Agent SDK integration for AEGIS CLI
 * Routes all tool calls through AEGIS Router
 */

import { join } from 'path';

export interface AgentConfig {
  model?: string;
  cwd?: string;
  systemPrompt?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';
  allowDangerouslySkipPermissions?: boolean;
  maxTurns?: number;
  includePartialMessages?: boolean;
  useApiKey?: boolean;
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
 * Create agent options with AEGIS Router as the only tool source
 */
export function createAgentOptions(config: AgentConfig = {}): Record<string, unknown> {
  const projectRoot = process.cwd();
  const AEGIS_ROUTER_PATH = process.env.AEGIS_ROUTER_PATH ||
    join(projectRoot, 'node_modules', '@aegis', 'core', 'dist', 'mcp-server.js');
  const AEGIS_CONFIG_PATH = process.env.AEGIS_CONFIG_PATH ||
    join(projectRoot, 'config.json');

  let envToUse: Record<string, string>;

  if (config.useApiKey) {
    envToUse = process.env as Record<string, string>;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ANTHROPIC_API_KEY, ...envWithoutApiKey } = process.env;
    envToUse = envWithoutApiKey as Record<string, string>;
  }

  return {
    tools: [],
    env: envToUse,
    mcpServers: {
      'aegis-router': {
        command: 'node',
        args: [AEGIS_ROUTER_PATH],
        env: {
          AEGIS_CONFIG_PATH
        }
      }
    },
    model: config.model || 'claude-sonnet-4-5-20250929',
    cwd: config.cwd || process.cwd(),
    systemPrompt: config.systemPrompt,
    permissionMode: config.permissionMode || 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: config.maxTurns || 50,
    includePartialMessages: config.includePartialMessages ?? true,
    persistSession: false
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SDKMessage = any;

/**
 * Create a streaming query for interactive use
 */
export async function createQuery(
  prompt: string,
  config: AgentConfig = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<AsyncIterable<any>> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const options = createAgentOptions(config);
  return sdk.query({ prompt, options });
}

/**
 * Run a single query through the agent
 */
export async function runQuery(
  prompt: string,
  config: AgentConfig = {},
  onMessage?: (message: SDKMessage) => void
): Promise<AgentResult> {
  try {
    const queryResult = await createQuery(prompt, config);

    let result: string | undefined;
    let usage: AgentResult['usage'] | undefined;
    let error: string | undefined;

    for await (const message of queryResult) {
      if (onMessage) {
        onMessage(message);
      }

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
  } catch (e: unknown) {
    const err = e as Error;
    return {
      success: false,
      error: err.message || String(e)
    };
  }
}

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

type ContentBlock = TextBlock | ToolUseBlock | { type: string };

/**
 * Extract text content from assistant messages
 */
export function extractTextFromMessage(message: SDKMessage): string | null {
  if (message.type === 'assistant' && message.message?.content) {
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
  if (message.type === 'assistant' && message.message?.content) {
    const content = message.message.content as ContentBlock[];
    return content.some(block => block.type === 'tool_use');
  }
  return false;
}

/**
 * Get tool use info from message
 */
export function getToolUseInfo(message: SDKMessage): Array<{ name: string; input: unknown }> {
  if (message.type === 'assistant' && message.message?.content) {
    const content = message.message.content as ContentBlock[];
    return content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map(block => ({ name: block.name, input: block.input }));
  }
  return [];
}
