/**
 * AEGIS Interactive CLI - REPL with role switching
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { join } from 'path';
import { MCPClient, AgentManifest, ListRolesResult } from './mcp-client.js';
import { createQuery, extractTextFromMessage, isToolUseMessage, getToolUseInfo, type AgentConfig, type SDKMessage } from './agent.js';

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
    const projectRoot = process.cwd();
    const routerPath = options.routerPath ||
      process.env.AEGIS_ROUTER_PATH ||
      join(projectRoot, 'node_modules', '@aegis', 'core', 'dist', 'mcp-server.js');
    const configPath = options.configPath ||
      process.env.AEGIS_CONFIG_PATH ||
      join(projectRoot, 'config.json');

    this.mcp = new MCPClient('node', [routerPath], {
      AEGIS_CONFIG_PATH: configPath
    });

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

  async run(): Promise<void> {
    console.log(chalk.cyan.bold('\n🛡️  AEGIS CLI - Interactive Mode\n'));

    console.log(chalk.gray('Checking authentication...'));
    const authOk = await this.checkAuth();
    if (!authOk) {
      return;
    }

    console.log(chalk.gray('Connecting to AEGIS Router...'));

    this.mcp.on('log', () => {
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

    await this.switchRole(this.currentRole);
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
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to switch role: ${err.message}`));
    }
  }

  private async listRoles(): Promise<void> {
    try {
      const result = await this.mcp.listRoles();
      const selectedRole = await this.interactiveRoleSelector(result.roles);

      if (selectedRole && selectedRole !== this.currentRole) {
        await this.switchRole(selectedRole);
        this.rl!.setPrompt(chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '));
      }
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to list roles: ${err.message}`));
    }
  }

  private async interactiveRoleSelector(roles: ListRolesResult['roles']): Promise<string | null> {
    return new Promise((resolve) => {
      let selectedIndex = roles.findIndex(r => r.isCurrent);
      if (selectedIndex === -1) selectedIndex = 0;

      const render = () => {
        process.stdout.write('\x1B[?25l');
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
        const totalLines = roles.length * 4 + 3;
        process.stdout.write(`\x1B[${totalLines}A`);
        for (let i = 0; i < totalLines; i++) {
          process.stdout.write('\x1B[2K\n');
        }
        process.stdout.write(`\x1B[${totalLines}A`);
      };

      render();

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
        process.stdout.write('\x1B[?25h');
      };

      const onKeyPress = (key: Buffer) => {
        const keyStr = key.toString();

        if (keyStr === '\x1B[A' || keyStr === 'k') {
          clearScreen();
          selectedIndex = (selectedIndex - 1 + roles.length) % roles.length;
          render();
        } else if (keyStr === '\x1B[B' || keyStr === 'j') {
          clearScreen();
          selectedIndex = (selectedIndex + 1) % roles.length;
          render();
        } else if (keyStr === '\r' || keyStr === '\n') {
          clearScreen();
          cleanup();
          resolve(roles[selectedIndex].id);
        } else if (keyStr === 'q' || keyStr === '\x1B' || keyStr === '\x03') {
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

  private async listTools(): Promise<void> {
    if (!this.manifest) {
      console.log(chalk.yellow('No role selected'));
      return;
    }

    console.log(chalk.cyan(`\nTools for ${chalk.bold(this.manifest.role.name)}:\n`));

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
    const systemPrompt = this.manifest?.systemInstruction;

    try {
      console.log();

      const queryResult = await createQuery(message, {
        model: this.currentModel,
        systemPrompt,
        includePartialMessages: true,
        useApiKey: this.useApiKey
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
