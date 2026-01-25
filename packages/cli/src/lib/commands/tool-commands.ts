/**
 * Tool Commands - /tools and dynamic tool/skill command execution
 */

import chalk from 'chalk';
import type { CommandContext, CommandDefinition } from './types.js';
import type { SkillCommandInfo, ToolCommandInfo } from '../mcp-client.js';
import { interactiveToolSelector } from '../selectors/index.js';

/**
 * /tools command - Interactive tool list
 */
export const toolsCommand: CommandDefinition = {
  name: 'tools',
  description: 'List available tools',
  async handler(ctx) {
    if (!ctx.manifest) {
      console.log(chalk.yellow('No role selected'));
      return;
    }

    const tools = ctx.manifest.availableTools;
    if (tools.length === 0) {
      console.log(chalk.yellow('\nNo tools available for this role.\n'));
      return;
    }

    await interactiveToolSelector(tools);
  }
};

/**
 * Execute a dynamic skill command
 */
export async function executeSkillCommand(
  ctx: CommandContext,
  cmd: SkillCommandInfo,
  args: string[]
): Promise<void> {
  try {
    if (cmd.handlerType === 'tool') {
      // Execute via MCP tool call
      if (!cmd.toolName) {
        console.log(chalk.red(`Command /${cmd.command} has no toolName configured`));
        return;
      }

      // Build arguments from command args
      const toolArgs: Record<string, unknown> = {};
      if (cmd.arguments && args.length > 0) {
        for (let i = 0; i < cmd.arguments.length && i < args.length; i++) {
          toolArgs[cmd.arguments[i].name] = args[i];
        }
      } else if (args.length > 0) {
        // Default: pass first arg as 'name' or 'id'
        toolArgs['name'] = args[0];
      }

      console.log(chalk.gray(`\n  Executing ${cmd.toolName}...`));

      // Call tool via MCP (tool may be prefixed with server name)
      const toolName = cmd.toolName.includes('__')
        ? cmd.toolName
        : `mycelium-skills__${cmd.toolName}`;

      const result = await ctx.mcp.callTool(toolName, toolArgs) as {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
      };

      if (result?.isError) {
        console.log(chalk.red(`  Error: ${result.content?.[0]?.text || 'Unknown error'}\n`));
      } else {
        const text = result?.content?.[0]?.text;
        if (text) {
          try {
            const json = JSON.parse(text);
            console.log(chalk.green(`\n  ✓ Success`));
            console.log(chalk.gray(`  ${JSON.stringify(json, null, 2).split('\n').join('\n  ')}\n`));
          } catch {
            console.log(chalk.green(`\n  ✓ ${text}\n`));
          }
        } else {
          console.log(chalk.green(`\n  ✓ Command executed\n`));
        }
      }
    } else if (cmd.handlerType === 'script') {
      // Execute via run_script
      if (!cmd.scriptPath) {
        console.log(chalk.red(`Command /${cmd.command} has no scriptPath configured`));
        return;
      }

      console.log(chalk.gray(`\n  Running script ${cmd.scriptPath}...`));

      const result = await ctx.mcp.callTool('mycelium-skills__run_script', {
        skill: cmd.skillId,
        path: cmd.scriptPath,
        args: args,
      }) as {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
      };

      if (result?.isError) {
        console.log(chalk.red(`  Error: ${result.content?.[0]?.text || 'Unknown error'}\n`));
      } else {
        const text = result?.content?.[0]?.text;
        if (text) {
          try {
            const json = JSON.parse(text);
            if (json.success) {
              console.log(chalk.green(`\n  ✓ Script completed`));
              if (json.stdout) {
                console.log(json.stdout);
              }
            } else {
              console.log(chalk.red(`\n  ✗ Script failed (exit code: ${json.exitCode})`));
              if (json.stderr) {
                console.log(chalk.red(json.stderr));
              }
            }
          } catch {
            console.log(text);
          }
        }
        console.log();
      }
    } else {
      console.log(chalk.yellow(`Unknown handler type: ${cmd.handlerType}`));
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.log(chalk.red(`Failed to execute /${cmd.command}: ${err.message}\n`));
  }
}

/**
 * Execute a tool command
 */
export async function executeToolCommand(
  ctx: CommandContext,
  cmd: ToolCommandInfo,
  args: string[]
): Promise<void> {
  try {
    console.log(chalk.gray(`\n  Executing ${cmd.fullToolName}...`));

    // Parse arguments - for now, join as a single input or use key=value pairs
    const toolArgs: Record<string, unknown> = {};
    for (const arg of args) {
      if (arg.includes('=')) {
        const [key, ...valueParts] = arg.split('=');
        toolArgs[key] = valueParts.join('=');
      } else if (args.length === 1) {
        // Single argument without key - try common parameter names
        toolArgs['path'] = arg;
        toolArgs['id'] = arg;
        toolArgs['name'] = arg;
      }
    }

    const result = await ctx.mcp.callTool(cmd.fullToolName, toolArgs) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };

    if (result?.isError) {
      console.log(chalk.red(`  Error: ${result.content?.[0]?.text || 'Unknown error'}\n`));
    } else {
      const text = result?.content?.[0]?.text;
      if (text) {
        try {
          const json = JSON.parse(text);
          console.log(chalk.green(`\n  ✓ Success`));
          console.log(chalk.gray(`  ${JSON.stringify(json, null, 2).split('\n').join('\n  ')}\n`));
        } catch {
          console.log(chalk.green(`\n  ✓ ${text}\n`));
        }
      } else {
        console.log(chalk.green(`\n  ✓ Command executed\n`));
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.log(chalk.red(`  Failed to execute /${cmd.command}: ${err.message}\n`));
  }
}
