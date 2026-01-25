// ============================================================================
// mycelium mcp - MCP server management commands
// ============================================================================

import { Command } from 'commander';
import { spawn } from 'child_process';
import { access, mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

// Runtime directory for storing PID files and other state
const MYCELIUM_DIR = '.mycelium';
const PID_FILE = 'mcp-server.pid';

interface PidInfo {
  pid: number;
  startedAt: string;
  serverPath: string;
  configPath: string;
}

/**
 * Get the path to the PID file
 */
function getPidFilePath(): string {
  return join(process.cwd(), MYCELIUM_DIR, PID_FILE);
}

/**
 * Ensure the .mycelium directory exists
 */
async function ensureMyceliumDir(): Promise<void> {
  const dir = join(process.cwd(), MYCELIUM_DIR);
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory already exists
  }
}

/**
 * Save PID info to file
 */
async function savePidInfo(info: PidInfo): Promise<void> {
  await ensureMyceliumDir();
  await writeFile(getPidFilePath(), JSON.stringify(info, null, 2));
}

/**
 * Read PID info from file
 */
async function readPidInfo(): Promise<PidInfo | null> {
  try {
    const content = await readFile(getPidFilePath(), 'utf-8');
    return JSON.parse(content) as PidInfo;
  } catch {
    return null;
  }
}

/**
 * Remove PID file
 */
async function removePidFile(): Promise<void> {
  try {
    await unlink(getPidFilePath());
  } catch {
    // File doesn't exist
  }
}

/**
 * Check if a process with given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't actually send a signal but checks if the process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format uptime from start date to now
 */
function formatUptime(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

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

        // Save PID info for status command
        if (child.pid) {
          await savePidInfo({
            pid: child.pid,
            startedAt: new Date().toISOString(),
            serverPath,
            configPath
          });
        }

        console.log(chalk.green(`✓ Server started in background (PID: ${child.pid})`));
        console.log(chalk.cyan('Check status: ') + chalk.white('mycelium mcp status'));
        console.log(chalk.cyan('Stop server: ') + chalk.white('mycelium mcp stop'));
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
  .action(async () => {
    console.log(chalk.blue('📊 MCP Server Status'));
    console.log();

    const pidInfo = await readPidInfo();

    if (!pidInfo) {
      console.log(chalk.yellow('  No server info found.'));
      console.log(chalk.gray('  The server may not have been started in background mode,'));
      console.log(chalk.gray('  or the PID file was removed.'));
      console.log();
      console.log(chalk.cyan('  Start server: ') + chalk.white('mycelium mcp start --background'));
      console.log();
      return;
    }

    const isRunning = isProcessRunning(pidInfo.pid);

    if (isRunning) {
      console.log(chalk.green('  ● Server is running'));
      console.log();
      console.log(chalk.white('  PID:      ') + chalk.cyan(pidInfo.pid.toString()));
      console.log(chalk.white('  Uptime:   ') + chalk.cyan(formatUptime(pidInfo.startedAt)));
      console.log(chalk.white('  Started:  ') + chalk.gray(new Date(pidInfo.startedAt).toLocaleString()));
      console.log(chalk.white('  Server:   ') + chalk.gray(pidInfo.serverPath));
      console.log(chalk.white('  Config:   ') + chalk.gray(pidInfo.configPath));
      console.log();
      console.log(chalk.cyan('  Stop with: ') + chalk.white('mycelium mcp stop'));
    } else {
      console.log(chalk.red('  ○ Server is not running'));
      console.log();
      console.log(chalk.gray(`  Last known PID: ${pidInfo.pid}`));
      console.log(chalk.gray(`  Last started:   ${new Date(pidInfo.startedAt).toLocaleString()}`));
      console.log();

      // Clean up stale PID file
      await removePidFile();
      console.log(chalk.gray('  (Stale PID file removed)'));
      console.log();
      console.log(chalk.cyan('  Start server: ') + chalk.white('mycelium mcp start --background'));
    }
    console.log();
  });

// mycelium mcp stop
mcpCommand
  .command('stop')
  .description('Stop the MCP server running in background')
  .option('-f, --force', 'Force kill (SIGKILL instead of SIGTERM)')
  .action(async (options: { force?: boolean }) => {
    console.log(chalk.blue('🛑 Stopping MCP Server...'));
    console.log();

    const pidInfo = await readPidInfo();

    if (!pidInfo) {
      console.log(chalk.yellow('  No server info found.'));
      console.log(chalk.gray('  No background server is being tracked.'));
      console.log();
      return;
    }

    const isRunning = isProcessRunning(pidInfo.pid);

    if (!isRunning) {
      console.log(chalk.yellow('  Server is not running.'));
      console.log(chalk.gray(`  (PID ${pidInfo.pid} is not active)`));
      console.log();

      // Clean up stale PID file
      await removePidFile();
      console.log(chalk.gray('  Stale PID file removed.'));
      console.log();
      return;
    }

    try {
      const signal = options.force ? 'SIGKILL' : 'SIGTERM';
      process.kill(pidInfo.pid, signal);

      console.log(chalk.green(`  ✓ Sent ${signal} to process ${pidInfo.pid}`));

      // Wait briefly and check if it stopped
      await new Promise(resolve => setTimeout(resolve, 500));

      if (isProcessRunning(pidInfo.pid)) {
        console.log(chalk.yellow('  Process still running, waiting...'));
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (isProcessRunning(pidInfo.pid)) {
          console.log(chalk.yellow('  Process did not stop gracefully.'));
          console.log(chalk.cyan('  Use: ') + chalk.white('mycelium mcp stop --force'));
        } else {
          console.log(chalk.green('  ✓ Server stopped'));
          await removePidFile();
        }
      } else {
        console.log(chalk.green('  ✓ Server stopped'));
        await removePidFile();
      }
    } catch (error) {
      console.error(chalk.red('  ✗ Failed to stop server:'), error);
    }
    console.log();
  });
