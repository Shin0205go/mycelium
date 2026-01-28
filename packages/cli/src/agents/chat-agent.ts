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
import { loadSkillsFromDisk } from '../lib/skill-loader.js';

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

  /** Require approval for skill escalation (default: true) */
  requireApproval?: boolean;
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
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; input: unknown }[];
}

export class ChatAgent {
  private config: ChatAgentConfig;
  private rl: readline.Interface | null = null;
  private sdk: typeof import('@anthropic-ai/claude-agent-sdk') | null = null;
  private isProcessing: boolean = false;
  private isExiting: boolean = false;
  private skillManager: SkillManager | null = null;
  private intentClassifier: IntentClassifier | null = null;
  private skills: SkillDefinition[] = [];
  private conversationHistory: ConversationMessage[] = [];
  private approvalCache: Map<string, 'always' | 'never'> = new Map();

  constructor(config: ChatAgentConfig = {}) {
    this.config = {
      userRole: 'developer',
      defaultSkills: ['common'],
      requireApproval: true,
      ...config,
    };
  }

  /**
   * Prompt user for skill escalation approval
   * Protected/default skills are auto-approved
   * Session-level caching for 'always'/'never' decisions
   */
  private async promptSkillApproval(skillIds: string[]): Promise<string[]> {
    if (!this.config.requireApproval || skillIds.length === 0) {
      return skillIds;
    }

    const approved: string[] = [];
    const defaultSkills = this.config.defaultSkills || [];

    for (const skillId of skillIds) {
      // Protected/default skills are auto-approved (no prompt)
      if (defaultSkills.includes(skillId)) {
        approved.push(skillId);
        continue;
      }

      // Check session approval cache
      const cached = this.approvalCache.get(skillId);
      if (cached === 'always') {
        approved.push(skillId);
        console.log(chalk.green(`✓ [${skillId}] を有効化 (cached)`));
        continue;
      }
      if (cached === 'never') {
        console.log(chalk.dim(`✗ [${skillId}] スキップ (cached)`));
        continue;
      }

      const skill = this.skillManager?.getSkillDefinition(skillId);
      const description = skill?.description || skillId;

      process.stdout.write(
        chalk.yellow(`\n⚠️  スキル昇格: `) +
        chalk.white(`[${skillId}]`) +
        chalk.gray(` - ${description}\n`) +
        chalk.yellow(`有効にしますか？ [y/a/n/N]: `) +
        chalk.dim(`(y=今回のみ, a=常に許可, n=今回のみ拒否, N=常に拒否) `)
      );

      const answer = await this.readLineOnce();
      const lowerAnswer = answer.toLowerCase();

      if (lowerAnswer === 'y' || lowerAnswer === 'yes') {
        approved.push(skillId);
        console.log(chalk.green(`✓ [${skillId}] を有効化`));
      } else if (lowerAnswer === 'a' || lowerAnswer === 'always') {
        approved.push(skillId);
        this.approvalCache.set(skillId, 'always');
        console.log(chalk.green(`✓ [${skillId}] を有効化 (このセッション中は常に許可)`));
      } else if (answer === 'N') {
        // Capital N = always deny for this session
        this.approvalCache.set(skillId, 'never');
        console.log(chalk.dim(`✗ [${skillId}] スキップ (このセッション中は常に拒否)`));
      } else {
        console.log(chalk.dim(`✗ [${skillId}] スキップ`));
      }
    }

    return approved;
  }

  /**
   * Read a single line from stdin (for approval prompts)
   */
  private readLineOnce(): Promise<string> {
    return new Promise((resolve) => {
      const onLine = (line: string) => {
        this.rl?.removeListener('line', onLine);
        resolve(line.trim());
      };
      this.rl?.once('line', onLine);
    });
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
   * Load skills from disk (packages/skills/skills)
   * Falls back to hardcoded skills if disk loading fails
   */
  private async loadSkillsFromMCP(): Promise<SkillDefinition[]> {
    try {
      const skills = await loadSkillsFromDisk();
      if (skills.length > 0) {
        return skills;
      }
    } catch (err) {
      console.error('Failed to load skills from disk, using fallback:', err);
    }

    // Fallback to hardcoded skills
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
   * Tools are strictly filtered based on active skills (no wildcards)
   */
  private createAgentOptionsWithSkills(): Record<string, unknown> {
    const availableTools = this.skillManager?.getAvailableTools() || [];

    // Build allowed tools pattern from active skills ONLY
    // No wildcards - only explicitly allowed tools are visible to the LLM
    const allowedToolPatterns = availableTools.map((tool) => {
      // Convert MCP tool format to allowedTools pattern
      // e.g., "filesystem__read_file" -> "mcp__mycelium-router__filesystem__read_file"
      return `mcp__mycelium-router__${tool}`;
    });

    // NOTE: Wildcard removed intentionally for security
    // Only skill-defined tools should be visible to the LLM

    const baseOptions = createAgentOptions({
      model: this.config.model,
      useApiKey: this.config.useApiKey,
      currentRole: this.config.userRole,
      maxTurns: 50,
    });

    // Override allowedTools with skill-filtered list (no wildcards)
    return {
      ...baseOptions,
      allowedTools: allowedToolPatterns,
    };
  }

  /**
   * Setup readline interface
   */
  private setupReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.green('myc> '),
    });

    // Re-attach event handlers
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
          this.isExiting = true;
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
        // Ensure stdin is still open after SDK query
        if (!process.stdin.destroyed) {
          process.stdin.resume();
        }
        if (this.rl) {
          this.rl.prompt();
        }
      }
    });

    this.rl.on('close', () => {
      // If user explicitly requested exit, proceed
      if (this.isExiting) {
        console.log(chalk.gray('\nGoodbye!\n'));
        process.exit(0);
      }

      // Unexpected close - try to recover
      if (!process.stdin.destroyed) {
        console.log(chalk.dim('\n(readline closed unexpectedly, recovering...)'));
        this.setupReadline();
      } else {
        // stdin is destroyed, we have to exit
        console.log(chalk.gray('\nGoodbye!\n'));
        process.exit(0);
      }
    });

    this.rl.prompt();
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

    // Setup readline and start prompting
    process.stdin.resume();

    // Handle stdin errors
    process.stdin.on('error', (err) => {
      console.error(chalk.red(`stdin error: ${err.message}`));
    });

    this.setupReadline();
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
  /status    Show session status
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

      case 'status':
        const statusActive = this.skillManager?.getActiveSkills() || [];
        const statusTools = this.skillManager?.getAvailableTools() || [];
        const cachedApprovals = Array.from(this.approvalCache.entries());
        console.log(chalk.cyan('Session Status:'));
        console.log(`  Role: ${this.config.userRole}`);
        console.log(`  Active Skills: ${statusActive.length} / ${this.skills.length}`);
        console.log(`  Available Tools: ${statusTools.length}`);
        console.log(`  Conversation Turns: ${this.conversationHistory.length}`);
        if (cachedApprovals.length > 0) {
          console.log(`  Approval Cache:`);
          for (const [skill, decision] of cachedApprovals) {
            const icon = decision === 'always' ? chalk.green('✓') : chalk.red('✗');
            console.log(`    ${icon} ${skill}: ${decision}`);
          }
        }
        break;

      case 'exit':
      case 'quit':
        this.isExiting = true;
        return 'exit';

      default:
        console.log(chalk.yellow(`Unknown command: ${cmd}`));
    }
  }

  /**
   * Build prompt with conversation history (including tool usage)
   */
  private buildPromptWithHistory(input: string): string {
    if (this.conversationHistory.length === 0) {
      return input;
    }

    // Build context from history (last 20 messages max)
    const recentHistory = this.conversationHistory.slice(-20);
    const historyText = recentHistory
      .map((msg) => {
        let text = `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`;
        // Include tool usage info for better context
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const toolNames = msg.toolCalls.map((t) => t.name.split('__').pop()).join(', ');
          text += `\n[Used tools: ${toolNames}]`;
        }
        return text;
      })
      .join('\n\n');

    return `以下は会話の履歴です。この文脈を踏まえて回答してください。

--- 会話履歴 ---
${historyText}

--- 現在の入力 ---
User: ${input}`;
  }

  /**
   * Process user input through the LLM
   */
  private async processInput(input: string): Promise<void> {
    // Classify intent and update skills (with approval for dangerous skills)
    if (this.intentClassifier && this.skillManager) {
      const classification = this.intentClassifier.classify(input);

      if (classification.requiredSkills.length > 0) {
        // Ask for approval for skills that require it
        const approvedSkills = await this.promptSkillApproval(classification.requiredSkills);

        if (approvedSkills.length > 0 || classification.deescalateSkills.length > 0) {
          // Only escalate approved skills
          const modifiedClassification = {
            ...classification,
            requiredSkills: approvedSkills,
          };
          this.skillManager.processIntent(modifiedClassification);
        }
      } else if (classification.deescalateSkills.length > 0) {
        this.skillManager.processIntent(classification);
      }
    }

    // Add user message to history
    this.conversationHistory.push({ role: 'user', content: input });

    // Clear any residual output before starting spinner
    process.stdout.write('\r\x1b[K');
    const spinner = createSpinner('Thinking...');
    spinner.start();

    // Collect assistant response for history
    const assistantTexts: string[] = [];
    const toolCalls: { name: string; input: unknown }[] = [];

    try {
      const options = this.createAgentOptionsWithSkills();
      const promptWithHistory = this.buildPromptWithHistory(input);
      const queryResult = await this.sdk!.query({ prompt: promptWithHistory, options });

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
              // Collect text for history
              if (block.text) {
                assistantTexts.push(block.text);
              }
            } else if (block.type === 'tool_use') {
              const toolName = (block.name || '').split('__').pop() || block.name;
              spinner.text = `Running ${toolName}...`;
              if (!spinner.isSpinning) spinner.start();
              // Track tool calls for history
              toolCalls.push({ name: block.name || '', input: block.input });
            }
          }
        }

        if (message.type === 'result') {
          spinner.stop();
        }
      }

      spinner.stop();

      // Add assistant response to history (including tool calls)
      if (assistantTexts.length > 0 || toolCalls.length > 0) {
        this.conversationHistory.push({
          role: 'assistant',
          content: assistantTexts.join('\n'),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
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
