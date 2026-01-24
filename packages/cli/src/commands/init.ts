// ============================================================================
// mycelium init - Initialize a new mycelium project
// ============================================================================

import { Command } from 'commander';
import { mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

const DEFAULT_CONFIG = {
  mcpServers: {
    'mycelium-skills': {
      command: 'node',
      args: ['node_modules/@mycelium/skills/dist/index.js', './skills'],
      env: {}
    }
  }
};

const GUEST_SKILL = `---
id: guest-access
displayName: Guest Access
description: Minimal read-only access for guests
allowedRoles:
  - guest
allowedTools:
  - filesystem__read_file
  - filesystem__list_directory
grants:
  memory: none
---

# Guest Access

This skill provides minimal read-only access for guest users.

## Capabilities
- Read files
- List directories

## Restrictions
- No write access
- No memory access
`;

const DEVELOPER_SKILL = `---
id: developer-tools
displayName: Developer Tools
description: Standard development tools for developers
allowedRoles:
  - developer
  - senior
  - admin
allowedTools:
  - filesystem__read_file
  - filesystem__write_file
  - filesystem__list_directory
  - git__*
grants:
  memory: isolated
---

# Developer Tools

This skill provides standard development tools including file system and git access.

## Capabilities
- Read and write files
- Git operations
- Isolated memory access

## Use Cases
- Code development
- Version control
`;

const ADMIN_SKILL = `---
id: admin-access
displayName: Admin Access
description: Full administrative access
allowedRoles:
  - admin
allowedTools:
  - "*"
grants:
  memory: all
identity:
  skillMatching:
    - role: admin
      requiredSkills:
        - admin_access
        - system_management
      priority: 100
      description: Full admin requires both skills
  trustedPrefixes:
    - claude-
    - mycelium-
---

# Admin Access

This skill provides full administrative access with all capabilities.

## Capabilities
- All tools available
- Full memory access (read all roles)
- A2A identity matching for admin agents

## Security
- Requires both admin_access AND system_management skills
- Only trusted prefixes (claude-, mycelium-) are marked as trusted
`;

export const initCommand = new Command('init')
  .description('Initialize a new mycelium project')
  .argument('[directory]', 'Project directory', '.')
  .option('--minimal', 'Create minimal setup without example skills')
  .action(async (directory: string, options: { minimal?: boolean }) => {
    const projectDir = join(process.cwd(), directory);
    const skillsDir = join(projectDir, 'skills');
    const configPath = join(projectDir, 'config.json');

    console.log(chalk.blue('🛡️  Initializing mycelium project...'));
    console.log();

    try {
      // Check if config already exists
      try {
        await access(configPath);
        console.log(chalk.yellow('⚠️  config.json already exists, skipping...'));
      } catch {
        // Create config.json
        await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
        console.log(chalk.green('✓ Created config.json'));
      }

      // Create skills directory
      try {
        await access(skillsDir);
        console.log(chalk.yellow('⚠️  skills/ directory already exists'));
      } catch {
        await mkdir(skillsDir, { recursive: true });
        console.log(chalk.green('✓ Created skills/ directory'));
      }

      // Create example skills (unless minimal)
      if (!options.minimal) {
        const skills = [
          { name: 'guest-access', content: GUEST_SKILL },
          { name: 'developer-tools', content: DEVELOPER_SKILL },
          { name: 'admin-access', content: ADMIN_SKILL }
        ];

        for (const skill of skills) {
          const skillDir = join(skillsDir, skill.name);
          const skillFile = join(skillDir, 'SKILL.md');

          try {
            await access(skillDir);
            console.log(chalk.yellow(`⚠️  skills/${skill.name}/ already exists, skipping...`));
          } catch {
            await mkdir(skillDir, { recursive: true });
            await writeFile(skillFile, skill.content);
            console.log(chalk.green(`✓ Created skills/${skill.name}/SKILL.md`));
          }
        }
      }

      console.log();
      console.log(chalk.green('✅ mycelium project initialized!'));
      console.log();
      console.log(chalk.cyan('Next steps:'));
      console.log(chalk.white('  1. Add more skills:     ') + chalk.yellow('mycelium skill add <name>'));
      console.log(chalk.white('  2. Check policies:      ') + chalk.yellow('mycelium policy check --role developer'));
      console.log(chalk.white('  3. Start the server:    ') + chalk.yellow('mycelium start'));
      console.log();

    } catch (error) {
      console.error(chalk.red('❌ Failed to initialize project:'), error);
      process.exit(1);
    }
  });
