/**
 * Workflow Agent - Executes skill scripts only
 *
 * This agent is restricted to skill-based operations:
 * - list_skills: View available skills
 * - get_skill: Get skill details
 * - run_script: Execute skill scripts
 *
 * On failure, saves context for Adhoc agent handoff.
 */

import { join } from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import {
  writeContext,
  getDefaultContextPath,
  type WorkflowContext,
} from '../lib/context.js';

export interface WorkflowAgentConfig {
  model?: string;
  skillsDir?: string;
  systemPrompt?: string;
  useApiKey?: boolean;
  onFailure?: 'prompt' | 'auto' | 'exit';
}

interface ScriptResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

// System prompt that constrains the agent to workflow operations only
const WORKFLOW_SYSTEM_PROMPT = `You are a Workflow Orchestrator that coordinates tasks by spawning specialized sub-agents.

Your capabilities are LIMITED to:
1. list_skills - View available skills and their descriptions
2. get_skill - Get detailed information about a specific skill
3. list_roles - View available roles
4. spawn_sub_agent - Spawn a sub-agent with a specific role to execute tasks

You CANNOT:
- Access the filesystem directly
- Run scripts directly
- Run arbitrary shell commands
- Use any tools other than those listed above

When a user asks you to perform a task:
1. First check available skills with list_skills
2. Find the appropriate skill for the task
3. Use spawn_sub_agent to create a sub-agent with the skill's role
4. The sub-agent will have access to run_script and other tools defined in the skill

If a sub-agent fails, provide clear error information and suggest the user run "aegis adhoc" to investigate.`;

/**
 * Create MCP server config via aegis-router with orchestrator role
 * This ensures RBAC is applied - only aegis-skills tools are accessible
 */
function createWorkflowMcpConfig(): Record<string, unknown> {
  const projectRoot = process.cwd();

  const routerPath = process.env.AEGIS_ROUTER_PATH ||
    join(projectRoot, 'packages', 'core', 'dist', 'mcp-server.js');
  const configPath = process.env.AEGIS_CONFIG_PATH ||
    join(projectRoot, 'config.json');

  return {
    'aegis-router': {
      command: 'node',
      args: [routerPath],
      env: {
        AEGIS_CONFIG_PATH: configPath,
        // Use orchestrator role - restricted to aegis-skills tools only
        AEGIS_CURRENT_ROLE: 'orchestrator',
      },
    },
  };
}

/**
 * Create agent options for Workflow Agent
 */
export function createWorkflowAgentOptions(config: WorkflowAgentConfig = {}): Record<string, unknown> {
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
    mcpServers: createWorkflowMcpConfig(),
    model: config.model || 'claude-sonnet-4-5-20250929',
    cwd: process.cwd(),
    systemPrompt: config.systemPrompt || WORKFLOW_SYSTEM_PROMPT,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 20,
    includePartialMessages: true,
    persistSession: false,
  };
}

/**
 * Parse run_script result from tool response
 */
function parseScriptResult(toolResult: unknown): ScriptResult | null {
  try {
    if (typeof toolResult === 'string') {
      return JSON.parse(toolResult) as ScriptResult;
    }
    return toolResult as ScriptResult;
  } catch {
    return null;
  }
}

/**
 * Save failure context for Adhoc handoff
 */
async function saveFailureContext(
  skillId: string,
  scriptPath: string,
  args: string[] | undefined,
  result: ScriptResult,
  conversationSummary?: string
): Promise<string> {
  const context: WorkflowContext = {
    skillId,
    scriptPath,
    args,
    error: {
      message: `Script exited with code ${result.exitCode}`,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    },
    timestamp: new Date().toISOString(),
    conversationSummary,
  };

  return writeContext(context);
}

/**
 * Workflow Agent class
 */
export class WorkflowAgent {
  private config: WorkflowAgentConfig;
  private rl: readline.Interface | null = null;
  private lastScriptCall: {
    skillId: string;
    scriptPath: string;
    args?: string[];
  } | null = null;

  constructor(config: WorkflowAgentConfig = {}) {
    this.config = config;
  }

  /**
   * Run the workflow agent interactively
   */
  async run(): Promise<void> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');

    console.log(chalk.cyan('┌─────────────────────────────────────┐'));
    console.log(chalk.cyan('│  Workflow Agent                     │'));
    console.log(chalk.cyan('│  Type your request or /help         │'));
    console.log(chalk.cyan('└─────────────────────────────────────┘'));
    console.log();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = (): Promise<string> => {
      return new Promise((resolve) => {
        this.rl!.question(chalk.green('workflow> '), resolve);
      });
    };

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
    const [cmd, ...args] = input.slice(1).split(' ');

    switch (cmd.toLowerCase()) {
      case 'help':
        console.log(`
${chalk.bold('Commands:')}
  /help     Show this help
  /skills   List available skills
  /exit     Exit workflow agent
  /quit     Exit workflow agent
`);
        break;

      case 'skills':
        console.log(chalk.dim('Use "list skills" to see available skills via the agent.'));
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
      const options = createWorkflowAgentOptions(this.config);
      const queryResult = await sdk.query({ prompt: input, options });

      let lastFailedResult: ScriptResult | null = null;

      for await (const message of queryResult) {
        // Handle text output
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              console.log(block.text);
            } else if (block.type === 'tool_use') {
              // Track run_script calls
              if (block.name === 'aegis-skills__run_script') {
                this.lastScriptCall = {
                  skillId: (block.input as any)?.skill || '',
                  scriptPath: (block.input as any)?.path || '',
                  args: (block.input as any)?.args,
                };
                console.log(chalk.dim(`\n[Executing: ${this.lastScriptCall.skillId}/${this.lastScriptCall.scriptPath}]`));
              }
            }
          }
        }

        // Handle tool results
        // Check for tool results (type assertion needed due to SDK types)
        if ((message as any).type === 'tool_result') {
          const result = parseScriptResult((message as any).result);
          if (result && !result.success) {
            lastFailedResult = result;
          }
        }

        // Handle final result
        if (message.type === 'result') {
          if (message.subtype !== 'success' || lastFailedResult) {
            await this.handleFailure(lastFailedResult);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }
  }

  /**
   * Handle script failure
   */
  private async handleFailure(result: ScriptResult | null): Promise<void> {
    if (!this.lastScriptCall || !result) return;

    const { skillId, scriptPath, args } = this.lastScriptCall;
    const onFailure = this.config.onFailure || 'prompt';

    if (onFailure === 'exit') {
      console.log(chalk.red('\nScript failed. Exiting.'));
      return;
    }

    // Save context
    const contextPath = await saveFailureContext(
      skillId,
      scriptPath,
      args,
      result
    );

    console.log(chalk.yellow('\n┌─────────────────────────────────────┐'));
    console.log(chalk.yellow('│  Script execution failed            │'));
    console.log(chalk.yellow('└─────────────────────────────────────┘'));
    console.log(chalk.dim(`Context saved to: ${contextPath}`));
    console.log();

    if (onFailure === 'prompt') {
      console.log(chalk.cyan('To investigate, run:'));
      console.log(chalk.white(`  aegis adhoc --context ${contextPath}`));
      console.log();
    } else if (onFailure === 'auto') {
      console.log(chalk.cyan('Auto-escalating to Adhoc agent...'));
      // TODO: Implement auto-escalation
    }
  }

  /**
   * Execute a single workflow command (non-interactive)
   */
  async execute(input: string): Promise<{ success: boolean; result?: string; contextPath?: string }> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const options = createWorkflowAgentOptions(this.config);

    try {
      const queryResult = await sdk.query({ prompt: input, options });

      let resultText = '';
      let lastFailedResult: ScriptResult | null = null;

      for await (const message of queryResult) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              resultText += block.text;
            } else if (block.type === 'tool_use') {
              if (block.name === 'aegis-skills__run_script') {
                this.lastScriptCall = {
                  skillId: (block.input as any)?.skill || '',
                  scriptPath: (block.input as any)?.path || '',
                  args: (block.input as any)?.args,
                };
              }
            }
          }
        }

        // Check for tool results (type assertion needed due to SDK types)
        if ((message as any).type === 'tool_result') {
          const result = parseScriptResult((message as any).result);
          if (result && !result.success) {
            lastFailedResult = result;
          }
        }
      }

      if (lastFailedResult && this.lastScriptCall) {
        const contextPath = await saveFailureContext(
          this.lastScriptCall.skillId,
          this.lastScriptCall.scriptPath,
          this.lastScriptCall.args,
          lastFailedResult
        );
        return { success: false, result: resultText, contextPath };
      }

      return { success: true, result: resultText };
    } catch (error) {
      return { success: false, result: (error as Error).message };
    }
  }
}

/**
 * Create and run a Workflow Agent
 */
export async function runWorkflowAgent(config: WorkflowAgentConfig = {}): Promise<void> {
  const agent = new WorkflowAgent(config);
  await agent.run();
}
