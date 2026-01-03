#!/usr/bin/env node
/**
 * AEGIS CLI - Skill-driven RBAC for AI Agents
 *
 * Usage:
 *   aegis                 - Start interactive chat mode
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

// Check if a subcommand was provided
const subcommands = ['init', 'skill', 'policy', 'mcp', 'help'];
const args = process.argv.slice(2);
const firstArg = args[0];
const hasSubcommand = firstArg && subcommands.includes(firstArg);
const isHelpOrVersion = args.includes('-h') || args.includes('--help') ||
                        args.includes('-V') || args.includes('--version');

if (hasSubcommand || isHelpOrVersion) {
  // Parse and let commander handle it
  program.parse();
} else {
  // Parse options for interactive mode
  program.parse();
  const opts = program.opts();

  // Run interactive mode
  const cli = new InteractiveCLI({
    role: opts.role,
    model: opts.model,
    configPath: opts.config
  });
  cli.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
