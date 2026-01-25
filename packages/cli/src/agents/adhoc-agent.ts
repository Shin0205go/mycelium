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
import { DANGEROUS_TOOL_CATEGORIES } from '@mycelium/adhoc';
import {
  readContext,
  contextExists,
  formatContextForDisplay,
  type WorkflowContext,
} from '../lib/context.js';

/**
 * Approval check result
 */
interface ApprovalInfo {
  required: boolean;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  category?: string;
}

export interface AdhocAgentConfig {
  model?: string;
  contextPath?: string;
  systemPrompt?: string;
  useApiKey?: boolean;
  /** Enable approval prompts for dangerous tools (default: true) */
  requireApproval?: boolean;
  /** Auto-approve dangerous tools in non-interactive mode (default: false) */
  autoApprove?: boolean;
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
  /** Tools that have been approved for this session */
  private approvedTools: Set<string> = new Set();
  /** Tools that have been denied for this session */
  private deniedTools: Set<string> = new Set();

  constructor(config: AdhocAgentConfig = {}) {
    this.config = {
      requireApproval: true,
      ...config,
    };
  }

  /**
   * Check if a tool requires approval
   */
  private checkApprovalRequired(toolName: string): ApprovalInfo {
    // If approval is disabled, skip
    if (!this.config.requireApproval) {
      return { required: false, reason: '', riskLevel: 'low' };
    }

    // If already approved/denied in this session, use cached decision
    if (this.approvedTools.has(toolName)) {
      return { required: false, reason: 'Previously approved', riskLevel: 'low' };
    }
    if (this.deniedTools.has(toolName)) {
      return { required: true, reason: 'Previously denied', riskLevel: 'critical' };
    }

    // Check against dangerous tool categories
    for (const [category, tools] of Object.entries(DANGEROUS_TOOL_CATEGORIES)) {
      for (const dangerousTool of tools) {
        // Match by exact name or suffix (e.g., "write_file" matches "filesystem__write_file")
        const toolSuffix = dangerousTool.includes('__')
          ? dangerousTool.split('__')[1]
          : dangerousTool;

        if (toolName === dangerousTool ||
            toolName.includes(dangerousTool) ||
            toolName.endsWith(toolSuffix)) {
          return {
            required: true,
            reason: `Dangerous operation: ${category}`,
            riskLevel: this.getRiskLevel(category),
            category,
          };
        }
      }
    }

    return { required: false, reason: '', riskLevel: 'low' };
  }

  /**
   * Get risk level for a category
   */
  private getRiskLevel(category: string): ApprovalInfo['riskLevel'] {
    switch (category) {
      case 'SHELL_EXEC':
        return 'critical';
      case 'FILE_WRITE':
        return 'high';
      case 'DATABASE':
        return 'high';
      case 'NETWORK':
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Prompt user for approval
   */
  private async promptApproval(
    toolName: string,
    toolArgs: Record<string, unknown>,
    approvalInfo: ApprovalInfo
  ): Promise<boolean> {
    const riskColors: Record<string, typeof chalk.red> = {
      critical: chalk.red,
      high: chalk.yellow,
      medium: chalk.cyan,
      low: chalk.gray,
    };
    const riskColor = riskColors[approvalInfo.riskLevel] || chalk.white;

    console.log();
    console.log(chalk.yellow('  ⚠️  Approval Required'));
    console.log(chalk.gray('  ────────────────────────────────'));
    console.log(chalk.gray(`  Tool:     ${chalk.white(toolName)}`));
    console.log(chalk.gray(`  Risk:     ${riskColor(approvalInfo.riskLevel.toUpperCase())} (${approvalInfo.category || 'unknown'})`));
    console.log(chalk.gray(`  Reason:   ${approvalInfo.reason}`));

    // Show args preview (truncated)
    const argsStr = JSON.stringify(toolArgs, null, 2);
    const argsPreview = argsStr.length > 200
      ? argsStr.slice(0, 200) + '...'
      : argsStr;
    console.log(chalk.gray(`  Args:`));
    for (const line of argsPreview.split('\n')) {
      console.log(chalk.gray(`    ${line}`));
    }
    console.log(chalk.gray('  ────────────────────────────────'));

    return new Promise((resolve) => {
      // Use existing rl if available, otherwise create temporary one
      const rl = this.rl || readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(chalk.cyan('  Approve? [y/N/always/never]: '), (answer) => {
        if (!this.rl) {
          rl.close();
        }

        const normalized = answer.toLowerCase().trim();

        if (normalized === 'always' || normalized === 'a') {
          this.approvedTools.add(toolName);
          console.log(chalk.green(`  ✓ Approved (always for this session)`));
          resolve(true);
        } else if (normalized === 'never' || normalized === 'n') {
          this.deniedTools.add(toolName);
          console.log(chalk.red(`  ✗ Denied (never for this session)`));
          resolve(false);
        } else if (normalized === 'y' || normalized === 'yes') {
          console.log(chalk.green(`  ✓ Approved (once)`));
          resolve(true);
        } else {
          console.log(chalk.red(`  ✗ Denied`));
          resolve(false);
        }
        console.log();
      });
    });
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
  /help       Show this help
  /context    Show loaded context
  /clear      Clear loaded context
  /approved   Show approved tools for this session
  /denied     Show denied tools for this session
  /reset      Reset approval decisions
  /exit       Exit adhoc agent
  /quit       Exit adhoc agent

${chalk.bold('Approval Options:')}
  When prompted for approval:
  ${chalk.cyan('y/yes')}     - Approve this tool call once
  ${chalk.cyan('n/no')}      - Deny this tool call once
  ${chalk.cyan('always')}    - Always approve this tool in this session
  ${chalk.cyan('never')}     - Never approve this tool in this session
`);
        break;

      case 'approved':
        if (this.approvedTools.size > 0) {
          console.log(chalk.green('Approved tools:'));
          for (const tool of this.approvedTools) {
            console.log(chalk.gray(`  - ${tool}`));
          }
        } else {
          console.log(chalk.dim('No tools approved yet.'));
        }
        break;

      case 'denied':
        if (this.deniedTools.size > 0) {
          console.log(chalk.red('Denied tools:'));
          for (const tool of this.deniedTools) {
            console.log(chalk.gray(`  - ${tool}`));
          }
        } else {
          console.log(chalk.dim('No tools denied yet.'));
        }
        break;

      case 'reset':
        this.approvedTools.clear();
        this.deniedTools.clear();
        console.log(chalk.dim('Approval decisions reset.'));
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
              // Check if approval is required for this tool
              const approvalInfo = this.checkApprovalRequired(block.name);

              if (approvalInfo.required) {
                // If previously denied, show message and skip
                if (this.deniedTools.has(block.name)) {
                  console.log(chalk.red(`\n[Skipped: ${block.name} - previously denied]`));
                  continue;
                }

                // Prompt for approval
                const approved = await this.promptApproval(
                  block.name,
                  block.input as Record<string, unknown>,
                  approvalInfo
                );

                if (!approved) {
                  console.log(chalk.yellow(`[Skipped: ${block.name}]`));
                  continue;
                }
              }

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
  async execute(input: string): Promise<{ success: boolean; result?: string; blockedTools?: string[] }> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');

    // Load context if provided
    await this.loadContext();

    const options = createAdhocAgentOptions(this.config, this.context || undefined);
    const blockedTools: string[] = [];

    try {
      const queryResult = await sdk.query({ prompt: input, options });

      let resultText = '';

      for await (const message of queryResult) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              resultText += block.text;
            } else if (block.type === 'tool_use') {
              // Check approval in non-interactive mode
              const approvalInfo = this.checkApprovalRequired(block.name);

              if (approvalInfo.required && !this.config.autoApprove) {
                // Block dangerous tools in non-interactive mode unless auto-approve is set
                blockedTools.push(block.name);
                console.log(chalk.yellow(`\n[BLOCKED] ${block.name} - ${approvalInfo.reason}`));
                console.log(chalk.dim(`  Risk level: ${approvalInfo.riskLevel}`));
                console.log(chalk.dim(`  Use --auto-approve to allow dangerous operations`));
              } else if (approvalInfo.required && this.config.autoApprove) {
                console.log(chalk.yellow(`\n[AUTO-APPROVED] ${block.name} - ${approvalInfo.reason}`));
              }
            }
          }
        }
      }

      if (blockedTools.length > 0) {
        return {
          success: false,
          result: resultText,
          blockedTools,
        };
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
