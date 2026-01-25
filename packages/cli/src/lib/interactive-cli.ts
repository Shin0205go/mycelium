/**
 * MYCELIUM Interactive CLI - REPL with role switching and session management
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { join } from 'path';
import { MCPClient, AgentManifest, SkillCommandInfo, ToolCommandInfo } from './mcp-client.js';
import { createQuery, isToolUseMessage, getToolUseInfo, type SDKMessage } from './agent.js';
import { createBanner, createSpinner, icons, suggestCommand, errorBox } from './ui.js';

// Commands and selectors
import {
  rolesCommand,
  statusCommand,
  skillsCommand,
  toolsCommand,
  modelCommand,
  helpCommand,
  executeSkillCommand,
  executeToolCommand,
  switchRole,
  AVAILABLE_MODELS,
  type CommandContext
} from './commands/index.js';

export interface InteractiveCLIOptions {
  role?: string;
  model?: string;
  configPath?: string;
  routerPath?: string;
}

export class InteractiveCLI {
  private mcp: MCPClient;
  private currentRole: string = 'orchestrator';
  private manifest: AgentManifest | null = null;
  private rl: readline.Interface | null = null;
  private isProcessing: boolean = false;
  private authSource: string = 'unknown';
  private useApiKey: boolean = false;

  // Dynamic commands loaded from skills
  private skillCommands: Map<string, SkillCommandInfo> = new Map();

  // Tool commands auto-generated from available tools
  private toolCommands: Map<string, ToolCommandInfo> = new Map();

  // Tools to exclude from slash commands (handled specially)
  private readonly excludedTools = ['set_role', 'list_roles', 'spawn_sub_agent'];

  // Built-in commands (always available)
  private readonly builtInCommands = [
    '/roles',
    '/skills',
    '/tools',
    '/status',
    '/model',
    '/help',
    '/quit'
  ];

  private currentModel: string = 'claude-3-5-haiku-20241022';

  constructor(private options: InteractiveCLIOptions = {}) {
    const projectRoot = process.cwd();
    const routerPath = options.routerPath ||
      process.env.MYCELIUM_ROUTER_PATH ||
      join(projectRoot, 'packages', 'core', 'dist', 'mcp-server.js');
    const configPath = options.configPath ||
      process.env.MYCELIUM_CONFIG_PATH ||
      join(projectRoot, 'config.json');

    this.mcp = new MCPClient('node', [routerPath], {
      MYCELIUM_CONFIG_PATH: configPath,
      MCP_TRANSPORT: 'stdio'
    });

    if (options.role) {
      this.currentRole = options.role;
    }
    if (options.model) {
      this.currentModel = options.model;
    }
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  private async checkAuth(): Promise<boolean> {
    const claudeAuthOk = await this.tryAuth(false);
    if (claudeAuthOk) {
      return true;
    }

    if (process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.yellow('\nClaude Code not logged in, but API key is available.'));
      const useKey = await this.askYesNo('Use API key? (charges apply)');

      if (useKey) {
        this.useApiKey = true;
        const apiAuthOk = await this.tryAuth(true);
        if (apiAuthOk) {
          return true;
        }
      }
    }

    console.error(chalk.red('\n✗ Authentication Error\n'));
    console.log(chalk.yellow('Please authenticate with one of:'));
    console.log(chalk.cyan('  1. claude login') + chalk.gray(' (Max plan)'));
    console.log(chalk.cyan('  2. export ANTHROPIC_API_KEY=...') + chalk.gray(' (API key)'));
    console.log();
    return false;
  }

  private async tryAuth(useApiKey: boolean): Promise<boolean> {
    try {
      const queryResult = await createQuery('hi', {
        maxTurns: 1,
        includePartialMessages: false,
        useApiKey
      });

      let authSource = 'unknown';
      let resultText = '';

      for await (const msg of queryResult) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          authSource = msg.apiKeySource || 'none';
        }
        if (msg.type === 'result' && msg.subtype === 'success') {
          resultText = msg.result || '';
        }
      }

      if (resultText.includes('Invalid API key') ||
          resultText.includes('/login') ||
          resultText.includes('Please run')) {
        return false;
      }

      this.authSource = authSource;
      console.log(chalk.green(`✓ Auth: ${this.formatAuthSource(this.authSource)}`));
      return true;
    } catch {
      return false;
    }
  }

  private askYesNo(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question(chalk.cyan(`${question} [y/N]: `), (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  private formatAuthSource(source: string): string {
    switch (source) {
      case 'none': return 'Claude Code Auth';
      case 'user': return 'User auth';
      case 'ANTHROPIC_API_KEY': return chalk.yellow('API Key (charges apply)');
      case 'project': return chalk.blue('Project API Key');
      case 'org': return chalk.blue('Organization API Key');
      case 'temporary': return chalk.gray('Temporary Key');
      case 'unknown': return chalk.gray('Unknown');
      default: return source;
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private showBanner(): void {
    console.log(createBanner());
  }

  async run(): Promise<void> {
    this.showBanner();

    console.log(chalk.gray('Checking authentication...'));
    const authOk = await this.checkAuth();
    if (!authOk) {
      return;
    }

    console.log(chalk.gray('Connecting to MYCELIUM Router...'));

    this.mcp.on('log', () => {});

    this.mcp.on('toolsChanged', () => {
      console.log(chalk.yellow('\n📢 Tools list updated'));
      this.showPrompt();
    });

    try {
      await this.mcp.connect();
      console.log(chalk.green('✓ Connected to MYCELIUM Router'));
    } catch (error) {
      console.error(chalk.red('Failed to connect:'), error);
      process.exit(1);
    }

    // Load dynamic commands from skills
    await this.loadSkillCommands();

    await this.doSwitchRole(this.currentRole);
    this.startREPL();
  }

  // ============================================================================
  // Command Loading
  // ============================================================================

  private async loadSkillCommands(): Promise<void> {
    try {
      const result = await this.mcp.listCommands();
      this.skillCommands.clear();

      for (const cmd of result.commands) {
        this.skillCommands.set(cmd.command, cmd);
      }

      if (this.skillCommands.size > 0) {
        console.log(chalk.green(`✓ Loaded ${this.skillCommands.size} skill commands\n`));
      } else {
        console.log(chalk.gray('  No skill commands available\n'));
      }
    } catch {
      console.log(chalk.gray('  Skill commands: unavailable\n'));
    }
  }

  private extractToolName(prefixedName: string): string {
    const parts = prefixedName.split('__');
    return parts.length > 1 ? parts[1] : prefixedName;
  }

  private registerToolCommands(tools: AgentManifest['availableTools']): void {
    this.toolCommands.clear();
    const nameCount = new Map<string, number>();

    // Count tool names to detect duplicates
    for (const tool of tools) {
      const shortName = this.extractToolName(tool.name);
      if (this.excludedTools.includes(shortName)) continue;
      nameCount.set(shortName, (nameCount.get(shortName) || 0) + 1);
    }

    // Register commands
    for (const tool of tools) {
      const shortName = this.extractToolName(tool.name);
      if (this.excludedTools.includes(shortName)) continue;

      const isDuplicate = (nameCount.get(shortName) || 0) > 1;
      const cmdName = isDuplicate ? `${tool.source}:${shortName}` : shortName;

      this.toolCommands.set(cmdName, {
        command: cmdName,
        fullToolName: tool.name,
        source: tool.source,
        description: tool.description
      });
    }
  }

  // ============================================================================
  // Role Switching
  // ============================================================================

  private async doSwitchRole(roleId: string): Promise<void> {
    const ctx = this.getCommandContext();
    await switchRole(ctx, roleId);
    this.currentRole = ctx.currentRole;
    this.manifest = ctx.manifest;

    // Register tool commands from available tools
    if (this.manifest) {
      this.registerToolCommands(this.manifest.availableTools);
    }
  }

  // ============================================================================
  // Command Context
  // ============================================================================

  private getCommandContext(): CommandContext {
    return {
      mcp: this.mcp,
      currentRole: this.currentRole,
      currentModel: this.currentModel,
      manifest: this.manifest,
      rl: this.rl,
      skillCommands: this.skillCommands,
      toolCommands: this.toolCommands,
      authSource: this.authSource,
      useApiKey: this.useApiKey,

      setCurrentRole: (role: string) => { this.currentRole = role; },
      setCurrentModel: (model: string) => { this.currentModel = model; },
      setManifest: (manifest: AgentManifest | null) => {
        this.manifest = manifest;
        if (manifest) {
          this.registerToolCommands(manifest.availableTools);
        }
      }
    };
  }

  // ============================================================================
  // Auto-completion
  // ============================================================================

  private completer(line: string): [string[], string] {
    if (line.startsWith('/')) {
      if (line.startsWith('/model ')) {
        const partial = line.slice('/model '.length);
        const matches = AVAILABLE_MODELS.filter(m => m.startsWith(partial));
        return [matches.map(m => `/model ${m}`), line];
      }
      const allCommands = [
        ...this.builtInCommands,
        ...Array.from(this.skillCommands.keys()).map(c => `/${c}`),
        ...Array.from(this.toolCommands.keys()).map(c => `/${c}`)
      ];
      const matches = allCommands.filter(c => c.startsWith(line));
      return [matches, line];
    }
    return [[], line];
  }

  // ============================================================================
  // Chat
  // ============================================================================

  private async chat(message: string): Promise<void> {
    if (this.isProcessing) {
      console.log(chalk.yellow('Already processing a request...'));
      return;
    }

    this.isProcessing = true;
    const systemPrompt = this.manifest?.systemInstruction;
    const spinner = createSpinner('Thinking...');

    try {
      console.log();
      spinner.start();

      const queryResult = await createQuery(message, {
        model: this.currentModel,
        systemPrompt,
        includePartialMessages: true,
        useApiKey: this.useApiKey,
        currentRole: this.currentRole
      });

      let hasStartedOutput = false;
      let pendingRoleSwitch: string | null = null;

      for await (const msg of queryResult) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.authSource = msg.apiKeySource || 'none';
        }

        if (msg.type === 'stream_event') {
          const event = msg.event;
          if (event?.type === 'content_block_delta' && event.delta?.text) {
            if (!hasStartedOutput) {
              spinner.stop();
              process.stdout.write(chalk.green('Claude: '));
              hasStartedOutput = true;
            }
            process.stdout.write(event.delta.text);
          }
        }

        if (msg.type === 'assistant') {
          if (isToolUseMessage(msg)) {
            const tools = getToolUseInfo(msg);
            for (const tool of tools) {
              const shortName = tool.name.replace('mcp__mycelium-router__', '');
              const input = tool.input as Record<string, unknown>;
              let status = `${icons.tool} ${shortName}`;
              if (input.path) {
                const filename = String(input.path).split('/').pop();
                status = `${icons.tool} ${shortName}: ${filename}`;
              } else if (input.command) {
                const cmd = String(input.command).slice(0, 25);
                status = `${icons.tool} ${cmd}...`;
              }
              spinner.text = status;
              if (!spinner.isSpinning) spinner.start();

              if (shortName === 'set_role') {
                if (input.role_id && input.role_id !== 'list') {
                  pendingRoleSwitch = input.role_id as string;
                }
              }
            }
          }
        }

        if (msg.type === 'user' && (msg as SDKMessage & { message?: { content?: Array<{ type: string; is_error?: boolean; content?: string }> } }).message?.content) {
          const content = (msg as SDKMessage & { message: { content: Array<{ type: string; is_error?: boolean; content?: string }> } }).message.content;
          for (const block of content) {
            if (block.type === 'tool_result') {
              if (block.is_error) {
                console.log(chalk.red(`\n  ❌ Tool error: ${JSON.stringify(block.content).substring(0, 200)}`));
                pendingRoleSwitch = null;
              } else if (pendingRoleSwitch) {
                this.currentRole = pendingRoleSwitch;
                this.rl?.setPrompt(chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '));
                console.log(chalk.green(`\n  ✓ Role switched to: ${this.currentRole}`));
                this.mcp.switchRole(pendingRoleSwitch).then(manifest => {
                  this.manifest = manifest;
                }).catch(() => {});
                pendingRoleSwitch = null;
              }
            }
          }
        }

        if (msg.type === 'result') {
          spinner.stop();
          if (hasStartedOutput) {
            console.log();
          }

          if (msg.subtype === 'success') {
            const cost = msg.total_cost_usd.toFixed(4);
            const inputTokens = msg.usage.input_tokens;
            const outputTokens = msg.usage.output_tokens;

            if (this.useApiKey) {
              console.log(chalk.yellow(`\n  ${icons.tokens} Tokens: ${inputTokens} in / ${outputTokens} out | ${icons.cost} Cost: $${cost}`));
            } else {
              console.log(chalk.gray(`\n  ${icons.tokens} Tokens: ${inputTokens} in / ${outputTokens} out | ${icons.cost} Est: $${cost}`));
            }
          } else {
            console.log(chalk.red(`\nError: ${msg.errors?.join(', ') || msg.subtype}`));
          }
        }
      }

      console.log();
    } catch (error: unknown) {
      spinner.stop();
      const err = error as Error;
      const errorMsg = err.message || String(error);

      if (errorMsg.includes('Invalid API key') ||
          errorMsg.includes('/login') ||
          errorMsg.includes('exited with code 1')) {
        console.log(errorBox('Not logged in to Claude Code', [
          'Run: claude login',
          'Set: export ANTHROPIC_API_KEY=...',
        ]));
      } else {
        console.log(errorBox(errorMsg));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // ============================================================================
  // REPL
  // ============================================================================

  private showPrompt(): void {
    if (this.rl) {
      this.rl.prompt();
    }
  }

  private startREPL(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '),
      completer: (line: string) => this.completer(line)
    });

    const ctx = this.getCommandContext();
    helpCommand.handler(ctx, []);
    console.log(chalk.gray('  (Tab for auto-completion)\n'));
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        this.rl!.prompt();
        return;
      }

      if (input.startsWith('/')) {
        const [cmd, ...args] = input.slice(1).split(/\s+/);
        const ctx = this.getCommandContext();

        switch (cmd.toLowerCase()) {
          case 'roles':
            await rolesCommand.handler(ctx, args);
            this.currentRole = ctx.currentRole;
            this.manifest = ctx.manifest;
            if (this.manifest) {
              this.registerToolCommands(this.manifest.availableTools);
            }
            this.rl!.setPrompt(chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '));
            break;

          case 'tools':
            await toolsCommand.handler(ctx, args);
            break;

          case 'skills':
            await skillsCommand.handler(ctx, args);
            break;

          case 'status':
            await statusCommand.handler(ctx, args);
            break;

          case 'model':
            await modelCommand.handler(ctx, args);
            this.currentModel = ctx.currentModel;
            break;

          case 'help':
            await helpCommand.handler(ctx, args);
            break;

          case 'quit':
          case 'exit':
          case 'q':
            console.log(chalk.gray('\nGoodbye!\n'));
            this.mcp.disconnect();
            process.exit(0);

          default:
            // Check if it's a dynamic skill command
            const skillCmd = this.skillCommands.get(cmd.toLowerCase());
            if (skillCmd) {
              await executeSkillCommand(ctx, skillCmd, args);
            } else {
              // Check if it's a tool command
              const toolCmd = this.toolCommands.get(cmd.toLowerCase());
              if (toolCmd) {
                await executeToolCommand(ctx, toolCmd, args);
              } else {
                // Suggest similar commands
                const allCommands = [
                  ...this.builtInCommands.map(c => c.slice(1)),
                  ...Array.from(this.skillCommands.keys()),
                  ...Array.from(this.toolCommands.keys())
                ];
                const suggestions = suggestCommand(cmd, allCommands);
                if (suggestions.length > 0) {
                  console.log(chalk.yellow(`Unknown command: /${cmd}`));
                  console.log(chalk.gray(`Did you mean: ${suggestions.map(s => `/${s}`).join(', ')}?`));
                } else {
                  console.log(chalk.yellow(`Unknown command: /${cmd}`));
                  console.log(chalk.gray('Type /help for available commands'));
                }
              }
            }
        }
      } else {
        await this.chat(input);
      }

      this.rl!.prompt();
    });

    this.rl.on('close', () => {
      console.log(chalk.gray('\nGoodbye!\n'));
      this.mcp.disconnect();
      process.exit(0);
    });
  }
}
