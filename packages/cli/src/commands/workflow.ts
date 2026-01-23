/**
 * Workflow command - Run skill-based workflows
 *
 * Usage:
 *   aegis workflow              - Start interactive workflow mode
 *   aegis workflow "task"       - Execute a single workflow task
 *   aegis workflow --list       - List available skills
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { WorkflowAgent } from '../agents/workflow-agent.js';

export const workflowCommand = new Command('workflow')
  .description('Run skill-based workflows (limited to skill scripts only)')
  .argument('[task]', 'Task to execute (optional, starts interactive mode if not provided)')
  .option('-m, --model <model>', 'Model to use', 'claude-sonnet-4-5-20250929')
  .option('--skills-dir <path>', 'Path to skills directory')
  .option('--on-failure <mode>', 'Failure handling: prompt, auto, or exit', 'prompt')
  .option('--api-key', 'Use ANTHROPIC_API_KEY for authentication')
  .action(async (task, options) => {
    const agent = new WorkflowAgent({
      model: options.model,
      skillsDir: options.skillsDir,
      useApiKey: options.apiKey,
      onFailure: options.onFailure as 'prompt' | 'auto' | 'exit',
    });

    if (task) {
      // Single task execution
      console.log(chalk.cyan('Executing workflow task...'));
      console.log();

      const result = await agent.execute(task);

      if (result.result) {
        console.log(result.result);
      }

      if (!result.success && result.contextPath) {
        console.log();
        console.log(chalk.yellow('Task failed. Context saved.'));
        console.log(chalk.cyan(`To investigate: aegis adhoc --context ${result.contextPath}`));
      }

      process.exit(result.success ? 0 : 1);
    } else {
      // Interactive mode
      await agent.run();
    }
  });
