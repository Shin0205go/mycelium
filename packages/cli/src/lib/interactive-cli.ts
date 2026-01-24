/**
 * AEGIS Interactive CLI - REPL with role switching and session management
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { join } from 'path';
import { MCPClient, AgentManifest, ListRolesResult } from './mcp-client.js';
import { createQuery, extractTextFromMessage, isToolUseMessage, getToolUseInfo, type AgentConfig, type SDKMessage } from './agent.js';
import { SessionStore, createSessionStore, type Session, type SessionSummary } from '@mycelium/session';

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

  // Session management
  private sessionStore: SessionStore;
  private currentSession: Session | null = null;

  private readonly commands = [
    '/roles',
    '/skills',
    '/tools',
    '/status',
    '/model',
    '/save',
    '/sessions',
    '/resume',
    '/compress',
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
    // Support both monorepo and installed package paths
    const routerPath = options.routerPath ||
      process.env.AEGIS_ROUTER_PATH ||
      join(projectRoot, 'packages', 'core', 'dist', 'mcp-server.js');
    const configPath = options.configPath ||
      process.env.AEGIS_CONFIG_PATH ||
      join(projectRoot, 'config.json');

    this.mcp = new MCPClient('node', [routerPath], {
      AEGIS_CONFIG_PATH: configPath
    });

    // Initialize session store
    const sessionDir = join(projectRoot, 'sessions');
    this.sessionStore = createSessionStore(sessionDir);

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
      console.log(chalk.green('✓ Connected to AEGIS Router'));
    } catch (error) {
      console.error(chalk.red('Failed to connect:'), error);
      process.exit(1);
    }

    // Initialize session store
    try {
      await this.sessionStore.initialize();
      console.log(chalk.green('✓ Session store initialized\n'));
    } catch (error) {
      console.error(chalk.yellow('Warning: Session store failed to initialize'), error);
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

    const tools = this.manifest.availableTools;
    if (tools.length === 0) {
      console.log(chalk.yellow('\nNo tools available for this role.\n'));
      return;
    }

    await this.interactiveToolSelector(tools);
  }

  private async interactiveToolSelector(tools: AgentManifest['availableTools']): Promise<void> {
    return new Promise((resolve) => {
      let selectedIndex = 0;

      const render = () => {
        process.stdout.write('\x1B[?25l');
        console.log(chalk.cyan('\nTools:') + chalk.gray(' (↑↓: move, Enter: view details, q: back)\n'));

        for (let i = 0; i < tools.length; i++) {
          const tool = tools[i];
          const isSelected = i === selectedIndex;
          const shortName = tool.name.replace(`${tool.source}__`, '');

          const marker = isSelected ? chalk.cyan('▶') : ' ';
          const name = isSelected ? chalk.cyan.bold(shortName) : shortName;
          const source = chalk.gray(`[${tool.source}]`);

          console.log(`  ${marker} ${name} ${source}`);
        }
      };

      const clearScreen = () => {
        const totalLines = tools.length + 3;
        process.stdout.write(`\x1B[${totalLines}A`);
        for (let i = 0; i < totalLines; i++) {
          process.stdout.write('\x1B[2K\n');
        }
        process.stdout.write(`\x1B[${totalLines}A`);
      };

      const showDetail = (tool: typeof tools[0]) => {
        clearScreen();
        const shortName = tool.name.replace(`${tool.source}__`, '');
        console.log(chalk.cyan(`\n${chalk.bold(shortName)}`));
        console.log(chalk.gray(`Source: ${tool.source}`));
        console.log(chalk.gray(`Full name: ${tool.name}\n`));
        if (tool.description) {
          console.log(tool.description);
        } else {
          console.log(chalk.gray('No description available.'));
        }
        console.log(chalk.gray('\nPress any key to go back...'));
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

      let viewingDetail = false;

      const onKeyPress = (key: Buffer) => {
        const keyStr = key.toString();

        if (viewingDetail) {
          // Any key goes back to list
          viewingDetail = false;
          clearScreen();
          render();
          return;
        }

        if (keyStr === '\x1B[A' || keyStr === 'k') {
          clearScreen();
          selectedIndex = (selectedIndex - 1 + tools.length) % tools.length;
          render();
        } else if (keyStr === '\x1B[B' || keyStr === 'j') {
          clearScreen();
          selectedIndex = (selectedIndex + 1) % tools.length;
          render();
        } else if (keyStr === '\r' || keyStr === '\n') {
          viewingDetail = true;
          showDetail(tools[selectedIndex]);
        } else if (keyStr === 'q' || keyStr === '\x1B' || keyStr === '\x03') {
          clearScreen();
          cleanup();
          resolve();
        }
      };

      process.stdin.on('data', onKeyPress);
    });
  }

  private async listSkills(): Promise<void> {
    try {
      const result = await this.mcp.listRoles();
      const currentRoleInfo = result.roles.find(r => r.id === this.currentRole);

      if (!currentRoleInfo) {
        console.log(chalk.yellow(`\nRole not found: ${this.currentRole}\n`));
        return;
      }

      const skills = currentRoleInfo.skills || [];

      if (skills.length === 0) {
        console.log(chalk.yellow(`\nNo skills for role: ${this.currentRole}\n`));
        return;
      }

      console.log(chalk.cyan(`\nSkills for ${chalk.bold(this.currentRole)} (${skills.length}):\n`));

      for (const skill of skills) {
        console.log(`  • ${chalk.bold(skill)}`);
      }
      console.log();
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to list skills: ${err.message}`));
    }
  }

  private showHelp(): void {
    console.log(chalk.cyan('\nCommands:\n'));
    console.log(chalk.gray('  Roles & Tools:'));
    console.log('  ' + chalk.bold('/roles') + '           Select and switch roles');
    console.log('  ' + chalk.bold('/skills') + '          List available skills');
    console.log('  ' + chalk.bold('/tools') + '           List available tools');
    console.log('  ' + chalk.bold('/model <name>') + '    Change model');
    console.log();
    console.log(chalk.gray('  Sessions:'));
    console.log('  ' + chalk.bold('/save [name]') + '     Save current session');
    console.log('  ' + chalk.bold('/sessions') + '        List saved sessions');
    console.log('  ' + chalk.bold('/resume [id]') + '     Resume a saved session');
    console.log('  ' + chalk.bold('/compress') + '        Compress current session');
    console.log();
    console.log(chalk.gray('  General:'));
    console.log('  ' + chalk.bold('/status') + '          Show current status');
    console.log('  ' + chalk.bold('/help') + '            Show this help');
    console.log('  ' + chalk.bold('/quit') + '            Exit');
    console.log(chalk.gray('\n  Type any message to chat with Claude.\n'));
  }

  private async showStatus(): Promise<void> {
    if (!this.manifest) {
      console.log(chalk.yellow('No role selected'));
      return;
    }

    const authDisplay = this.formatAuthSource(this.authSource);

    // Get skills for current role
    let skills: string[] = [];
    try {
      const result = await this.mcp.listRoles();
      const roleInfo = result.roles.find(r => r.id === this.currentRole);
      skills = roleInfo?.skills || [];
    } catch {
      // Ignore errors
    }

    console.log(chalk.cyan('\nCurrent Status:\n'));
    console.log(`  Role:    ${chalk.bold(this.manifest.role.name)} (${this.currentRole})`);
    console.log(`  Model:   ${chalk.bold(this.currentModel)}`);
    console.log(`  Auth:    ${authDisplay}`);
    console.log(`  Skills:  ${skills.length > 0 ? skills.join(', ') : chalk.gray('none')}`);
    console.log(`  Tools:   ${this.manifest.metadata.toolCount}`);
    // Get servers from available tools (same as /tools command)
    const servers = [...new Set(this.manifest.availableTools.map(t => t.source))];
    console.log(`  Servers: ${servers.join(', ')}`);
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

  // ============================================================================
  // Session Management
  // ============================================================================

  private async saveSession(name?: string): Promise<void> {
    try {
      if (this.currentSession) {
        // Update existing session
        if (name) {
          await this.sessionStore.rename(this.currentSession.id, name);
        }
        await this.sessionStore.save(this.currentSession);
        console.log(chalk.green(`\n✓ Session saved: ${this.currentSession.name || this.currentSession.id}`));
        console.log(chalk.gray(`  Messages: ${this.currentSession.messages.length}`));
      } else {
        // Create new session
        this.currentSession = await this.sessionStore.create(
          this.currentRole,
          name,
          [this.currentModel]
        );
        this.currentSession.metadata.model = this.currentModel;
        await this.sessionStore.save(this.currentSession);
        console.log(chalk.green(`\n✓ New session created: ${this.currentSession.name || this.currentSession.id}`));
      }
      console.log();
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to save session: ${err.message}\n`));
    }
  }

  private async listSessions(): Promise<void> {
    try {
      const sessions = await this.sessionStore.list({ limit: 20 });

      if (sessions.length === 0) {
        console.log(chalk.yellow('\nNo saved sessions.\n'));
        console.log(chalk.gray('  Use /save [name] to save the current session.\n'));
        return;
      }

      console.log(chalk.cyan(`\nSaved Sessions (${sessions.length}):\n`));

      for (const session of sessions) {
        const isCurrent = this.currentSession?.id === session.id;
        const marker = isCurrent ? chalk.green('▶') : ' ';
        const name = session.name || session.id;
        const displayName = isCurrent ? chalk.green.bold(name) : chalk.bold(name);
        const date = new Date(session.lastModifiedAt).toLocaleDateString();
        const compressed = session.compressed ? chalk.yellow(' [compressed]') : '';

        console.log(`  ${marker} ${displayName}${compressed}`);
        console.log(chalk.gray(`    Role: ${session.roleId} | Messages: ${session.messageCount} | ${date}`));
        if (session.preview) {
          console.log(chalk.gray(`    "${session.preview}"`));
        }
        console.log();
      }

      console.log(chalk.gray('  Use /resume <id> to resume a session.\n'));
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to list sessions: ${err.message}\n`));
    }
  }

  private async resumeSession(sessionId?: string): Promise<void> {
    try {
      if (!sessionId) {
        // Interactive session selector
        const sessions = await this.sessionStore.list({ limit: 20 });

        if (sessions.length === 0) {
          console.log(chalk.yellow('\nNo saved sessions to resume.\n'));
          return;
        }

        const selected = await this.interactiveSessionSelector(sessions);
        if (!selected) return;
        sessionId = selected;
      }

      const session = await this.sessionStore.load(sessionId);

      if (!session) {
        console.log(chalk.red(`\nSession not found: ${sessionId}\n`));
        return;
      }

      this.currentSession = session;

      // Switch to session's role if different
      if (session.roleId !== this.currentRole) {
        await this.switchRole(session.roleId);
        this.rl?.setPrompt(chalk.cyan(`[${this.currentRole}] `) + chalk.gray('> '));
      }

      // Switch to session's model if different
      if (session.metadata.model && session.metadata.model !== this.currentModel) {
        this.currentModel = session.metadata.model;
      }

      console.log(chalk.green(`\n✓ Resumed session: ${session.name || session.id}`));
      console.log(chalk.gray(`  Role: ${session.roleId} | Messages: ${session.messages.length}`));

      // Show last few messages as context
      const recentMessages = session.messages.slice(-3);
      if (recentMessages.length > 0) {
        console.log(chalk.gray('\n  Recent messages:'));
        for (const msg of recentMessages) {
          const role = msg.role === 'user' ? chalk.cyan('You') : chalk.green('Claude');
          const preview = msg.content.slice(0, 60).replace(/\n/g, ' ');
          console.log(chalk.gray(`    ${role}: ${preview}${msg.content.length > 60 ? '...' : ''}`));
        }
      }
      console.log();
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to resume session: ${err.message}\n`));
    }
  }

  private async interactiveSessionSelector(sessions: SessionSummary[]): Promise<string | null> {
    return new Promise((resolve) => {
      let selectedIndex = 0;

      const render = () => {
        process.stdout.write('\x1B[?25l');
        console.log(chalk.cyan('\nSelect Session:') + chalk.gray(' (↑↓: move, Enter: select, q: cancel)\n'));

        for (let i = 0; i < sessions.length; i++) {
          const session = sessions[i];
          const isSelected = i === selectedIndex;
          const isCurrent = this.currentSession?.id === session.id;

          const marker = isSelected ? chalk.cyan('▶') : ' ';
          const name = session.name || session.id.slice(0, 12);
          const displayName = isSelected ? chalk.cyan.bold(name) : (isCurrent ? chalk.green(name) : name);
          const currentTag = isCurrent ? chalk.green(' (current)') : '';
          const date = new Date(session.lastModifiedAt).toLocaleDateString();

          console.log(`  ${marker} ${displayName}${currentTag}`);
          console.log(chalk.gray(`    Role: ${session.roleId} | Messages: ${session.messageCount} | ${date}\n`));
        }
      };

      const clearScreen = () => {
        const totalLines = sessions.length * 3 + 3;
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
          selectedIndex = (selectedIndex - 1 + sessions.length) % sessions.length;
          render();
        } else if (keyStr === '\x1B[B' || keyStr === 'j') {
          clearScreen();
          selectedIndex = (selectedIndex + 1) % sessions.length;
          render();
        } else if (keyStr === '\r' || keyStr === '\n') {
          clearScreen();
          cleanup();
          resolve(sessions[selectedIndex].id);
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

  private async compressSession(): Promise<void> {
    if (!this.currentSession) {
      console.log(chalk.yellow('\nNo active session to compress.'));
      console.log(chalk.gray('  Use /save to create a session first.\n'));
      return;
    }

    const messageCount = this.currentSession.messages.length;

    if (messageCount <= 10) {
      console.log(chalk.yellow(`\nSession has only ${messageCount} messages, no compression needed.\n`));
      return;
    }

    try {
      console.log(chalk.gray(`\nCompressing session (${messageCount} messages)...`));

      const compressed = await this.sessionStore.compress(this.currentSession.id, {
        strategy: 'summarize',
        keepRecentMessages: 10,
      });

      this.currentSession = compressed;

      console.log(chalk.green(`\n✓ Session compressed`));
      console.log(chalk.gray(`  Original: ${messageCount} messages`));
      console.log(chalk.gray(`  Compressed: ${compressed.messages.length} messages`));
      console.log();
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to compress session: ${err.message}\n`));
    }
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

          case 'skills':
            await this.listSkills();
            break;

          case 'status':
            await this.showStatus();
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
