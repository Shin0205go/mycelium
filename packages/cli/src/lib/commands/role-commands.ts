/**
 * Role Commands - /roles, /status, /skills
 */

import chalk from 'chalk';
import type { CommandContext, CommandDefinition } from './types.js';
import { interactiveRoleSelector } from '../selectors/index.js';

/**
 * Format auth source for display
 */
function formatAuthSource(source: string): string {
  switch (source) {
    case 'none':
      return 'Claude Code Auth';
    case 'user':
      return 'User auth';
    case 'ANTHROPIC_API_KEY':
      return chalk.yellow('API Key (charges apply)');
    case 'project':
      return chalk.blue('Project API Key');
    case 'org':
      return chalk.blue('Organization API Key');
    case 'temporary':
      return chalk.gray('Temporary Key');
    case 'unknown':
      return chalk.gray('Unknown');
    default:
      return source;
  }
}

/**
 * Switch role helper
 */
async function switchRole(ctx: CommandContext, roleId: string): Promise<void> {
  try {
    console.log(chalk.gray(`Switching to role: ${roleId}...`));
    const manifest = await ctx.mcp.switchRole(roleId);
    ctx.setCurrentRole(roleId);
    ctx.setManifest(manifest);

    console.log(chalk.green(`\n✓ Role: ${chalk.bold(manifest.role.name)}`));
    console.log(chalk.gray(`  ${manifest.role.description}`));
    console.log(chalk.gray(`  Tools: ${manifest.metadata.toolCount} (${ctx.toolCommands.size} as commands)`));
    console.log(chalk.gray(`  Servers: ${manifest.availableServers.join(', ')}\n`));
  } catch (error: unknown) {
    const err = error as Error;
    console.error(chalk.red(`Failed to switch role: ${err.message}`));
  }
}

/**
 * /roles command - Interactive role selection
 */
export const rolesCommand: CommandDefinition = {
  name: 'roles',
  description: 'Select and switch roles',
  async handler(ctx) {
    try {
      const result = await ctx.mcp.listRoles();
      const selectedRole = await interactiveRoleSelector(result.roles);

      if (selectedRole && selectedRole !== ctx.currentRole) {
        await switchRole(ctx, selectedRole);
        ctx.rl?.setPrompt(chalk.cyan(`[${ctx.currentRole}] `) + chalk.gray('> '));
      }
    } catch (error: unknown) {
      const err = error as Error;
      console.error(chalk.red(`Failed to list roles: ${err.message}`));
    }
  }
};

/**
 * /status command - Show current status
 */
export const statusCommand: CommandDefinition = {
  name: 'status',
  description: 'Show current status',
  async handler(ctx) {
    const authDisplay = formatAuthSource(ctx.authSource);

    try {
      // Use mycelium-router__get_context MCP tool for unified state
      const context = await ctx.mcp.getContext();

      console.log(chalk.cyan('\nCurrent Status:\n'));

      if (context.role) {
        console.log(`  Role:    ${chalk.bold(context.role.name)} (${context.role.id})`);
        console.log(chalk.gray(`           ${context.role.description}`));
      } else {
        console.log(`  Role:    ${chalk.gray('none')}`);
      }

      console.log(`  Model:   ${chalk.bold(ctx.currentModel)}`);
      console.log(`  Auth:    ${authDisplay}`);
      console.log(`  Tools:   ${context.availableTools.length}`);
      console.log(`  Servers: ${context.availableServers.join(', ') || chalk.gray('none')}`);

      // Session metadata
      if (context.metadata) {
        console.log(chalk.gray(`\n  Session: ${context.metadata.sessionId.slice(0, 8)}...`));
        console.log(chalk.gray(`  Role switches: ${context.metadata.roleSwitchCount}`));
        if (context.metadata.lastRoleSwitch) {
          const lastSwitch = new Date(context.metadata.lastRoleSwitch);
          console.log(chalk.gray(`  Last switch: ${lastSwitch.toLocaleTimeString()}`));
        }
      }

      console.log();
    } catch {
      // Fallback to cached manifest if get_context fails
      if (!ctx.manifest) {
        console.log(chalk.yellow('No role selected'));
        return;
      }

      console.log(chalk.cyan('\nCurrent Status:\n'));
      console.log(`  Role:    ${chalk.bold(ctx.manifest.role.name)} (${ctx.currentRole})`);
      console.log(`  Model:   ${chalk.bold(ctx.currentModel)}`);
      console.log(`  Auth:    ${authDisplay}`);
      console.log(`  Tools:   ${ctx.manifest.metadata.toolCount}`);
      const servers = [...new Set(ctx.manifest.availableTools.map(t => t.source))];
      console.log(`  Servers: ${servers.join(', ')}`);
      console.log();
    }
  }
};

/**
 * /skills command - List available skills for current role
 */
export const skillsCommand: CommandDefinition = {
  name: 'skills',
  description: 'List available skills',
  async handler(ctx) {
    try {
      // Use mycelium-skills__list_skills MCP tool for detailed skill info
      const result = await ctx.mcp.listSkills(ctx.currentRole);
      const skills = result.skills || [];

      if (skills.length === 0) {
        console.log(chalk.yellow(`\nNo skills for role: ${ctx.currentRole}\n`));
        return;
      }

      console.log(chalk.cyan(`\nSkills for ${chalk.bold(ctx.currentRole)} (${skills.length}):\n`));

      for (const skill of skills) {
        console.log(`  ${chalk.bold(skill.displayName)} ${chalk.gray(`(${skill.id})`)}`);
        if (skill.description) {
          console.log(chalk.gray(`    ${skill.description}`));
        }
        if (skill.allowedTools.length > 0) {
          const toolCount = skill.allowedTools.length;
          const preview = skill.allowedTools.slice(0, 3).join(', ');
          const more = toolCount > 3 ? ` +${toolCount - 3} more` : '';
          console.log(chalk.gray(`    Tools: ${preview}${more}`));
        }
        if (skill.grants?.memory && skill.grants.memory !== 'none') {
          console.log(chalk.gray(`    Memory: ${skill.grants.memory}`));
        }
        console.log();
      }
    } catch (error: unknown) {
      const err = error as Error;
      // Fallback to listRoles if skills server unavailable
      try {
        const rolesResult = await ctx.mcp.listRoles();
        const currentRoleInfo = rolesResult.roles.find(r => r.id === ctx.currentRole);
        const skillNames = currentRoleInfo?.skills || [];

        if (skillNames.length === 0) {
          console.log(chalk.yellow(`\nNo skills for role: ${ctx.currentRole}\n`));
          return;
        }

        console.log(chalk.cyan(`\nSkills for ${chalk.bold(ctx.currentRole)} (${skillNames.length}):\n`));
        for (const skill of skillNames) {
          console.log(`  • ${chalk.bold(skill)}`);
        }
        console.log();
      } catch {
        console.error(chalk.red(`Failed to list skills: ${err.message}`));
      }
    }
  }
};

// Export switch role helper for use in other modules
export { switchRole };
