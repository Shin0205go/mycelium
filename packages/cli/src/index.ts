#!/usr/bin/env node
/**
 * MYCELIUM CLI - Skill-driven RBAC for AI Agents
 *
 * Usage:
 *   mycelium              - Start workflow agent (default)
 *   mycelium adhoc        - Adhoc agent (full tool access)
 *   mycelium init         - Initialize a new project
 *   mycelium skill        - Manage skills
 *   mycelium mcp start    - Start MCP server
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { skillCommand } from './commands/skill.js';
import { mcpCommand } from './commands/mcp.js';
import { adhocCommand } from './commands/adhoc.js';
import { WorkflowAgent } from './agents/workflow-agent.js';

const program = new Command();

program
  .name('mycelium')
  .description('MYCELIUM CLI - Skill-driven RBAC for AI Agents')
  .version('1.0.0')
  .option('-m, --model <model>', 'Model to use')
  .option('-c, --config <path>', 'Path to config.json');

// Register subcommands
program.addCommand(initCommand);
program.addCommand(skillCommand);
program.addCommand(mcpCommand);
program.addCommand(adhocCommand);

// Default action: run workflow agent
program.action(async () => {
  const opts = program.opts();
  const agent = new WorkflowAgent({
    model: opts.model,
  });
  await agent.run();
});

// Parse and execute
program.parseAsync().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
