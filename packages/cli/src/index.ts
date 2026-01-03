#!/usr/bin/env node
// ============================================================================
// AEGIS CLI - Command-line interface for AEGIS RBAC
// ============================================================================

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { skillCommand } from './commands/skill.js';
import { policyCommand } from './commands/policy.js';
import { startCommand } from './commands/start.js';

const program = new Command();

program
  .name('aegis')
  .description('AEGIS CLI - Skill-driven RBAC for AI Agents')
  .version('1.0.0');

// Register commands
program.addCommand(initCommand);
program.addCommand(skillCommand);
program.addCommand(policyCommand);
program.addCommand(startCommand);

program.parse();
