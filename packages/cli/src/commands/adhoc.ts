/**
 * Adhoc command - Full tool access for investigation and fixes
 *
 * Usage:
 *   mycelium adhoc                      - Start interactive adhoc mode
 *   mycelium adhoc "investigate"        - Execute a single task
 *   mycelium adhoc --context <file>     - Load context from workflow failure
 *   mycelium adhoc --auto-approve "task" - Auto-approve dangerous operations
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { AdhocAgent } from '../agents/adhoc-agent.js';

export const adhocCommand = new Command('adhoc')
  .description('Full tool access for investigation and fixes')
  .argument('[task]', 'Task to execute (optional, starts interactive mode if not provided)')
  .option('-m, --model <model>', 'Model to use', 'claude-sonnet-4-5-20250929')
  .option('-r, --role <role>', 'Role to use (default: adhoc)')
  .option('-c, --context <path>', 'Path to workflow context file (from failed workflow)')
  .option('--api-key', 'Use ANTHROPIC_API_KEY for authentication')
  .option('--auto-approve', 'Auto-approve dangerous tool operations (non-interactive mode only)')
  .option('--no-approval', 'Disable approval checks entirely')
  .action(async (task, options) => {
    const agent = new AdhocAgent({
      model: options.model,
      role: options.role,  // Pass custom role
      contextPath: options.context,
      useApiKey: options.apiKey,
      autoApprove: options.autoApprove,
      requireApproval: options.approval !== false,
    });

    if (task) {
      // Single task execution
      console.log(chalk.magenta('Executing adhoc task...'));
      console.log();

      const result = await agent.execute(task);

      if (result.result) {
        console.log(result.result);
      }

      // Show blocked tools summary
      if (result.blockedTools && result.blockedTools.length > 0) {
        console.log();
        console.log(chalk.yellow('Dangerous tools were blocked:'));
        for (const tool of result.blockedTools) {
          console.log(chalk.gray(`  - ${tool}`));
        }
        console.log();
        console.log(chalk.cyan('To allow these operations, use one of:'));
        console.log(chalk.dim('  --auto-approve  Auto-approve dangerous operations'));
        console.log(chalk.dim('  --no-approval   Disable all approval checks'));
      }

      process.exit(result.success ? 0 : 1);
    } else {
      // Interactive mode
      await agent.run();
    }
  });
