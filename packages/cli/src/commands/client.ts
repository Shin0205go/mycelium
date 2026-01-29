// ============================================================================
// mycelium client - Connect to running MCP server
// ============================================================================

import { Command } from 'commander';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { access } from 'fs/promises';

interface ClientOptions {
  config: string;
  role?: string;
}

/**
 * MCP Client - connects to a Mycelium MCP server
 */
class MyceliumClient {
  private client: Client | null = null;
  private rl: readline.Interface | null = null;
  private isRunning = false;

  constructor(private options: ClientOptions) {}

  async connect(): Promise<void> {
    const projectRoot = process.cwd();
    const configPath = join(projectRoot, this.options.config);

    // Verify config exists
    try {
      await access(configPath);
    } catch {
      console.error(chalk.red(`Config not found: ${configPath}`));
      process.exit(1);
    }

    // Find MCP server
    const serverPath = join(projectRoot, 'packages/core/dist/mcp-server.js');
    try {
      await access(serverPath);
    } catch {
      console.error(chalk.red(`MCP server not found: ${serverPath}`));
      console.error(chalk.yellow('Run: npm run build'));
      process.exit(1);
    }

    const spinner = ora('Connecting to Mycelium MCP server...').start();

    try {
      // Create client transport (spawns MCP server as child process)
      const transport = new StdioClientTransport({
        command: 'node',
        args: [serverPath],
        env: {
          ...process.env,
          MYCELIUM_CONFIG_PATH: configPath,
          MYCELIUM_CURRENT_ROLE: this.options.role || 'developer',
        },
      });

      // Create MCP client
      this.client = new Client(
        { name: 'mycelium-client', version: '1.0.0' },
        { capabilities: {} }
      );

      await this.client.connect(transport);
      spinner.succeed('Connected to Mycelium MCP server');

      // Show initial status
      await this.showStatus();
    } catch (error) {
      spinner.fail('Failed to connect');
      throw error;
    }
  }

  async showStatus(): Promise<void> {
    if (!this.client) return;

    try {
      // Get context from server
      const result = await this.client.callTool({
        name: 'mycelium-router__get_context',
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find(c => c.type === 'text')?.text || '{}';
      const context = JSON.parse(text);

      console.log(chalk.cyan('\n📊 Status:'));
      console.log(`  Role: ${chalk.green(context.currentRole || 'unknown')}`);
      console.log(`  Skills: ${chalk.yellow(context.activeSkills?.join(', ') || 'none')}`);
      console.log(`  Tools: ${chalk.blue(context.visibleToolCount || 0)} available\n`);
    } catch (error) {
      console.log(chalk.yellow('Could not get status'));
    }
  }

  async listTools(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.listTools();
      console.log(chalk.cyan('\n🔧 Available Tools:'));
      for (const tool of result.tools) {
        console.log(`  ${chalk.green(tool.name)}`);
        if (tool.description) {
          console.log(`    ${chalk.gray(tool.description.slice(0, 60))}...`);
        }
      }
      console.log(`\n  Total: ${result.tools.length} tools\n`);
    } catch (error) {
      console.log(chalk.red('Failed to list tools'));
    }
  }

  async listSkills(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.callTool({
        name: 'mycelium-router__list_skills',
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find(c => c.type === 'text')?.text || '[]';
      const skills = JSON.parse(text);

      console.log(chalk.cyan('\n📚 Available Skills:'));
      for (const skill of skills) {
        const status = skill.isActive ? chalk.green('●') : chalk.gray('○');
        console.log(`  ${status} ${skill.id} - ${skill.description || ''}`);
      }
      console.log();
    } catch (error) {
      console.log(chalk.red('Failed to list skills'));
    }
  }

  async setSkills(skillIds: string[]): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.callTool({
        name: 'mycelium-router__set_active_skills',
        arguments: { skills: skillIds },
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find(c => c.type === 'text')?.text || '{}';
      const response = JSON.parse(text);

      if (response.success) {
        console.log(chalk.green(`✓ Active skills: ${response.activeSkills?.join(', ')}`));
      } else {
        console.log(chalk.red(`✗ Failed: ${response.error}`));
      }
    } catch (error) {
      console.log(chalk.red('Failed to set skills'));
    }
  }

  async startRepl(): Promise<void> {
    this.isRunning = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.cyan('Mycelium Client REPL'));
    console.log(chalk.gray('Commands: /tools, /skills, /status, /set <skill1,skill2>, /exit\n'));

    const prompt = () => {
      this.rl?.question(chalk.blue('myc> '), async (input) => {
        if (!this.isRunning) return;

        const trimmed = input.trim();

        if (trimmed === '/exit' || trimmed === '/quit') {
          this.isRunning = false;
          this.rl?.close();
          await this.disconnect();
          process.exit(0);
        }

        if (trimmed === '/tools') {
          await this.listTools();
        } else if (trimmed === '/skills') {
          await this.listSkills();
        } else if (trimmed === '/status') {
          await this.showStatus();
        } else if (trimmed.startsWith('/set ')) {
          const skills = trimmed.slice(5).split(',').map(s => s.trim());
          await this.setSkills(skills);
        } else if (trimmed === '/help') {
          console.log(chalk.cyan('\nCommands:'));
          console.log('  /tools   - List available tools');
          console.log('  /skills  - List available skills');
          console.log('  /status  - Show current status');
          console.log('  /set <skills> - Set active skills (comma-separated)');
          console.log('  /exit    - Exit client\n');
        } else if (trimmed) {
          console.log(chalk.yellow('Unknown command. Type /help for available commands.'));
        }

        prompt();
      });
    };

    prompt();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}

/**
 * Run client command
 */
async function runClient(options: ClientOptions): Promise<void> {
  const client = new MyceliumClient(options);

  try {
    await client.connect();
    await client.startRepl();
  } catch (error) {
    console.error(chalk.red('Client error:'), error);
    process.exit(1);
  }
}

// Command definition
export const clientCommand = new Command('client')
  .description('Connect to a Mycelium MCP server (thin client mode)')
  .option('-c, --config <path>', 'Config file path', 'config.json')
  .option('-r, --role <role>', 'Role for the session', 'developer')
  .action(async (options: ClientOptions) => {
    await runClient(options);
  });
