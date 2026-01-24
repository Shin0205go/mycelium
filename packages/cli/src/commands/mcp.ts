// ============================================================================
// mycelium mcp - MCP server management commands
// ============================================================================

import { Command } from 'commander';
import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export const mcpCommand = new Command('mcp')
  .description('MCP server management');

// mycelium mcp start
mcpCommand
  .command('start')
  .description('Start the mycelium MCP server')
  .option('-c, --config <path>', 'Config file path', './config.json')
  .option('--background', 'Run in background')
  .option('--dev', 'Run in development mode (with tsx)')
  .action(async (options: { config: string; background?: boolean; dev?: boolean }) => {
    const configPath = join(process.cwd(), options.config);

    console.log(chalk.blue('🚀 Starting mycelium MCP Server...'));
    console.log();

    try {
      // Check if config exists
      try {
        await access(configPath);
      } catch {
        console.error(chalk.red(`❌ Config file not found: ${configPath}`));
        console.log(chalk.cyan('Initialize project: ') + chalk.white('mycelium init'));
        process.exit(1);
      }

      // Find the MCP server entry point
      const possiblePaths = [
        join(process.cwd(), 'dist', 'mcp-server.js'),
        join(process.cwd(), 'src', 'mcp-server.ts'),
        join(process.cwd(), 'node_modules', '@mycelium', 'core', 'dist', 'mcp-server.js')
      ];

      let serverPath: string | null = null;
      for (const path of possiblePaths) {
        try {
          await access(path);
          serverPath = path;
          break;
        } catch {
          // Try next
        }
      }

      if (!serverPath) {
        console.error(chalk.red('❌ MCP server not found'));
        console.log(chalk.gray('Searched paths:'));
        for (const path of possiblePaths) {
          console.log(chalk.gray(`  - ${path}`));
        }
        console.log();
        console.log(chalk.cyan('Build the project first: ') + chalk.white('npm run build'));
        process.exit(1);
      }

      console.log(chalk.gray(`Config: ${configPath}`));
      console.log(chalk.gray(`Server: ${serverPath}`));
      console.log();

      // Build command
      const isTs = serverPath.endsWith('.ts');
      const command = isTs || options.dev ? 'npx' : 'node';
      const args = isTs || options.dev
        ? ['tsx', serverPath]
        : [serverPath];

      // Set environment
      const env = {
        ...process.env,
        MYCELIUM_CONFIG_PATH: configPath
      };

      if (options.background) {
        // Background mode
        const child = spawn(command, args, {
          env,
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        console.log(chalk.green(`✓ Server started in background (PID: ${child.pid})`));
        console.log(chalk.cyan('Stop with: ') + chalk.white(`kill ${child.pid}`));
      } else {
        // Foreground mode
        console.log(chalk.green('✓ Server starting...'));
        console.log(chalk.gray('Press Ctrl+C to stop'));
        console.log();

        const child = spawn(command, args, {
          env,
          stdio: 'inherit'
        });

        child.on('error', (error) => {
          console.error(chalk.red('❌ Failed to start server:'), error);
          process.exit(1);
        });

        child.on('exit', (code) => {
          if (code !== 0) {
            console.error(chalk.red(`❌ Server exited with code ${code}`));
            process.exit(code || 1);
          }
        });
      }

    } catch (error) {
      console.error(chalk.red('❌ Failed to start server:'), error);
      process.exit(1);
    }
  });

// mycelium mcp status
mcpCommand
  .command('status')
  .description('Check MCP server status')
  .action(() => {
    console.log(chalk.blue('📊 MCP Server Status'));
    console.log();
    console.log(chalk.gray('  Status checking not yet implemented.'));
    console.log(chalk.gray('  Use `ps aux | grep mycelium` to check running servers.'));
    console.log();
  });
