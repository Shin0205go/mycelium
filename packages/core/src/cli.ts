/**
 * AEGIS CLI - Main CLI interface
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MCPClient, AgentManifest, ListRolesResult } from './mcp-client.js';
import { createQuery, extractTextFromMessage, isToolUseMessage, getToolUseInfo, type AgentConfig } from './agent.js';
import type { SDKMessage, ApiKeySource } from '@anthropic-ai/claude-agent-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve paths relative to project root (one level up from src/)
const projectRoot = join(__dirname, '..');
const AEGIS_ROUTER_PATH = process.env.AEGIS_ROUTER_PATH ||
  join(projectRoot, 'dist', 'mcp-server.js');
const AEGIS_CONFIG_PATH = process.env.AEGIS_CONFIG_PATH ||
  join(projectRoot, 'config.json');

export class AegisCLI {
  private mcp: MCPClient;
  private currentRole: string = 'orchestrator';
  private manifest: AgentManifest | null = null;
  private rl: readline.Interface | null = null;
  private isProcessing: boolean = false;
  private authSource: string = 'unknown';
  private useApiKey: boolean = false; // フォールバックでAPIキーを使うか

  // Commands for auto-completion
  private readonly commands = [
    '/roles',
    '/tools',
    '/status',
    '/model',
    '/help',
    '/quit'
  ];

  // Available models (cheapest first)
  private readonly models = [
    'claude-3-5-haiku-20241022',  // Cheapest, fast
    'claude-sonnet-4-5-20250929', // Balanced
    'claude-opus-4-20250514'      // Most capable
  ];
  private currentModel: string = 'claude-3-5-haiku-20241022'; // Default to cheapest

  constructor() {
    this.mcp = new MCPClient('node', [AEGIS_ROUTER_PATH], {
      AEGIS_CONFIG_PATH
    });
  }

  private async checkAuth(): Promise<boolean> {
    // First, try Claude Code auth (without API key)
    const claudeAuthOk = await this.tryAuth(false);
    if (claudeAuthOk) {
      return true;
    }

    // Claude Code auth failed - check if API key is available
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.yellow('\nClaude Codeにログインしていませんが、APIキーが設定されています。'));
      const useKey = await this.askYesNo('APIキーを使用しますか？（課金が発生します）');

      if (useKey) {
        this.useApiKey = true;
        const apiAuthOk = await this.tryAuth(true);
        if (apiAuthOk) {
          return true;
        }
      }
    }

    // No auth available
    console.error(chalk.red('\n✗ 認証エラー\n'));
    console.log(chalk.yellow('以下のいずれかで認証してください:'));
    console.log(chalk.cyan('  1. claude login') + chalk.gray(' (Maxプラン)'));
    console.log(chalk.cyan('  2. export ANTHROPIC_API_KEY=...') + chalk.gray(' (APIキー)'));
    console.log();
    return false;
  }

  private async tryAuth(useApiKey: boolean): Promise<boolean> {
    try {
      const { createQuery: createQ } = await import('./agent.js');

      // Import and call with useApiKey flag
      const queryResult = createQ('hi', {
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

      // Check if result contains login error message
      if (resultText.includes('Invalid API key') ||
          resultText.includes('/login') ||
          resultText.includes('Please run')) {
        return false;
      }

      this.authSource = authSource;
      console.log(chalk.green(`✓ Auth: ${this.formatAuthSource(this.authSource)}`));
      return true;
    } catch (error: any) {
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

  async run(): Promise<void> {
    console.log(chalk.cyan.bold('\n🛡️  AEGIS CLI - Agent Router Client\n'));

    // Check Claude Code auth first
    console.log(chalk.gray('Checking authentication...'));
    const authOk = await this.checkAuth();
    if (!authOk) {
      return;
    }

    // Connect to AEGIS Router
    console.log(chalk.gray('Connecting to AEGIS Router...'));

    this.mcp.on('log', (msg) => {
      // Suppress logs during normal operation
    });

    this.mcp.on('toolsChanged', () => {
      console.log(chalk.yellow('\n📢 Tools list updated'));
      this.showPrompt();
    });

    try {
      await this.mcp.connect();
      console.log(chalk.green('✓ Connected to AEGIS Router\n'));
    } catch (error) {
      console.error(chalk.red('Failed to connect:'), error);
      process.exit(1);
    }


    // Load orchestrator role
    await this.switchRole('orchestrator');

    // Start REPL
    this.startREPL();
  }

  private async switchRole(roleId: string): Promise<void> {
    try {
      console.log(chalk.gray(`Switching to role: ${roleId}...`));
      this.manifest = await this.mcp.switchRole(roleId);
      this.currentRole = roleId;

      console.log(chalk.green(`\n✓ Role: ${chalk.bold(this.manifest.role.name)}`));
      console.log(chalk.gray(`  ${this.manifest.role.description}`));
      console.log(chalk.gray(`  Tools: ${this.manifest.metadata.toolCount}`));
      console.log(chalk.gray(`  Servers: ${this.manifest.availableServers.join(', ')}\n`));
    } catch (error: any) {
      console.error(chalk.red(`Failed to switch role: ${error.message}`));
    }
  }

  private async listRoles(): Promise<void> {
    try {
      const result = await this.mcp.listRoles();

      // Interactive role selector
      const selectedRole = await this.interactiveRoleSelector(result.roles);

      if (selectedRole && selectedRole !== this.currentRole) {
        await this.switchRole(selectedRole);
        this.rl!.setPrompt(chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '));
      }
    } catch (error: any) {
      console.error(chalk.red(`Failed to list roles: ${error.message}`));
    }
  }

  private async interactiveRoleSelector(roles: Array<{
    id: string;
    description: string;
    serverCount: number;
    toolCount: number;
    skills: string[];
    isCurrent: boolean;
  }>): Promise<string | null> {
    return new Promise((resolve) => {
      // Find current index
      let selectedIndex = roles.findIndex(r => r.isCurrent);
      if (selectedIndex === -1) selectedIndex = 0;

      const render = () => {
        // Clear previous output and move cursor up
        process.stdout.write('\x1B[?25l'); // Hide cursor

        console.log(chalk.cyan('\nSelect Role:') + chalk.gray(' (↑↓: move, Enter: select, q: cancel)\n'));

        for (let i = 0; i < roles.length; i++) {
          const role = roles[i];
          const isSelected = i === selectedIndex;
          const isCurrent = role.isCurrent;

          const marker = isSelected ? chalk.cyan('▶') : ' ';
          const name = isSelected ? chalk.cyan.bold(role.id) : (isCurrent ? chalk.green(role.id) : role.id);
          const currentTag = isCurrent ? chalk.green(' (current)') : '';

          console.log(`  ${marker} ${name}${currentTag}`);
          console.log(chalk.gray(`    Skills: ${role.skills.join(', ') || 'none'}`));
          console.log(chalk.gray(`    Tools: ${role.toolCount} | Servers: ${role.serverCount}\n`));
        }
      };

      const clearScreen = () => {
        // Move cursor up and clear lines
        const totalLines = roles.length * 4 + 3; // 4 lines per role + header
        process.stdout.write(`\x1B[${totalLines}A`); // Move up
        for (let i = 0; i < totalLines; i++) {
          process.stdout.write('\x1B[2K\n'); // Clear line
        }
        process.stdout.write(`\x1B[${totalLines}A`); // Move up again
      };

      render();

      // Save original stdin mode
      const wasRaw = process.stdin.isRaw;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const cleanup = () => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(wasRaw || false);
        }
        process.stdin.removeListener('data', onKeyPress);
        process.stdout.write('\x1B[?25h'); // Show cursor
      };

      const onKeyPress = (key: Buffer) => {
        const keyStr = key.toString();

        // Handle arrow keys (escape sequences)
        if (keyStr === '\x1B[A' || keyStr === 'k') {
          // Up arrow or k
          clearScreen();
          selectedIndex = (selectedIndex - 1 + roles.length) % roles.length;
          render();
        } else if (keyStr === '\x1B[B' || keyStr === 'j') {
          // Down arrow or j
          clearScreen();
          selectedIndex = (selectedIndex + 1) % roles.length;
          render();
        } else if (keyStr === '\r' || keyStr === '\n') {
          // Enter
          clearScreen();
          cleanup();
          resolve(roles[selectedIndex].id);
        } else if (keyStr === 'q' || keyStr === '\x1B' || keyStr === '\x03') {
          // q, Escape, or Ctrl+C
          clearScreen();
          cleanup();
          console.log(chalk.gray('Cancelled'));
          resolve(null);
        }
      };

      process.stdin.on('data', onKeyPress);
    });
  }

  private completer(line: string): [string[], string] {
    // Command completion
    if (line.startsWith('/')) {
      // Check if completing /model <model>
      if (line.startsWith('/model ')) {
        const partial = line.slice('/model '.length);
        const matches = this.models.filter(m => m.startsWith(partial));
        return [matches.map(m => `/model ${m}`), line];
      }

      // Command completion
      const matches = this.commands.filter(c => c.startsWith(line));
      return [matches, line];
    }

    return [[], line];
  }

  private async listTools(): Promise<void> {
    if (!this.manifest) {
      console.log(chalk.yellow('No role selected'));
      return;
    }

    console.log(chalk.cyan(`\nTools for ${chalk.bold(this.manifest.role.name)}:\n`));

    // Group by source
    const bySource: Record<string, typeof this.manifest.availableTools> = {};
    for (const tool of this.manifest.availableTools) {
      if (!bySource[tool.source]) {
        bySource[tool.source] = [];
      }
      bySource[tool.source].push(tool);
    }

    for (const [source, tools] of Object.entries(bySource)) {
      console.log(chalk.yellow(`  [${source}]`));
      for (const tool of tools) {
        const shortName = tool.name.replace(`${source}__`, '');
        console.log(`    • ${chalk.bold(shortName)}`);
        if (tool.description) {
          const desc = tool.description.substring(0, 60);
          console.log(chalk.gray(`      ${desc}${tool.description.length > 60 ? '...' : ''}`));
        }
      }
      console.log();
    }
  }

  private showHelp(): void {
    console.log(chalk.cyan('\nCommands:\n'));
    console.log('  ' + chalk.bold('/roles') + '         Select and switch roles');
    console.log('  ' + chalk.bold('/tools') + '         List available tools');
    console.log('  ' + chalk.bold('/model <name>') + '  Change model');
    console.log('  ' + chalk.bold('/status') + '        Show current status');
    console.log('  ' + chalk.bold('/help') + '          Show this help');
    console.log('  ' + chalk.bold('/quit') + '          Exit');
    console.log(chalk.gray('\n  Type any message to chat with Claude.\n'));
  }

  private showStatus(): void {
    if (!this.manifest) {
      console.log(chalk.yellow('No role selected'));
      return;
    }

    // Format auth source display
    const authDisplay = this.formatAuthSource(this.authSource);

    console.log(chalk.cyan('\nCurrent Status:\n'));
    console.log(`  Role:    ${chalk.bold(this.manifest.role.name)} (${this.currentRole})`);
    console.log(`  Model:   ${chalk.bold(this.currentModel)}`);
    console.log(`  Auth:    ${authDisplay}`);
    console.log(`  Tools:   ${this.manifest.metadata.toolCount}`);
    console.log(`  Servers: ${this.manifest.availableServers.join(', ')}`);
    console.log();
  }

  private formatAuthSource(source: string): string {
    switch (source) {
      case 'none':
        return 'Claude Code認証'; // 認証成功時のみここに来る
      case 'user':
        return 'User auth';
      case 'ANTHROPIC_API_KEY':
        return chalk.yellow('API Key (課金あり)');
      case 'project':
        return chalk.blue('Project API Key');
      case 'org':
        return chalk.blue('Organization API Key');
      case 'temporary':
        return chalk.gray('Temporary Key');
      case 'unknown':
        return chalk.gray('未確認');
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

    // Get system prompt from manifest
    const systemPrompt = this.manifest?.systemInstruction;

    try {
      console.log(); // Empty line before response

      const queryResult = createQuery(message, {
        model: this.currentModel,
        systemPrompt,
        // bypassPermissions: AEGIS Router handles access control
        includePartialMessages: true,
        useApiKey: this.useApiKey
      });

      let currentText = '';
      let hasStartedOutput = false;
      let pendingRoleSwitch: string | null = null;

      for await (const msg of queryResult) {
        // Capture auth info from system init message
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.authSource = msg.apiKeySource || 'none';
        }

        // Handle streaming partial messages
        if (msg.type === 'stream_event') {
          const event = msg.event;
          if (event.type === 'content_block_delta' && 'delta' in event) {
            const delta = event.delta;
            if ('text' in delta) {
              if (!hasStartedOutput) {
                process.stdout.write(chalk.green('Claude: '));
                hasStartedOutput = true;
              }
              process.stdout.write(delta.text);
              currentText += delta.text;
            }
          }
        }

        // Handle assistant messages (for tool use display)
        if (msg.type === 'assistant') {
          if (isToolUseMessage(msg)) {
            const tools = getToolUseInfo(msg);
            for (const tool of tools) {
              const shortName = tool.name.replace('mcp__aegis-router__', '');
              console.log(chalk.gray(`\n  ⚙️  Using: ${shortName}`));
              // Track role switch attempts
              if (shortName === 'set_role') {
                const input = tool.input as { role_id?: string };
                if (input.role_id && input.role_id !== 'list') {
                  pendingRoleSwitch = input.role_id;
                }
              }
            }
          }
        }

        // Handle tool results - detect successful role switch
        if (msg.type === 'user' && (msg as any).message?.content) {
          const content = (msg as any).message.content;
          for (const block of content) {
            if (block.type === 'tool_result') {
              if (block.is_error) {
                console.log(chalk.red(`\n  ❌ Tool error: ${JSON.stringify(block.content).substring(0, 200)}`));
                pendingRoleSwitch = null;
              } else if (pendingRoleSwitch) {
                // Role switch succeeded - update CLI state and manifest
                this.currentRole = pendingRoleSwitch;
                this.rl?.setPrompt(chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '));
                console.log(chalk.green(`\n  ✓ Role switched to: ${this.currentRole}`));
                // Sync MCP client state (async, fire and forget)
                this.mcp.switchRole(pendingRoleSwitch).then(manifest => {
                  this.manifest = manifest;
                }).catch(() => {});
                pendingRoleSwitch = null;
              }
            }
          }
        }

        // Handle result
        if (msg.type === 'result') {
          if (hasStartedOutput) {
            console.log(); // Newline after streamed text
          }

          if (msg.subtype === 'success') {
            // Show usage
            const cost = msg.total_cost_usd.toFixed(4);
            const input = msg.usage.input_tokens;
            const output = msg.usage.output_tokens;

            if (this.useApiKey) {
              // APIキー使用時は実コスト
              console.log(chalk.yellow(`\n  📊 Tokens: ${input} in / ${output} out | Cost: $${cost}`));
            } else {
              // Claude Code認証時は参考値
              console.log(chalk.gray(`\n  📊 Tokens: ${input} in / ${output} out | 参考: $${cost}`));
            }
          } else {
            console.log(chalk.red(`\nError: ${msg.errors?.join(', ') || msg.subtype}`));
          }
        }
      }

      console.log(); // Empty line after response
    } catch (error: any) {
      const errorMsg = error.message || String(error);

      // Check for auth-related errors
      if (errorMsg.includes('Invalid API key') ||
          errorMsg.includes('/login') ||
          errorMsg.includes('exited with code 1')) {
        console.error(chalk.red('\n⚠️  認証エラー: Claude Codeにログインしていません'));
        console.log(chalk.yellow('  以下のコマンドでログインしてください:'));
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

      // Handle commands
      if (input.startsWith('/')) {
        const [cmd, ...args] = input.slice(1).split(/\s+/);

        switch (cmd.toLowerCase()) {
          case 'roles':
            await this.listRoles();
            break;

          case 'tools':
            await this.listTools();
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
            this.mcp.disconnect();
            process.exit(0);
            break;

          default:
            console.log(chalk.yellow(`Unknown command: /${cmd}`));
            console.log(chalk.gray('Type /help for available commands'));
        }
      } else {
        // Send to Claude via Agent SDK
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
