/**
 * Agent SDK integration for Mycelium CLI
 * Routes all tool calls through Mycelium Router, excluding built-in tools
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
  currentRole?: string; // Role to set on MCP server startup
  persistSession?: boolean; // Whether to persist session to disk
  continueSession?: boolean; // Whether to continue from previous session
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
 * Create agent options with Mycelium Router as the only tool source
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

  // Build MCP server environment
  const mcpEnv: Record<string, string> = {
    MYCELIUM_CONFIG_PATH,
  };

  // If currentRole is specified, pass it to MCP server
  // MCP server will auto-switch to this role on startup
  if (config.currentRole) {
    mcpEnv.MYCELIUM_CURRENT_ROLE = config.currentRole;
  }

  return {
    // Disable all built-in tools
    tools: [],

    // Use appropriate auth
    env: envToUse,

    // Route everything through Mycelium Router
    mcpServers: {
      'mycelium-router': {
        command: 'node',
        args: [MYCELIUM_ROUTER_PATH],
        env: mcpEnv
      }
    },

    // Configuration
    model: config.model || 'claude-sonnet-4-5-20250929',
    cwd: config.cwd || process.cwd(),
    systemPrompt: config.systemPrompt,
    // Use bypassPermissions for MCP tools - Mycelium Router handles access control
    permissionMode: config.permissionMode || 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: config.maxTurns || 50,
    includePartialMessages: config.includePartialMessages ?? true,

    // Session persistence
    persistSession: config.persistSession ?? false,
    continue: config.continueSession ?? false
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

type ContentBlock = TextBlock | ToolUseBlock | { type: string };

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
