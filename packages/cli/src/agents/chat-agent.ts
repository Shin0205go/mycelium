/**
 * Chat Agent - Session-based Dynamic Skill Management
 *
 * Single agent with policy-in-the-loop:
 * - Skills are dynamically added/removed based on user intent
 * - Tools are filtered based on active skills
 * - Skill changes are transparently notified
 */

import * as readline from 'readline';
import chalk from 'chalk';
import type { SkillDefinition, SkillChange } from '@mycelium/shared';
import { createAgentOptions } from '../lib/agent.js';
import { createBanner, createSpinner } from '../lib/ui.js';
import {
  createSessionStateManager,
  createSkillManager,
  createIntentClassifier,
  type SkillManager,
  type IntentClassifier,
} from '../session/index.js';

export interface ChatAgentConfig {
  /** Claude model to use */
  model?: string;

  /** User's role (determines skill upper limit) */
  userRole?: string;

  /** Default skills to start with */
  defaultSkills?: string[];

  /** Use API key instead of OAuth */
  useApiKey?: boolean;

  /** Skill definitions (loaded from MCP server if not provided) */
  skills?: SkillDefinition[];

  /** Skills allowed for the user's role */
  allowedSkillsForRole?: string[];
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/**
 * Chat Agent with dynamic skill management
 */
export class ChatAgent {
  private config: ChatAgentConfig;
  private rl: readline.Interface | null = null;
  private sdk: typeof import('@anthropic-ai/claude-agent-sdk') | null = null;
  private isProcessing: boolean = false;
  private skillManager: SkillManager | null = null;
  private intentClassifier: IntentClassifier | null = null;
  private skills: SkillDefinition[] = [];

  constructor(config: ChatAgentConfig = {}) {
    this.config = {
      userRole: 'developer',
      defaultSkills: ['common'],
      ...config,
    };
  }

  /**
   * Initialize skill management components
   */
  private async initializeSkillManagement(): Promise<void> {
    // Load skills from config or MCP server
    if (this.config.skills) {
      this.skills = this.config.skills;
    } else {
      this.skills = await this.loadSkillsFromMCP();
    }

    // Determine allowed skills for role
    const allowedSkillsForRole =
      this.config.allowedSkillsForRole ||
      this.skills
        .filter(
          (s) =>
            s.allowedRoles.includes('*') ||
            s.allowedRoles.includes(this.config.userRole!)
        )
        .map((s) => s.id);

    // Create session state manager
    const sessionState = createSessionStateManager(
      this.skills,
      this.config.userRole!,
      allowedSkillsForRole,
      this.config.defaultSkills
    );

    // Create skill manager with change notification
    this.skillManager = createSkillManager({
      sessionState,
      onSkillChange: (changes, notification) => {
        this.onSkillChange(changes, notification);
      },
    });

    // Create intent classifier (protect default skills from de-escalation)
    this.intentClassifier = createIntentClassifier({
      skills: this.skills,
      activeSkills: sessionState.getActiveSkills(),
      protectedSkills: this.config.defaultSkills,
    });
  }

  /**
   * Load skills from MCP server
   */
  private async loadSkillsFromMCP(): Promise<SkillDefinition[]> {
    // For now, return hardcoded skills
    // TODO: Load from mycelium-skills MCP server
    return [
      {
        id: 'common',
        displayName: 'Common',
        description: '基本的なスキル情報の取得',
        allowedRoles: ['*'],
        allowedTools: [
          'mycelium-skills__get_skill',
          'mycelium-skills__list_skills',
        ],
      },
      {
        id: 'code-modifier',
        displayName: 'Code Modifier',
        description: 'コードの作成・編集・リファクタリング',
        allowedRoles: ['developer', 'admin'],
        allowedTools: [
          'filesystem__read_file',
          'filesystem__read_text_file',
          'filesystem__list_directory',
          'filesystem__write_file',
          'filesystem__create_directory',
          'mycelium-sandbox__bash',
        ],
        triggers: ['編集', '修正', '作成', 'edit', 'modify', 'create', 'fix'],
      },
      {
        id: 'git-workflow',
        displayName: 'Git Workflow',
        description: 'Gitバージョン管理操作',
        allowedRoles: ['developer', 'admin'],
        allowedTools: [
          'filesystem__read_file',
          'filesystem__list_directory',
          'mycelium-sandbox__bash',
        ],
        triggers: ['commit', 'push', 'git', 'コミット', 'プッシュ', 'diff'],
      },
      {
        id: 'test-runner',
        displayName: 'Test Runner',
        description: 'テストの実行',
        allowedRoles: ['developer', 'admin'],
        allowedTools: ['mycelium-sandbox__bash', 'filesystem__read_file'],
        triggers: ['テスト', 'test', 'spec'],
      },
      {
        id: 'build-check',
        displayName: 'Build Check',
        description: 'ビルドの実行と確認',
        allowedRoles: ['developer', 'admin'],
        allowedTools: ['mycelium-sandbox__bash', 'filesystem__read_file'],
        triggers: ['ビルド', 'build', 'compile'],
      },
    ];
  }

  /**
   * Handle skill change notification
   */
  private onSkillChange(_changes: SkillChange[], notification: string): void {
    if (notification) {
      console.log(chalk.yellow(notification));
    }

    // Update intent classifier with new active skills
    if (this.intentClassifier && this.skillManager) {
      this.intentClassifier.updateActiveSkills(
        this.skillManager.getActiveSkills()
      );
    }
  }

  /**
   * Create agent options with current skill tools
   */
  private createAgentOptionsWithSkills(): Record<string, unknown> {
    const availableTools = this.skillManager?.getAvailableTools() || [];

    // Build allowed tools pattern from active skills
    const allowedToolPatterns = availableTools.map((tool) => {
      // Convert MCP tool format to allowedTools pattern
      // e.g., "filesystem__read_file" -> "mcp__mycelium-router__filesystem__read_file"
      return `mcp__mycelium-router__${tool}`;
    });

    // Always allow mycelium-router tools
    allowedToolPatterns.push('mcp__mycelium-router__*');

    return createAgentOptions({
      model: this.config.model,
      useApiKey: this.config.useApiKey,
      currentRole: this.config.userRole,
      maxTurns: 50,
    });
  }

  /**
   * Run the chat agent interactively
   */
  async run(): Promise<void> {
    this.sdk = await import('@anthropic-ai/claude-agent-sdk');

    console.log(createBanner());
    console.log(
      chalk.gray(
        `    Session-based Skill Management | role: ${this.config.userRole}\n`
      )
    );

    // Initialize skill management
    await this.initializeSkillManagement();

    // Show initial skills
    const activeSkills = this.skillManager?.getActiveSkills() || [];
    console.log(chalk.yellow(`[${activeSkills.join(', ') || 'base'}]`));
    console.log();

    // Setup readline
    process.stdin.resume();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.green('myc> '),
    });

    // Handle line input
    this.rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        this.rl!.prompt();
        return;
      }

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
        await this.processInput(input);
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
      } finally {
        this.isProcessing = false;
        if (this.rl) {
          this.rl.prompt();
        }
      }
    });

    // Handle close
    this.rl.on('close', () => {
      console.log(chalk.gray('\nGoodbye!\n'));
      process.exit(0);
    });

    // Start prompting
    this.rl.prompt();
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
  /help      Show this help
  /skills    List active skills
  /all       List all available skills
  /add <id>  Manually add a skill
  /remove <id>  Remove a skill
  /tools     List available tools
  /exit      Exit
`);
        break;

      case 'skills':
        const active = this.skillManager?.getActiveSkills() || [];
        console.log(chalk.cyan('Active skills:'));
        for (const skillId of active) {
          const skill = this.skillManager?.getSkillDefinition(skillId);
          console.log(`  ${skillId}: ${skill?.description || ''}`);
        }
        break;

      case 'all':
        console.log(chalk.cyan('All available skills:'));
        for (const skill of this.skills) {
          const isActive = this.skillManager?.getActiveSkills().includes(skill.id);
          const marker = isActive ? chalk.green('✓') : ' ';
          console.log(`  ${marker} ${skill.id}: ${skill.description}`);
        }
        break;

      case 'add':
        if (args.length === 0) {
          console.log(chalk.yellow('Usage: /add <skill-id>'));
        } else {
          const notification = this.skillManager?.escalate(args[0], 'manual');
          if (notification) {
            console.log(chalk.yellow(notification));
          } else {
            console.log(chalk.dim('Skill already active or not available'));
          }
        }
        break;

      case 'remove':
        if (args.length === 0) {
          console.log(chalk.yellow('Usage: /remove <skill-id>'));
        } else {
          const notification = this.skillManager?.deescalate(args[0], 'manual');
          if (notification) {
            console.log(chalk.yellow(notification));
          } else {
            console.log(chalk.dim('Skill not active'));
          }
        }
        break;

      case 'tools':
        const tools = this.skillManager?.getAvailableTools() || [];
        console.log(chalk.cyan(`Available tools (${tools.length}):`));
        for (const tool of tools) {
          console.log(`  ${tool}`);
        }
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
  private async processInput(input: string): Promise<void> {
    // Classify intent and update skills
    if (this.intentClassifier && this.skillManager) {
      const classification = this.intentClassifier.classify(input);

      if (classification.requiredSkills.length > 0 || classification.deescalateSkills.length > 0) {
        // processIntent triggers onSkillChange callback which prints notification
        this.skillManager.processIntent(classification);
      }
    }

    const spinner = createSpinner('Thinking...');
    spinner.start();

    try {
      const options = this.createAgentOptionsWithSkills();
      const queryResult = await this.sdk!.query({ prompt: input, options });

      for await (const message of queryResult) {
        if (message.type === 'assistant' && message.message?.content) {
          let hasTextBlock = false;

          for (const block of message.message.content as ContentBlock[]) {
            if (block.type === 'text') {
              spinner.stop();
              if (!hasTextBlock) {
                // Show active skills in response header
                const activeSkills = this.skillManager?.getActiveSkills() || [];
                console.log(chalk.cyan(`\n● [${activeSkills.join(', ') || 'base'}]`));
                hasTextBlock = true;
              }
              console.log(chalk.cyan(block.text));
            } else if (block.type === 'tool_use') {
              const toolName = (block.name || '').split('__').pop() || block.name;
              spinner.text = `Running ${toolName}...`;
              if (!spinner.isSpinning) spinner.start();
            }
          }
        }

        if (message.type === 'result') {
          spinner.stop();
        }
      }

      spinner.stop();
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }
  }
}

/**
 * Create and run a Chat Agent
 */
export async function runChatAgent(config: ChatAgentConfig = {}): Promise<void> {
  const agent = new ChatAgent(config);
  await agent.run();
}
