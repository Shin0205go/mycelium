/**
 * Model Commands - /model and /help
 */

import chalk from 'chalk';
import type { CommandContext, CommandDefinition } from './types.js';
import type { SkillCommandInfo, ToolCommandInfo } from '../mcp-client.js';

const AVAILABLE_MODELS = [
  'claude-3-5-haiku-20241022',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-20250514'
];

const MODEL_INFO: Record<string, string> = {
  'claude-3-5-haiku-20241022': '💨 Fast & cheap',
  'claude-sonnet-4-5-20250929': '⚖️  Balanced',
  'claude-opus-4-20250514': '🧠 Most capable'
};

/**
 * Show available models
 */
function showModels(currentModel: string): void {
  console.log(chalk.cyan('\nAvailable Models:\n'));
  console.log(chalk.gray('  Usage: /model <model_name>\n'));
  AVAILABLE_MODELS.forEach(m => {
    const current = m === currentModel ? chalk.green(' ← current') : '';
    const info = MODEL_INFO[m] || '';
    console.log(`  • ${chalk.bold(m)} ${chalk.gray(info)}${current}`);
  });
  console.log();
}

/**
 * /model command - Change or show models
 */
export const modelCommand: CommandDefinition = {
  name: 'model',
  description: 'Change model',
  usage: '/model <name>',
  handler: async (ctx, args) => {
    if (args[0]) {
      if (AVAILABLE_MODELS.includes(args[0]) || args[0].startsWith('claude-')) {
        ctx.setCurrentModel(args[0]);
        console.log(chalk.green(`✓ Model changed to: ${chalk.bold(args[0])}`));
      } else {
        showModels(ctx.currentModel);
      }
    } else {
      showModels(ctx.currentModel);
    }
  }
};

/**
 * /help command - Show all available commands
 */
export const helpCommand: CommandDefinition = {
  name: 'help',
  description: 'Show this help',
  handler: async (ctx) => {
    console.log(chalk.cyan('\nCommands:\n'));
    console.log(chalk.gray('  Built-in:'));
    console.log('  ' + chalk.bold('/roles') + '           Select and switch roles');
    console.log('  ' + chalk.bold('/skills') + '          List available skills');
    console.log('  ' + chalk.bold('/tools') + '           List available tools');
    console.log('  ' + chalk.bold('/model <name>') + '    Change model');
    console.log('  ' + chalk.bold('/status') + '          Show current status');
    console.log('  ' + chalk.bold('/help') + '            Show this help');
    console.log('  ' + chalk.bold('/quit') + '            Exit');

    // Show dynamic skill commands
    if (ctx.skillCommands.size > 0) {
      // Group commands by skill
      const bySkill = new Map<string, SkillCommandInfo[]>();
      for (const cmd of ctx.skillCommands.values()) {
        const existing = bySkill.get(cmd.skillName) || [];
        existing.push(cmd);
        bySkill.set(cmd.skillName, existing);
      }

      console.log();
      console.log(chalk.gray('  Skill Commands:'));
      for (const [skillName, cmds] of bySkill) {
        for (const cmd of cmds) {
          const usage = cmd.usage || `/${cmd.command}`;
          const paddedUsage = usage.padEnd(16);
          console.log('  ' + chalk.bold(paddedUsage) + ' ' + cmd.description + chalk.gray(` [${skillName}]`));
        }
      }
    }

    // Show tool commands (auto-generated from available tools)
    if (ctx.toolCommands.size > 0) {
      // Group by server
      const byServer = new Map<string, ToolCommandInfo[]>();
      for (const cmd of ctx.toolCommands.values()) {
        const list = byServer.get(cmd.source) || [];
        list.push(cmd);
        byServer.set(cmd.source, list);
      }

      console.log();
      console.log(chalk.gray('  Tool Commands:'));
      for (const [server, cmds] of byServer) {
        console.log(chalk.gray(`    [${server}]`));
        const displayCmds = cmds.slice(0, 5);  // Show max 5 per server
        for (const cmd of displayCmds) {
          const desc = cmd.description?.slice(0, 40) || '';
          console.log(`      /${chalk.bold(cmd.command.padEnd(25))} ${chalk.gray(desc)}`);
        }
        if (cmds.length > 5) {
          console.log(chalk.gray(`      ... and ${cmds.length - 5} more`));
        }
      }
    }

    console.log(chalk.gray('\n  Type any message to chat with Claude.\n'));
  }
};

// Export model list for completers
export { AVAILABLE_MODELS };
