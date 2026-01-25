/**
 * Workflow command - Run skill-based workflows
 *
 * Usage:
 *   mycelium workflow              - Start interactive workflow mode
 *   mycelium workflow "task"       - Execute a single workflow task
 *   mycelium workflow --list       - List available skills
 */

import { Command } from 'commander';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import chalk from 'chalk';
import { WorkflowAgent } from '../agents/workflow-agent.js';

/**
 * Detect skills directory (monorepo-aware)
 */
function getDefaultSkillsDir(): string {
  let cwd = process.cwd();

  // Walk up the directory tree to find monorepo root
  while (cwd !== '/') {
    const monorepoPath = join(cwd, 'packages/skills/skills');
    if (existsSync(monorepoPath)) {
      return monorepoPath;
    }
    const parent = join(cwd, '..');
    if (parent === cwd) break; // Reached filesystem root
    cwd = parent;
  }

  return join(process.cwd(), 'skills');
}

/**
 * List available skills from the skills directory
 */
async function listAvailableSkills(skillsDir?: string): Promise<void> {
  const dir = skillsDir || getDefaultSkillsDir();

  console.log(chalk.cyan('📋 Available Skills'));
  console.log();

  if (!existsSync(dir)) {
    console.log(chalk.yellow(`Skills directory not found: ${dir}`));
    console.log();
    console.log(chalk.gray('Create skills with: mycelium skill add <name>'));
    return;
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    if (dirs.length === 0) {
      console.log(chalk.yellow('No skills found.'));
      console.log();
      console.log(chalk.gray('Create skills with: mycelium skill add <name>'));
      return;
    }

    const skills: Array<{
      id: string;
      displayName?: string;
      description?: string;
      roles: string[];
    }> = [];

    for (const entry of dirs) {
      // Try SKILL.yaml first (monorepo), then SKILL.md (user projects)
      const yamlFile = join(dir, entry.name, 'SKILL.yaml');
      const mdFile = join(dir, entry.name, 'SKILL.md');

      try {
        let frontmatter;

        if (existsSync(yamlFile)) {
          const content = await readFile(yamlFile, 'utf-8');
          frontmatter = parseYaml(content);
        } else if (existsSync(mdFile)) {
          const content = await readFile(mdFile, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            frontmatter = parseYaml(frontmatterMatch[1]);
          }
        }

        if (frontmatter) {
          skills.push({
            id: frontmatter.id || entry.name,
            displayName: frontmatter.displayName || frontmatter.name,
            description: frontmatter.description,
            roles: frontmatter.allowedRoles || [],
          });
        }
      } catch {
        // Skip invalid skills
      }
    }

    // Sort by ID
    skills.sort((a, b) => a.id.localeCompare(b.id));

    for (const skill of skills) {
      console.log(`  ${chalk.bold(skill.displayName || skill.id)}`);
      if (skill.description) {
        // Truncate long descriptions
        const desc = skill.description.length > 80
          ? skill.description.substring(0, 77) + '...'
          : skill.description;
        console.log(chalk.gray(`    ${desc}`));
      }
      if (skill.roles.length > 0) {
        console.log(chalk.dim(`    Roles: ${skill.roles.join(', ')}`));
      }
      console.log();
    }

    console.log(chalk.gray(`Total: ${skills.length} skill(s)`));
    console.log();

  } catch (error) {
    console.error(chalk.red('Failed to list skills:'), error);
    process.exit(1);
  }
}

export const workflowCommand = new Command('workflow')
  .description('Run skill-based workflows (limited to skill scripts only)')
  .argument('[task]', 'Task to execute (optional, starts interactive mode if not provided)')
  .option('-l, --list', 'List available skills')
  .option('-m, --model <model>', 'Model to use', 'claude-sonnet-4-5-20250929')
  .option('--skills-dir <path>', 'Path to skills directory')
  .option('--on-failure <mode>', 'Failure handling: prompt, auto, or exit', 'prompt')
  .option('--api-key', 'Use ANTHROPIC_API_KEY for authentication')
  .action(async (task, options) => {
    // Handle --list option
    if (options.list) {
      await listAvailableSkills(options.skillsDir);
      return;
    }

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
        console.log(chalk.cyan(`To investigate: mycelium adhoc --context ${result.contextPath}`));
      }

      process.exit(result.success ? 0 : 1);
    } else {
      // Interactive mode
      await agent.run();
    }
  });
