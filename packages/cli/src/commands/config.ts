/**
 * Configuration management command
 * 
 * Allows users to view, edit, and manage MYCELIUM configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { confirm, input, select } from '@inquirer/prompts';
import { createConfigManager, MyceliumConfig } from '../lib/config.js';
import { formatJSON, formatYAML } from '../lib/ui.js';

export const configCommand = new Command('config')
  .description('Manage MYCELIUM configuration')
  .addCommand(
    new Command('show')
      .description('Show current configuration')
      .option('-f, --format <format>', 'Output format (json, yaml, table)', 'table')
      .option('-s, --sources', 'Show configuration sources')
      .action(async (options) => {
        try {
          const manager = await createConfigManager();
          const config = manager.get();

          if (!config) {
            console.log(chalk.yellow('No configuration found'));
            return;
          }

          if (options.sources) {
            const sources = manager.getSources();
            console.log(chalk.bold('\nConfiguration Sources:'));
            console.log(`  Project: ${sources.project || chalk.gray('none')}`);
            console.log(`  User: ${sources.user}`);
            console.log(`  Has Project Config: ${sources.hasProject ? chalk.green('yes') : chalk.gray('no')}`);
            console.log(`  Has User Config: ${sources.hasUser ? chalk.green('yes') : chalk.gray('no')}`);
            console.log('');
          }

          if (options.format === 'json') {
            console.log(formatJSON(config));
          } else if (options.format === 'yaml') {
            console.log(await manager.export('yaml'));
          } else {
            displayConfigTable(config);
          }
        } catch (error) {
          console.error(chalk.red('Error:'), (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('get')
      .description('Get a specific configuration value')
      .argument('<key>', 'Configuration key (dot notation, e.g., preferences.defaultModel)')
      .action(async (key) => {
        try {
          const manager = await createConfigManager();
          const value = manager.getValue(key);

          if (value === undefined) {
            console.log(chalk.yellow(`No value found for key: ${key}`));
            return;
          }

          if (typeof value === 'object') {
            console.log(formatJSON(value));
          } else {
            console.log(value);
          }
        } catch (error) {
          console.error(chalk.red('Error:'), (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('set')
      .description('Set a configuration value')
      .argument('<key>', 'Configuration key (dot notation)')
      .argument('[value]', 'Value to set (will prompt if not provided)')
      .option('-t, --type <type>', 'Value type (string, number, boolean, json)', 'string')
      .action(async (key, value, options) => {
        try {
          const manager = await createConfigManager();
          
          let parsedValue: any = value;

          // Prompt for value if not provided
          if (value === undefined) {
            const inputValue = await input({
              message: `Enter value for ${key}:`,
            });
            parsedValue = inputValue;
          }

          // Parse value based on type
          if (options.type === 'number') {
            parsedValue = parseFloat(parsedValue);
            if (isNaN(parsedValue)) {
              throw new Error('Invalid number value');
            }
          } else if (options.type === 'boolean') {
            parsedValue = parsedValue === 'true' || parsedValue === '1';
          } else if (options.type === 'json') {
            parsedValue = JSON.parse(parsedValue);
          }

          await manager.setValue(key, parsedValue);
          console.log(chalk.green(`✓ Set ${key} = ${JSON.stringify(parsedValue)}`));
        } catch (error) {
          console.error(chalk.red('Error:'), (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('validate')
      .description('Validate configuration')
      .action(async () => {
        try {
          const manager = await createConfigManager();
          const config = manager.get();

          if (!config) {
            console.log(chalk.yellow('No configuration to validate'));
            return;
          }

          const result = manager.validate(config);

          if (result.valid) {
            console.log(chalk.green('✓ Configuration is valid'));
          } else {
            console.log(chalk.red('✗ Configuration has errors:'));
            for (const error of result.errors) {
              console.log(chalk.red(`  - ${error}`));
            }
            process.exit(1);
          }
        } catch (error) {
          console.error(chalk.red('Error:'), (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('init')
      .description('Initialize a new configuration file')
      .option('-d, --dir <directory>', 'Directory to initialize in', process.cwd())
      .option('-f, --force', 'Overwrite existing configuration')
      .action(async (options) => {
        try {
          const manager = await createConfigManager();
          const configPath = await manager.initProject(options.dir);

          console.log(chalk.green('✓ Created configuration file:'));
          console.log(chalk.blue(`  ${configPath}`));
          console.log('');
          console.log('Edit the file to customize your MYCELIUM setup.');
        } catch (error) {
          console.error(chalk.red('Error:'), (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('mcp')
      .description('Manage MCP server configurations')
      .addCommand(
        new Command('list')
          .description('List all MCP servers')
          .action(async () => {
            try {
              const manager = await createConfigManager();
              const servers = manager.listMCPServers();

              if (servers.length === 0) {
                console.log(chalk.yellow('No MCP servers configured'));
                return;
              }

              const table = new Table({
                head: [
                  chalk.cyan('Name'),
                  chalk.cyan('Command'),
                  chalk.cyan('Status'),
                  chalk.cyan('Comment'),
                ],
                colWidths: [25, 20, 10, 50],
                wordWrap: true,
              });

              for (const [name, config] of servers) {
                table.push([
                  name,
                  config.command,
                  config.disabled ? chalk.red('disabled') : chalk.green('enabled'),
                  config.comment || '',
                ]);
              }

              console.log(table.toString());
            } catch (error) {
              console.error(chalk.red('Error:'), (error as Error).message);
              process.exit(1);
            }
          })
      )
      .addCommand(
        new Command('enable')
          .description('Enable an MCP server')
          .argument('<server>', 'Server name')
          .action(async (server) => {
            try {
              const manager = await createConfigManager();
              await manager.setMCPServerEnabled(server, true);
              console.log(chalk.green(`✓ Enabled MCP server: ${server}`));
            } catch (error) {
              console.error(chalk.red('Error:'), (error as Error).message);
              process.exit(1);
            }
          })
      )
      .addCommand(
        new Command('disable')
          .description('Disable an MCP server')
          .argument('<server>', 'Server name')
          .action(async (server) => {
            try {
              const manager = await createConfigManager();
              await manager.setMCPServerEnabled(server, false);
              console.log(chalk.yellow(`✓ Disabled MCP server: ${server}`));
            } catch (error) {
              console.error(chalk.red('Error:'), (error as Error).message);
              process.exit(1);
            }
          })
      )
      .addCommand(
        new Command('show')
          .description('Show details of a specific MCP server')
          .argument('<server>', 'Server name')
          .action(async (server) => {
            try {
              const manager = await createConfigManager();
              const config = manager.getMCPServer(server);

              if (!config) {
                console.log(chalk.yellow(`MCP server '${server}' not found`));
                return;
              }

              console.log(chalk.bold(`\nMCP Server: ${server}`));
              console.log(`  Command: ${config.command}`);
              console.log(`  Args: ${config.args.join(' ')}`);
              console.log(`  Status: ${config.disabled ? chalk.red('disabled') : chalk.green('enabled')}`);
              if (config.comment) {
                console.log(`  Comment: ${config.comment}`);
              }
              if (config.env) {
                console.log(`  Environment:`);
                for (const [key, value] of Object.entries(config.env)) {
                  console.log(`    ${key}=${value}`);
                }
              }
              console.log('');
            } catch (error) {
              console.error(chalk.red('Error:'), (error as Error).message);
              process.exit(1);
            }
          })
      )
  )
  .addCommand(
    new Command('export')
      .description('Export configuration to a file')
      .option('-f, --format <format>', 'Export format (json, yaml)', 'json')
      .option('-o, --output <file>', 'Output file (defaults to stdout)')
      .action(async (options) => {
        try {
          const manager = await createConfigManager();
          const output = await manager.export(options.format);

          if (options.output) {
            const fs = await import('fs/promises');
            await fs.writeFile(options.output, output, 'utf-8');
            console.log(chalk.green(`✓ Exported configuration to ${options.output}`));
          } else {
            console.log(output);
          }
        } catch (error) {
          console.error(chalk.red('Error:'), (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('edit')
      .description('Interactively edit configuration')
      .action(async () => {
        try {
          const manager = await createConfigManager();
          const config = manager.get();

          if (!config) {
            console.log(chalk.yellow('No configuration found'));
            return;
          }

          console.log(chalk.bold('\nConfiguration Editor\n'));

          const section = await select({
            message: 'What would you like to edit?',
            choices: [
              { name: 'Preferences', value: 'preferences' },
              { name: 'Paths', value: 'paths' },
              { name: 'API Settings', value: 'api' },
              { name: 'MCP Servers', value: 'mcp' },
              { name: 'Cancel', value: 'cancel' },
            ],
          });

          if (section === 'cancel') {
            return;
          }

          if (section === 'preferences') {
            await editPreferences(manager);
          } else if (section === 'paths') {
            await editPaths(manager);
          } else if (section === 'api') {
            await editAPI(manager);
          } else if (section === 'mcp') {
            await editMCPServers(manager);
          }
        } catch (error) {
          console.error(chalk.red('Error:'), (error as Error).message);
          process.exit(1);
        }
      })
  );

/**
 * Display configuration as a formatted table
 */
function displayConfigTable(config: MyceliumConfig): void {
  console.log(chalk.bold('\nMYCELIUM Configuration\n'));

  // Preferences
  if (config.preferences) {
    console.log(chalk.cyan('Preferences:'));
    const table = new Table({ style: { 'padding-left': 2 } });
    for (const [key, value] of Object.entries(config.preferences)) {
      table.push([key, String(value)]);
    }
    console.log(table.toString());
    console.log('');
  }

  // Paths
  if (config.paths) {
    console.log(chalk.cyan('Paths:'));
    const table = new Table({ style: { 'padding-left': 2 } });
    for (const [key, value] of Object.entries(config.paths)) {
      table.push([key, String(value)]);
    }
    console.log(table.toString());
    console.log('');
  }

  // API
  if (config.api) {
    console.log(chalk.cyan('API Settings:'));
    const table = new Table({ style: { 'padding-left': 2 } });
    for (const [key, value] of Object.entries(config.api)) {
      if (key === 'apiKey') {
        table.push([key, value ? '***' : 'not set']);
      } else {
        table.push([key, String(value)]);
      }
    }
    console.log(table.toString());
    console.log('');
  }

  // MCP Servers
  if (config.mcpServers) {
    console.log(chalk.cyan('MCP Servers:'));
    const table = new Table({
      head: ['Name', 'Command', 'Status'],
      colWidths: [25, 30, 10],
    });
    for (const [name, server] of Object.entries(config.mcpServers)) {
      table.push([
        name,
        `${server.command} ${server.args.join(' ')}`,
        server.disabled ? chalk.red('disabled') : chalk.green('enabled'),
      ]);
    }
    console.log(table.toString());
    console.log('');
  }
}

/**
 * Interactively edit preferences
 */
async function editPreferences(manager: any): Promise<void> {
  const currentModel = manager.getValue('preferences.defaultModel');
  const defaultModel = await input({
    message: 'Default model:',
    default: currentModel || 'claude-3-5-sonnet-20241022',
  });
  await manager.setValue('preferences.defaultModel', defaultModel);

  const currentRole = manager.getValue('preferences.defaultRole');
  const defaultRole = await input({
    message: 'Default role:',
    default: currentRole || 'default',
  });
  await manager.setValue('preferences.defaultRole', defaultRole);

  const currentFormat = manager.getValue('preferences.outputFormat');
  const outputFormat = await select({
    message: 'Output format:',
    choices: [
      { name: 'Table', value: 'table' },
      { name: 'JSON', value: 'json' },
      { name: 'Plain', value: 'plain' },
    ],
    default: currentFormat || 'table',
  });
  await manager.setValue('preferences.outputFormat', outputFormat);

  console.log(chalk.green('\n✓ Preferences updated'));
}

/**
 * Interactively edit paths
 */
async function editPaths(manager: any): Promise<void> {
  const currentSkillsDir = manager.getValue('paths.skillsDir');
  const skillsDir = await input({
    message: 'Skills directory:',
    default: currentSkillsDir || 'packages/skills/skills',
  });
  await manager.setValue('paths.skillsDir', skillsDir);

  const currentSessionsDir = manager.getValue('paths.sessionsDir');
  const sessionsDir = await input({
    message: 'Sessions directory:',
    default: currentSessionsDir || 'sessions',
  });
  await manager.setValue('paths.sessionsDir', sessionsDir);

  console.log(chalk.green('\n✓ Paths updated'));
}

/**
 * Interactively edit API settings
 */
async function editAPI(manager: any): Promise<void> {
  const currentTimeout = manager.getValue('preferences.timeout');
  const timeoutStr = await input({
    message: 'Request timeout (ms):',
    default: String(currentTimeout || 300000),
  });
  await manager.setValue('api.timeout', parseInt(timeoutStr));

  const currentRetries = manager.getValue('api.maxRetries');
  const retriesStr = await input({
    message: 'Max retries:',
    default: String(currentRetries || 3),
  });
  await manager.setValue('api.maxRetries', parseInt(retriesStr));

  console.log(chalk.green('\n✓ API settings updated'));
}

/**
 * Interactively edit MCP servers
 */
async function editMCPServers(manager: any): Promise<void> {
  const servers = manager.listMCPServers();
  
  if (servers.length === 0) {
    console.log(chalk.yellow('No MCP servers configured'));
    return;
  }

  const choices = servers.map(([name, _]: [string, any]) => ({
    name,
    value: name,
  }));
  choices.push({ name: 'Cancel', value: 'cancel' });

  const server = await select({
    message: 'Select server to edit:',
    choices,
  });

  if (server === 'cancel') {
    return;
  }

  const action = await select({
    message: `What would you like to do with ${server}?`,
    choices: [
      { name: 'Enable', value: 'enable' },
      { name: 'Disable', value: 'disable' },
      { name: 'Cancel', value: 'cancel' },
    ],
  });

  if (action === 'enable') {
    await manager.setMCPServerEnabled(server, true);
    console.log(chalk.green(`\n✓ Enabled ${server}`));
  } else if (action === 'disable') {
    await manager.setMCPServerEnabled(server, false);
    console.log(chalk.yellow(`\n✓ Disabled ${server}`));
  }
}
