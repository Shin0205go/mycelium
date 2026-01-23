#!/usr/bin/env node
/**
 * AEGIS CLI - Skill-driven RBAC for AI Agents
 *
 * Usage:
 *   aegis                 - Start interactive chat mode
 *   aegis workflow        - Workflow agent (skill scripts only)
 *   aegis adhoc           - Adhoc agent (full tool access)
 *   aegis init            - Initialize a new project
 *   aegis skill add/list  - Manage skills
 *   aegis policy check    - Verify policies
 *   aegis mcp start       - Start MCP server
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { skillCommand } from './commands/skill.js';
import { policyCommand } from './commands/policy.js';
import { mcpCommand } from './commands/mcp.js';
import { workflowCommand } from './commands/workflow.js';
import { adhocCommand } from './commands/adhoc.js';
import { InteractiveCLI } from './lib/interactive-cli.js';

const program = new Command();

program
  .name('aegis')
  .description('AEGIS CLI - Skill-driven RBAC for AI Agents')
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
