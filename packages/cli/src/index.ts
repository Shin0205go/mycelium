#!/usr/bin/env node
/**
 * MYCELIUM CLI - Skill-driven RBAC for AI Agents
 *
 * Usage:
 *   mycelium              - Start interactive chat mode
 *   mycelium workflow        - Workflow agent (skill scripts only)
 *   mycelium adhoc           - Adhoc agent (full tool access)
 *   mycelium init            - Initialize a new project
 *   mycelium skill add/list  - Manage skills
 *   mycelium policy check    - Verify policies
 *   mycelium mcp start       - Start MCP server
 *   mycelium config          - Manage configuration
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { skillCommand } from './commands/skill.js';
import { policyCommand } from './commands/policy.js';
import { mcpCommand } from './commands/mcp.js';
import { workflowCommand } from './commands/workflow.js';
import { adhocCommand } from './commands/adhoc.js';
import { configCommand } from './commands/config.js';
import { InteractiveCLI } from './lib/interactive-cli.js';

const program = new Command();

program
  .name('mycelium')
  .description('MYCELIUM CLI - Skill-driven RBAC for AI Agents')
  .version('1.0.0')
  .option('-r, --role <role>', 'Initial role for interactive mode')
  .option('-m, --model <model>', 'Model to use')
  .option('-c, --config <path>', 'Path to config.json');

// Register subcommands
program.addCommand(initCommand);
program.addCommand(skillCommand);
program.addCommand(policyCommand);
program.addCommand(mcpCommand);
program.addCommand(workflowCommand);
program.addCommand(adhocCommand);
program.addCommand(configCommand);

// Default action: run interactive mode when no subcommand is provided
program.action(async () => {
  const opts = program.opts();
  const cli = new InteractiveCLI({
    role: opts.role,
    model: opts.model,
    configPath: opts.config
  });
  await cli.run();
});

// Parse and execute
program.parseAsync().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
