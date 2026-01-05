/**
 * AEGIS Interactive CLI - REPL with role switching
 * SDK-only version: Uses Claude Agent SDK session persistence
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { createQuery, isToolUseMessage, getToolUseInfo, type SDKMessage } from './agent.js';

export interface InteractiveCLIOptions {
  role?: string;
  model?: string;
  configPath?: string;
  routerPath?: string;
}

interface ToolInfo {
  name: string;
  source: string;
}

export class InteractiveCLI {
  private currentRole: string = 'orchestrator';
  private rl: readline.Interface | null = null;
  private isProcessing: boolean = false;
  private authSource: string = 'unknown';
  private useApiKey: boolean = false;
  private isFirstQuery: boolean = true;
  private availableTools: ToolInfo[] = [];

  // Session tracking for debug info
  private queryCount: number = 0;
  private sessionId: string | null = null;
  private sessionFilePath: string | null = null;
  private lastQueryTimestamp: Date | null = null;

  private readonly commands = [
    '/roles',
    '/tools',
    '/status',
    '/model',
    '/help',
    '/quit'
  ];

  private readonly models = [
    'claude-3-5-haiku-20241022',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-20250514'
  ];
  private currentModel: string = 'claude-3-5-haiku-20241022';

  constructor(private options: InteractiveCLIOptions = {}) {
    if (options.role) {
      this.currentRole = options.role;
    }
    if (options.model) {
      this.currentModel = options.model;
    }
  }

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
        useApiKey,
        currentRole: this.currentRole,
        persistSession: false,  // Don't persist auth check session
        continueSession: false
      });

      let authSource = 'unknown';
      let resultText = '';
      let gotSuccessResult = false;

      try {
        for await (const msg of queryResult) {
          if (msg.type === 'system' && msg.subtype === 'init') {
            authSource = msg.apiKeySource || 'none';
            // Cache available tools from init message
            this.updateToolsFromInit(msg);
          }
          if (msg.type === 'result' && msg.subtype === 'success') {
            resultText = msg.result || '';
            gotSuccessResult = true;
          }
        }
      } catch (iterError) {
        // Ignore cleanup errors if we already got a success result
        if (!gotSuccessResult) {
          throw iterError;
        }
      }

      if (!gotSuccessResult) {
        return false;
      }

      if (resultText.includes('Invalid API key') ||
          resultText.includes('/login') ||
          resultText.includes('Please run')) {
        return false;
      }

      this.authSource = authSource;
      console.log(chalk.green(`✓ Auth: ${this.formatAuthSource(this.authSource)}`));
      return true;
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red(`Auth check failed: ${err.message}`));
      if (process.env.DEBUG) {
        console.error(err.stack);
      }
      return false;
    }
  }

  private updateToolsFromInit(initMsg: SDKMessage): void {
    if (initMsg.tools) {
      this.availableTools = initMsg.tools.map((name: string) => {
        // Parse tool name like "mcp__aegis-router__filesystem__read_file"
        const withoutMcp = name.replace(/^mcp__[^_]+__/, '');
        const parts = withoutMcp.split('__');
        return {
          name: withoutMcp,
          source: parts[0] || 'unknown'
        };
      });
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

  private showBanner(): void {
    const banner = `
    ${chalk.cyan('    ___    _______________  _____')}
    ${chalk.cyan('   /   |  / ____/ ____/  _// ___/')}
    ${chalk.cyan('  / /| | / __/ / / __ / /  \\__ \\ ')}
    ${chalk.cyan(' / ___ |/ /___/ /_/ // /  ___/ / ')}
    ${chalk.cyan('/_/  |_/_____/\\____/___/ /____/  ')}
    ${chalk.gray('Role-Based Access Control Router')}
`;
    console.log(banner);
  }

  async run(): Promise<void> {
    this.showBanner();

    console.log(chalk.gray('Checking authentication...'));
    const authOk = await this.checkAuth();
    if (!authOk) {
      return;
    }

    console.log(chalk.green(`✓ Role: ${chalk.bold(this.currentRole)}\n`));
    console.log(chalk.gray('Session persistence enabled - conversation memory will be maintained.\n'));

    // デバッグ: セッション永続化の設定を詳細に出力
    if (process.env.DEBUG) {
      console.log(chalk.yellow('┌─ Debug: Session Configuration ───────────'));
      console.log(chalk.gray('│ Session Settings:'));
      console.log(chalk.gray(`│   Persist Session: true`));
      console.log(chalk.gray(`│   Continue Session: ${!this.isFirstQuery}`));
      console.log(chalk.gray(`│   Current Role: ${this.currentRole}`));
      console.log(chalk.gray(`│   Auth Source: ${this.authSource}`));
      console.log(chalk.gray('│'));
      console.log(chalk.gray('│ Session State:'));
      console.log(chalk.gray(`│   Query Count: ${this.queryCount}`));
      console.log(chalk.gray(`│   Is First Query: ${this.isFirstQuery}`));
      console.log(chalk.yellow('└──────────────────────────────────────────\n'));
    }

    this.startREPL();
  }

  private completer(line: string): [string[], string] {
    if (line.startsWith('/')) {
      if (line.startsWith('/model ')) {
        const partial = line.slice('/model '.length);
        const matches = this.models.filter(m => m.startsWith(partial));
        return [matches.map(m => `/model ${m}`), line];
      }
      const matches = this.commands.filter(c => c.startsWith(line));
      return [matches, line];
    }
    return [[], line];
  }

  private listTools(): void {
    if (this.availableTools.length === 0) {
      console.log(chalk.yellow('\nNo tools cached. Tools will be available after your first message.\n'));
      return;
    }

    console.log(chalk.cyan(`\nAvailable Tools (${this.availableTools.length}):\n`));

    // Group by source
    const bySource = new Map<string, string[]>();
    for (const tool of this.availableTools) {
      const existing = bySource.get(tool.source) || [];
      existing.push(tool.name.replace(`${tool.source}__`, ''));
      bySource.set(tool.source, existing);
    }

    for (const [source, tools] of bySource) {
      console.log(chalk.bold(`  ${source}:`));
      for (const tool of tools) {
        console.log(chalk.gray(`    • ${tool}`));
      }
    }
    console.log();
  }

  private showHelp(): void {
    console.log(chalk.cyan('\nCommands:\n'));
    console.log('  ' + chalk.bold('/roles') + '         Ask Claude to switch roles');
    console.log('  ' + chalk.bold('/tools') + '         List available tools');
    console.log('  ' + chalk.bold('/model <name>') + '  Change model');
    console.log('  ' + chalk.bold('/status') + '        Show current status');
    console.log('  ' + chalk.bold('/help') + '          Show this help');
    console.log('  ' + chalk.bold('/quit') + '          Exit');
    console.log(chalk.gray('\n  Type any message to chat with Claude.'));
    console.log(chalk.gray('  To switch roles, say "switch to <role> role" or ask to list roles.\n'));
  }

  private showStatus(): void {
    const authDisplay = this.formatAuthSource(this.authSource);

    console.log(chalk.cyan('\nCurrent Status:\n'));
    console.log(`  Role:    ${chalk.bold(this.currentRole)}`);
    console.log(`  Model:   ${chalk.bold(this.currentModel)}`);
    console.log(`  Auth:    ${authDisplay}`);
    console.log(`  Tools:   ${this.availableTools.length}`);

    // Session info
    const sessionStatus = this.isFirstQuery
      ? chalk.yellow('New (no history)')
      : chalk.green(`Continued (${this.queryCount} queries)`);
    console.log(`  Session: ${sessionStatus}`);

    // Extended session info in debug mode
    if (process.env.DEBUG) {
      console.log(chalk.gray('\n  Debug Info:'));
      if (this.sessionId) {
        console.log(chalk.gray(`    Session ID: ${this.sessionId}`));
      }
      if (this.sessionFilePath) {
        console.log(chalk.gray(`    Session File: ${this.sessionFilePath}`));
      }
      if (this.lastQueryTimestamp) {
        const elapsed = Math.round((Date.now() - this.lastQueryTimestamp.getTime()) / 1000);
        console.log(chalk.gray(`    Last Query: ${elapsed}s ago`));
      }
      console.log(chalk.gray(`    History: ${this.queryCount > 0 ? 'Maintained' : 'Empty'}`));
    }
    console.log();
  }

  private formatAuthSource(source: string): string {
    switch (source) {
      case 'none':
        return 'Claude Code Auth';
      case 'user':
        return 'User auth';
      case 'ANTHROPIC_API_KEY':
        return chalk.yellow('API Key (charges apply)');
      case 'project':
        return chalk.blue('Project API Key');
      case 'org':
        return chalk.blue('Organization API Key');
      case 'temporary':
        return chalk.gray('Temporary Key');
      case 'unknown':
        return chalk.gray('Unknown');
      default:
        return source;
    }
  }

  private showModels(): void {
    const modelInfo: Record<string, string> = {
      'claude-3-5-haiku-20241022': '💨 Fast & cheap',
      'claude-sonnet-4-5-20250929': '⚖️  Balanced',
      'claude-opus-4-20250514': '🧠 Most capable'
    };

    console.log(chalk.cyan('\nAvailable Models:\n'));
    console.log(chalk.gray('  Usage: /model <model_name>\n'));
    this.models.forEach(m => {
      const current = m === this.currentModel ? chalk.green(' ← current') : '';
      const info = modelInfo[m] || '';
      console.log(`  • ${chalk.bold(m)} ${chalk.gray(info)}${current}`);
    });
    console.log();
  }

  private async chat(message: string): Promise<void> {
    if (this.isProcessing) {
      console.log(chalk.yellow('Already processing a request...'));
      return;
    }

    this.isProcessing = true;

    try {
      console.log();

      const queryConfig = {
        model: this.currentModel,
        includePartialMessages: true,
        useApiKey: this.useApiKey,
        currentRole: this.currentRole,
        persistSession: true,
        continueSession: !this.isFirstQuery  // Continue after first query
      };

      // デバッグ: セッション設定の詳細ログ
      if (process.env.DEBUG) {
        console.log(chalk.yellow('┌─ Debug: Query Configuration ─────────────'));
        console.log(chalk.gray(`│ Model: ${queryConfig.model}`));
        console.log(chalk.gray(`│ Role: ${queryConfig.currentRole}`));
        console.log(chalk.gray(`│ Persist Session: ${queryConfig.persistSession}`));
        console.log(chalk.gray(`│ Continue Session: ${queryConfig.continueSession}`));
        console.log(chalk.gray(`│ Query Number: ${this.queryCount + 1}`));
        console.log(chalk.yellow('└──────────────────────────────────────────'));
      }

      const queryResult = await createQuery(message, queryConfig);

      let hasStartedOutput = false;
      let pendingRoleSwitch: string | null = null;

      for await (const msg of queryResult) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.authSource = msg.apiKeySource || 'none';
          this.updateToolsFromInit(msg);

          // Capture session info for tracking
          if (msg.session_id) {
            this.sessionId = msg.session_id;
          }
          if (msg.session_file_path) {
            this.sessionFilePath = msg.session_file_path;
          }

          // デバッグ: system/initメッセージの詳細出力
          if (process.env.DEBUG) {
            console.log(chalk.yellow('\n┌─ Debug: System Init ─────────────────────'));
            console.log(chalk.gray('│ API Key Source: ') + chalk.bold(this.authSource));

            // セッション関連情報のデバッグ出力
            console.log(chalk.gray('│'));
            console.log(chalk.gray('│ Session State:'));
            console.log(chalk.gray(`│   Query #: ${this.queryCount + 1} (${this.isFirstQuery ? 'new session' : 'continuing'})`));
            if (msg.session_id) {
              console.log(chalk.gray(`│   Session ID: ${msg.session_id}`));
            }
            if (msg.session_file_path) {
              console.log(chalk.gray(`│   Session File: ${msg.session_file_path}`));
            }
            if (msg.resumedFromSession) {
              console.log(chalk.green(`│   ✓ Resumed from previous session`));
            }
            if (msg.messageCount !== undefined) {
              console.log(chalk.gray(`│   History Messages: ${msg.messageCount}`));
            }

            // ツール情報のデバッグ出力
            if (msg.tools && msg.tools.length > 0) {
              console.log(chalk.gray('│'));
              console.log(chalk.gray(`│ Available Tools (${msg.tools.length}):`));
              const toolCount = Math.min(5, msg.tools.length);
              msg.tools.slice(0, toolCount).forEach((tool: string) => {
                const shortName = tool.replace('mcp__aegis-router__', '');
                console.log(chalk.gray(`│   • ${shortName}`));
              });
              if (msg.tools.length > 5) {
                console.log(chalk.gray(`│   ... and ${msg.tools.length - 5} more`));
              }
            }
            console.log(chalk.yellow('└──────────────────────────────────────────\n'));
          }
        }

        if (msg.type === 'stream_event') {
          const event = msg.event;
          if (event?.type === 'content_block_delta' && event.delta?.text) {
            if (!hasStartedOutput) {
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
              const shortName = tool.name.replace('mcp__aegis-router__', '');
              console.log(chalk.gray(`\n  ⚙️  Using: ${shortName}`));
              if (shortName === 'set_role') {
                const input = tool.input as { role_id?: string };
                if (input.role_id && input.role_id !== 'list') {
                  pendingRoleSwitch = input.role_id;
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
                const previousRole = this.currentRole;
                this.currentRole = pendingRoleSwitch;
                this.rl?.setPrompt(chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '));
                console.log(chalk.green(`\n  ✓ Role switched to: ${this.currentRole}`));

                // Force new session on next query to get correct tools for new role
                this.isFirstQuery = true;
                this.sessionId = null;  // Clear session ID for new role
                console.log(chalk.gray('  (New session will start with updated tools)'));

                // Debug info for role switch
                if (process.env.DEBUG) {
                  console.log(chalk.yellow('\n┌─ Debug: Role Switch ─────────────────────'));
                  console.log(chalk.gray(`│ Previous Role: ${previousRole}`));
                  console.log(chalk.gray(`│ New Role: ${this.currentRole}`));
                  console.log(chalk.gray(`│ Previous Query Count: ${this.queryCount}`));
                  console.log(chalk.gray('│ Session Reset: true (new role = new session)'));
                  console.log(chalk.yellow('└──────────────────────────────────────────'));
                }

                pendingRoleSwitch = null;
              }
            }
          }
        }

        if (msg.type === 'result') {
          if (hasStartedOutput) {
            console.log();
          }

          if (msg.subtype === 'success') {
            const cost = msg.total_cost_usd.toFixed(4);
            const input = msg.usage.input_tokens;
            const output = msg.usage.output_tokens;

            if (this.useApiKey) {
              console.log(chalk.yellow(`\n  📊 Tokens: ${input} in / ${output} out | Cost: $${cost}`));
            } else {
              console.log(chalk.gray(`\n  📊 Tokens: ${input} in / ${output} out | Est: $${cost}`));
            }

            // Update session tracking
            this.queryCount++;
            this.lastQueryTimestamp = new Date();

            // Debug: Show session continuation status
            if (process.env.DEBUG) {
              console.log(chalk.gray(`  🔗 Session: Query #${this.queryCount} completed`));
              if (!this.isFirstQuery) {
                console.log(chalk.green(`  ✓ History: Conversation context maintained`));
              }
            }

            // After first successful query, enable session continuation
            this.isFirstQuery = false;
          } else {
            console.log(chalk.red(`\nError: ${msg.errors?.join(', ') || msg.subtype}`));
          }
        }
      }

      console.log();
    } catch (error: unknown) {
      const err = error as Error;
      const errorMsg = err.message || String(error);

      if (errorMsg.includes('Invalid API key') ||
          errorMsg.includes('/login') ||
          errorMsg.includes('exited with code 1')) {
        console.error(chalk.red('\n⚠️  Auth error: Not logged in to Claude Code'));
        console.log(chalk.yellow('  Please login with:'));
        console.log(chalk.cyan('    claude login\n'));
      } else {
        console.error(chalk.red(`\nError: ${errorMsg}\n`));
      }
    } finally {
      this.isProcessing = false;
    }
  }

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

    this.showHelp();
    console.log(chalk.gray('  (Tab for auto-completion)\n'));
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        this.rl!.prompt();
        return;
      }

      // Handle both /command and common commands without slash
      const isSlashCommand = input.startsWith('/');
      const normalizedInput = input.toLowerCase().trim();

      // Common commands that work with or without /
      const commonCommands = ['help', 'exit', 'quit', 'q', 'roles', 'tools', 'status'];
      const isCommonCommand = commonCommands.includes(normalizedInput);

      if (isSlashCommand || isCommonCommand) {
        const [cmd, ...args] = isSlashCommand
          ? input.slice(1).split(/\s+/)
          : input.split(/\s+/);

        switch (cmd.toLowerCase()) {
          case 'roles':
            console.log(chalk.cyan('\nTo switch roles, ask Claude:'));
            console.log(chalk.gray('  • "List available roles"'));
            console.log(chalk.gray('  • "Switch to meta-developer role"'));
            console.log(chalk.gray('  • "What role am I currently using?"\n'));
            break;

          case 'tools':
            this.listTools();
            break;

          case 'status':
            this.showStatus();
            break;

          case 'model':
            if (args[0]) {
              if (this.models.includes(args[0]) || args[0].startsWith('claude-')) {
                this.currentModel = args[0];
                console.log(chalk.green(`✓ Model changed to: ${chalk.bold(this.currentModel)}`));
              } else {
                this.showModels();
              }
            } else {
              this.showModels();
            }
            break;

          case 'help':
            this.showHelp();
            break;

          case 'quit':
          case 'exit':
          case 'q':
            console.log(chalk.gray('\nGoodbye!\n'));
            process.exit(0);

          default:
            console.log(chalk.yellow(`Unknown command: /${cmd}`));
            console.log(chalk.gray('Type /help for available commands'));
        }
      } else {
        await this.chat(input);
      }

      this.rl!.prompt();
    });

    this.rl.on('close', () => {
      console.log(chalk.gray('\nGoodbye!\n'));
      process.exit(0);
    });
  }
}
