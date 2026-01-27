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

import * as readline from 'readline';
import chalk from 'chalk';
import {
  writeContext,
  getDefaultContextPath,
  type WorkflowContext,
} from '../lib/context.js';
import { createAgentOptions, type SubAgentDefinition } from '../lib/agent.js';
import { createBanner, createSpinner } from '../lib/ui.js';
import { AdhocAgent } from './adhoc-agent.js';

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

// Sub-agents available to the orchestrator
const ORCHESTRATOR_SUB_AGENTS: SubAgentDefinition[] = [
  {
    name: 'developer',
    description: 'Developer agent for file operations, code reading/writing, and development tasks. Use this for any file access.',
    prompt: 'You are a developer assistant. Read, analyze, and modify files as requested. Use the available tools to complete the task.',
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
  },
  {
    name: 'admin',
    description: 'Admin agent with full tool access for system administration, debugging, and complex tasks.',
    prompt: 'You are an admin assistant with full access. Complete the requested task using all available tools.',
  },
];

// System prompt for orchestrator
const WORKFLOW_SYSTEM_PROMPT = `You are a Workflow Orchestrator. You have NO direct file or tool access. You MUST delegate ALL tasks to sub-agents using the Task tool.

Available sub-agents (use Task tool with subagent_type parameter):
- "developer": For file operations, code reading/writing, development tasks
- "admin": For system administration, debugging, tasks requiring full access

IMPORTANT: You cannot read files directly. Always use the Task tool to delegate.

When asked to do anything, immediately use the Task tool:
- subagent_type: "developer" or "admin"
- prompt: Clear description of what to do
- description: Brief summary (3-5 words)
`;

/**
 * Create agent options for Workflow Agent
 * Uses centralized createAgentOptions with orchestrator role and sub-agents
 */
export function createWorkflowAgentOptions(config: WorkflowAgentConfig = {}): Record<string, unknown> {
  return createAgentOptions({
    model: config.model,
    systemPrompt: config.systemPrompt || WORKFLOW_SYSTEM_PROMPT,
    useApiKey: config.useApiKey,
    currentRole: 'orchestrator',
    maxTurns: 20,
    subAgents: ORCHESTRATOR_SUB_AGENTS,
  });
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
  private sdk: any = null;
  private isProcessing: boolean = false;
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
    this.sdk = await import('@anthropic-ai/claude-agent-sdk');

    console.log(createBanner());
    console.log(chalk.gray('    Workflow Orchestrator | /help for commands\n'));

    // Ensure stdin stays open
    process.stdin.resume();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.yellow('orchestrator> '),
    });

    // Handle line input (event-driven, more robust than question())
    this.rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        this.rl!.prompt();
        return;
      }

      // Prevent concurrent processing
      if (this.isProcessing) {
        console.log(chalk.dim('(processing...)'));
        return;
      }

      // Handle commands
      if (input.startsWith('/')) {
        const handled = await this.handleCommand(input);
        if (handled === 'exit') {
          this.rl!.close();
          return;
        }
        this.rl!.prompt();
        return;
      }

      // Process with LLM
      this.isProcessing = true;
      try {
        await this.processInput(input, this.sdk);
      } catch (err) {
        console.error(chalk.red(`Processing error: ${(err as Error).message}`));
      } finally {
        this.isProcessing = false;
        if (this.rl) {
          this.rl.prompt();
        }
      }
    });

    // Handle close event
    this.rl.on('close', () => {
      console.log(chalk.gray('\nGoodbye!\n'));
      process.exit(0);
    });

    // Catch uncaught errors
    process.on('uncaughtException', (err) => {
      console.error(chalk.red(`Uncaught exception: ${err.message}`));
      console.error(err.stack);
    });

    process.on('unhandledRejection', (reason) => {
      console.error(chalk.red(`Unhandled rejection: ${reason}`));
    });

    // Start prompting
    this.rl.prompt();
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
    const spinner = createSpinner('Thinking...');
    spinner.start();

    try {
      const options = createWorkflowAgentOptions(this.config);
      const queryResult = await sdk.query({ prompt: input, options });

      let lastFailedResult: ScriptResult | null = null;

      for await (const message of queryResult) {
        // Handle text output
        if (message.type === 'assistant' && message.message?.content) {
          let hasTextBlock = false;
          for (const block of message.message.content) {
            if (block.type === 'text') {
              // Stop spinner and display AI response with header
              spinner.stop();
              if (!hasTextBlock) {
                console.log(chalk.cyan('\n● [Orchestrator]'));
                hasTextBlock = true;
              }
              console.log(chalk.cyan(block.text));
            } else if (block.type === 'tool_use') {
              // Update spinner with tool info
              const toolName = block.name.split('__').pop() || block.name;
              spinner.text = `Running ${toolName}...`;
              if (!spinner.isSpinning) spinner.start();

              // Track run_script calls for failure context
              if (block.name === 'mycelium-skills__run_script') {
                this.lastScriptCall = {
                  skillId: (block.input as any)?.skill || '',
                  scriptPath: (block.input as any)?.path || '',
                  args: (block.input as any)?.args,
                };
              }
            }
          }
        }

        // Handle tool results
        if ((message as any).type === 'tool_result') {
          const toolResult = (message as any).result;

          // Check for script failures
          const result = parseScriptResult(toolResult);
          if (result && !result.success) {
            lastFailedResult = result;
          }

          // Reset spinner for next action
          spinner.text = 'Thinking...';
        }

        // Handle final result
        if (message.type === 'result') {
          spinner.stop();
          if (message.subtype !== 'success' || lastFailedResult) {
            await this.handleFailure(lastFailedResult);
          }
        }
      }

      spinner.stop();
    } catch (error) {
      spinner.stop();
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
      console.log(chalk.white(`  mycelium adhoc --context ${contextPath}`));
      console.log();
    } else if (onFailure === 'auto') {
      console.log(chalk.cyan('Auto-escalating to Adhoc agent...'));
      console.log();

      // Close the workflow agent's readline before starting adhoc
      if (this.rl) {
        this.rl.close();
        this.rl = null;
      }

      // Create and run adhoc agent with the failure context
      const adhocAgent = new AdhocAgent({
        model: this.config.model,
        contextPath,
        useApiKey: this.config.useApiKey,
      });

      await adhocAgent.run();
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
              if (block.name === 'mycelium-skills__run_script') {
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
