#!/usr/bin/env node
/**
 * MYCELIUM CLI - MCP Server/Client Tools
 *
 * Usage:
 *   mycelium server       - Start as standalone MCP server (for Claude Desktop/Cursor)
 *   mycelium client       - Connect to running MCP server (thin client)
 */

import { Command } from 'commander';
import { serverCommand } from './commands/server.js';
import { clientCommand } from './commands/client.js';

const program = new Command();

program
  .name('mycelium')
  .description('MYCELIUM CLI - MCP Server/Client Tools')
  .version('1.0.0');

// Register subcommands
program.addCommand(serverCommand);  // MCP server standalone mode
program.addCommand(clientCommand);  // MCP client thin mode

// Default action: show help
program.action(() => {
  program.help();
});

// Parse and execute
program.parseAsync().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
