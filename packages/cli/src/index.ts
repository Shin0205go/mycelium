#!/usr/bin/env node
/**
 * MYCELIUM CLI - Session-based Dynamic Skill Management
 *
 * Usage:
 *   mycelium              - Start chat agent with dynamic skills (default)
 *   mycelium server       - Start as standalone MCP server (for Claude Desktop/Cursor)
 *   mycelium adhoc        - Adhoc agent (full tool access)
 *   mycelium init         - Initialize a new project
 *   mycelium skill        - Manage skills
 *   mycelium mcp start    - Start MCP server (legacy)
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { skillCommand } from './commands/skill.js';
import { mcpCommand } from './commands/mcp.js';
import { adhocCommand } from './commands/adhoc.js';
import { serverCommand } from './commands/server.js';
import { policyCommand } from './commands/policy.js';
import { workflowCommand } from './commands/workflow.js';
import { ChatAgent } from './agents/chat-agent.js';

const program = new Command();

program
  .name('mycelium')
  .description('MYCELIUM CLI - Session-based Dynamic Skill Management')
  .version('1.0.0')
  .option('-m, --model <model>', 'Model to use')
  .option('-r, --role <role>', 'User role (determines skill upper limit)', 'developer')
  .option('-c, --config <path>', 'Path to config.json');

// Register subcommands
program.addCommand(serverCommand);  // MCP server standalone mode
program.addCommand(initCommand);
program.addCommand(skillCommand);
program.addCommand(mcpCommand);
program.addCommand(adhocCommand);
program.addCommand(policyCommand);
program.addCommand(workflowCommand);

// Default action: run chat agent with dynamic skill management
program.action(async () => {
  const opts = program.opts();
  const agent = new ChatAgent({
    model: opts.model,
    userRole: opts.role,
  });
  await agent.run();
});

// Parse and execute
program.parseAsync().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
