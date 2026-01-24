/**
 * Adhoc Agent - Full tool access for investigation and fixes
 *
 * This agent has access to all tools through mycelium-router:
 * - filesystem operations
 * - git operations
 * - shell commands
 * - and more
 *
 * Used for investigating workflow failures and making fixes.
 */

import { join } from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import {
  readContext,
  contextExists,
  formatContextForDisplay,
  type WorkflowContext,
} from '../lib/context.js';

export interface AdhocAgentConfig {
  model?: string;
  contextPath?: string;
  systemPrompt?: string;
  useApiKey?: boolean;
}

// Minimal system prompt - RBAC handles tool restrictions
const ADHOC_SYSTEM_PROMPT = `You are an Adhoc Agent. Use the available tools to complete user requests.`;

// System prompt when context is provided
function createContextSystemPrompt(context: WorkflowContext): string {
  return `${ADHOC_SYSTEM_PROMPT}

## Previous Workflow Failure Context

A workflow script has failed. Here are the details:

**Skill:** ${context.skillId}
**Script:** ${context.scriptPath}
${context.args ? `**Args:** ${context.args.join(' ')}` : ''}
**Exit Code:** ${context.error.exitCode}
**Error Message:** ${context.error.message}

**stderr:**
\`\`\`
${context.error.stderr || '(empty)'}
\`\`\`

**stdout:**
\`\`\`
${context.error.stdout || '(empty)'}
\`\`\`

${context.conversationSummary ? `**Conversation Summary:** ${context.conversationSummary}` : ''}

Please investigate this failure and help the user understand what went wrong.`;
}

/**
 * Create MCP server config for full tool access via mycelium-router
 */
function createAdhocMcpConfig(): Record<string, unknown> {
  const projectRoot = process.cwd();

  // Try monorepo path first, then installed package
  const routerPath = process.env.MYCELIUM_ROUTER_PATH ||
    join(projectRoot, 'packages', 'core', 'dist', 'mcp-server.js');
  const configPath = process.env.MYCELIUM_CONFIG_PATH ||
    join(projectRoot, 'config.json');

  return {
    'mycelium-router': {
      command: 'node',
      args: [routerPath],
      env: {
        MYCELIUM_CONFIG_PATH: configPath,
        // Use adhoc role - has filesystem, git, shell access for investigation
        MYCELIUM_CURRENT_ROLE: 'adhoc',
      },
    },
  };
}

/**
 * Create agent options for Adhoc Agent
 */
export function createAdhocAgentOptions(
  config: AdhocAgentConfig = {},
  context?: WorkflowContext
): Record<string, unknown> {
  let envToUse: Record<string, string>;

  if (config.useApiKey) {
    envToUse = process.env as Record<string, string>;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ANTHROPIC_API_KEY, ...envWithoutApiKey } = process.env;
    envToUse = envWithoutApiKey as Record<string, string>;
  }

  const systemPrompt = context
    ? createContextSystemPrompt(context)
    : config.systemPrompt || ADHOC_SYSTEM_PROMPT;

  return {
    tools: [],
    // Only allow MCP tools - disable all built-in tools for RBAC enforcement
    allowedTools: ['mcp__mycelium-router__*'],
    env: envToUse,
    mcpServers: createAdhocMcpConfig(),
    model: config.model || 'claude-sonnet-4-5-20250929',
    cwd: process.cwd(),
    systemPrompt,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 50,
    includePartialMessages: true,
    persistSession: false,
  };
}

/**
 * Adhoc Agent class
 */
export class AdhocAgent {
  private config: AdhocAgentConfig;
  private context: WorkflowContext | null = null;
  private rl: readline.Interface | null = null;

  constructor(config: AdhocAgentConfig = {}) {
    this.config = config;
  }

  /**
   * Load context from file if provided
   */
  private async loadContext(): Promise<void> {
    if (!this.config.contextPath) return;

    if (!(await contextExists(this.config.contextPath))) {
      console.log(chalk.yellow(`Context file not found: ${this.config.contextPath}`));
      return;
    }

    try {
      this.context = await readContext(this.config.contextPath);
      console.log(chalk.cyan('┌─────────────────────────────────────┐'));
      console.log(chalk.cyan('│  Loaded Workflow Context            │'));
      console.log(chalk.cyan('└─────────────────────────────────────┘'));
      console.log();
      console.log(formatContextForDisplay(this.context));
      console.log();
    } catch (error) {
      console.log(chalk.yellow(`Failed to load context: ${(error as Error).message}`));
    }
  }

  /**
   * Run the adhoc agent interactively
   */
  async run(): Promise<void> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');

    // Load context if provided
    await this.loadContext();

    console.log(chalk.magenta('┌─────────────────────────────────────┐'));
    console.log(chalk.magenta('│  Adhoc Agent                        │'));
    console.log(chalk.magenta('│  Full tool access for investigation │'));
    console.log(chalk.magenta('│  Type your request or /help         │'));
    console.log(chalk.magenta('└─────────────────────────────────────┘'));
    console.log();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = (): Promise<string> => {
      return new Promise((resolve) => {
        this.rl!.question(chalk.magenta('adhoc> '), resolve);
      });
    };

    // If context is loaded, offer to start investigation
    if (this.context) {
      console.log(chalk.dim('Context loaded. Type "investigate" to start analysis or ask a specific question.'));
      console.log();
    }

    while (true) {
      const input = await prompt();
      const trimmed = input.trim();

      if (!trimmed) continue;

      // Handle commands
      if (trimmed.startsWith('/')) {
        const handled = await this.handleCommand(trimmed);
        if (handled === 'exit') break;
        continue;
      }

      // Process with LLM
      await this.processInput(trimmed, sdk);
    }

    this.rl.close();
  }

  /**
   * Handle slash commands
   */
  private async handleCommand(input: string): Promise<string | void> {
    const [cmd] = input.slice(1).split(' ');

    switch (cmd.toLowerCase()) {
      case 'help':
        console.log(`
${chalk.bold('Commands:')}
  /help     Show this help
  /context  Show loaded context
  /clear    Clear loaded context
  /exit     Exit adhoc agent
  /quit     Exit adhoc agent
`);
        break;

      case 'context':
        if (this.context) {
          console.log(formatContextForDisplay(this.context));
        } else {
          console.log(chalk.dim('No context loaded.'));
        }
        break;

      case 'clear':
        this.context = null;
        console.log(chalk.dim('Context cleared.'));
        break;

      case 'exit':
      case 'quit':
        return 'exit';

      default:
        console.log(chalk.yellow(`Unknown command: ${cmd}`));
    }
  }

  /**
   * Process user input through the LLM
   */
  private async processInput(
    input: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdk: any
  ): Promise<void> {
    try {
      const options = createAdhocAgentOptions(this.config, this.context || undefined);
      const queryResult = await sdk.query({ prompt: input, options });

      for await (const message of queryResult) {
        // Handle text output
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              console.log(block.text);
            } else if (block.type === 'tool_use') {
              console.log(chalk.dim(`\n[Using: ${block.name}]`));
            }
          }
        }

        // Handle final result
        if (message.type === 'result') {
          if (message.subtype !== 'success') {
            console.log(chalk.red(`\nError: ${message.errors?.join(', ') || 'Unknown error'}`));
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }
  }

  /**
   * Execute a single adhoc command (non-interactive)
   */
  async execute(input: string): Promise<{ success: boolean; result?: string }> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');

    // Load context if provided
    await this.loadContext();

    const options = createAdhocAgentOptions(this.config, this.context || undefined);

    try {
      const queryResult = await sdk.query({ prompt: input, options });

      let resultText = '';

      for await (const message of queryResult) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              resultText += block.text;
            }
          }
        }
      }

      return { success: true, result: resultText };
    } catch (error) {
      return { success: false, result: (error as Error).message };
    }
  }
}

/**
 * Create and run an Adhoc Agent
 */
export async function runAdhocAgent(config: AdhocAgentConfig = {}): Promise<void> {
  const agent = new AdhocAgent(config);
  await agent.run();
}
