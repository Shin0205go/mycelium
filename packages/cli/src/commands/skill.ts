// ============================================================================
// aegis skill - Manage skills
// ============================================================================

import { Command } from 'commander';
import { mkdir, writeFile, readdir, readFile, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { parse as parseYaml } from 'yaml';

// Skill templates
const SKILL_TEMPLATES: Record<string, string> = {
  'basic': `---
id: {{name}}
displayName: {{displayName}}
description: Basic skill template
allowedRoles:
  - developer
allowedTools:
  - filesystem__read_file
grants:
  memory: none
---

# {{displayName}}

Description of what this skill provides.

## Capabilities
- List capabilities here

## Use Cases
- Describe use cases
`,

  'browser-limited': `---
id: browser-limited
displayName: Limited Browser Access
description: Read-only browser access for web research
allowedRoles:
  - researcher
  - analyst
allowedTools:
  - browser__navigate
  - browser__screenshot
  - browser__get_text
grants:
  memory: isolated
---

# Limited Browser Access

This skill provides read-only browser access for web research.

## Capabilities
- Navigate to URLs
- Take screenshots
- Extract text content

## Restrictions
- No form submission
- No JavaScript execution
- No cookie manipulation
`,

  'code-reviewer': `---
id: code-reviewer
displayName: Code Reviewer
description: Code review and analysis tools
allowedRoles:
  - reviewer
  - senior
  - lead
allowedTools:
  - filesystem__read_file
  - filesystem__list_directory
  - git__diff
  - git__log
  - git__blame
grants:
  memory: team
  memoryTeamRoles:
    - developer
    - frontend
    - backend
identity:
  skillMatching:
    - role: reviewer
      anySkills:
        - code_review
        - static_analysis
      priority: 50
---

# Code Reviewer

This skill provides tools for code review and analysis.

## Capabilities
- Read source files
- View git history and diffs
- Access team members' memories

## Use Cases
- Pull request reviews
- Code audits
- Knowledge sharing
`,

  'data-analyst': `---
id: data-analyst
displayName: Data Analyst
description: Read-only database access for analytics
allowedRoles:
  - analyst
  - data-scientist
allowedTools:
  - database__query
  - database__list_tables
  - database__describe_table
grants:
  memory: isolated
identity:
  skillMatching:
    - role: analyst
      anySkills:
        - sql
        - data_analysis
        - statistics
      minSkillMatch: 1
      priority: 40
---

# Data Analyst

This skill provides read-only database access for data analysis.

## Capabilities
- Execute SELECT queries
- List and describe tables
- Analyze data patterns

## Restrictions
- No INSERT/UPDATE/DELETE
- No schema modifications
- Query timeout: 30 seconds
`,

  'flight-booking': `---
id: flight-booking
displayName: Flight Booking
description: Flight search and booking capabilities
allowedRoles:
  - travel-agent
  - assistant
allowedTools:
  - browser__navigate
  - browser__fill_form
  - browser__click
  - calendar__create_event
  - calendar__read_events
grants:
  memory: isolated
identity:
  skillMatching:
    - role: travel-agent
      requiredSkills:
        - travel_booking
      context:
        allowedDays: [1, 2, 3, 4, 5]  # Weekdays only
        allowedTime: "09:00-18:00"
        timezone: "America/New_York"
      priority: 60
---

# Flight Booking

This skill enables flight search and booking during business hours.

## Capabilities
- Search flights on major airline websites
- Fill booking forms
- Create calendar events for trips

## Security
- Only available on weekdays 9 AM - 6 PM ET
- Requires travel_booking skill
`,

  'personal-assistant': `---
id: personal-assistant
displayName: Personal Assistant
description: Calendar and email access for personal assistance
allowedRoles:
  - assistant
  - secretary
allowedTools:
  - calendar__read_events
  - calendar__create_event
  - calendar__update_event
  - email__read
  - email__list
grants:
  memory: isolated
---

# Personal Assistant

This skill provides calendar and email access for personal assistance tasks.

## Capabilities
- Read and manage calendar
- Read emails (no sending)

## Use Cases
- Schedule management
- Email triage
- Meeting coordination
`
};

export const skillCommand = new Command('skill')
  .description('Manage skills');

// aegis skill add <name>
skillCommand
  .command('add')
  .description('Add a new skill from template')
  .argument('<name>', 'Skill name')
  .option('-t, --template <template>', 'Template to use', 'basic')
  .option('-d, --directory <dir>', 'Skills directory', './skills')
  .action(async (name: string, options: { template: string; directory: string }) => {
    const skillsDir = join(process.cwd(), options.directory);
    const skillDir = join(skillsDir, name);
    const skillFile = join(skillDir, 'SKILL.md');

    console.log(chalk.blue(`📦 Adding skill: ${name}`));
    console.log();

    try {
      // Check if skill already exists
      try {
        await access(skillDir);
        console.error(chalk.red(`❌ Skill "${name}" already exists at ${skillDir}`));
        process.exit(1);
      } catch {
        // Good, doesn't exist
      }

      // Get template
      let template = SKILL_TEMPLATES[options.template];
      if (!template) {
        console.log(chalk.yellow(`⚠️  Template "${options.template}" not found, using "basic"`));
        template = SKILL_TEMPLATES['basic'];
      }

      // Replace placeholders
      const displayName = name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      const content = template
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{displayName\}\}/g, displayName);

      // Create skill directory and file
      await mkdir(skillDir, { recursive: true });
      await writeFile(skillFile, content);

      console.log(chalk.green(`✓ Created skills/${name}/SKILL.md`));
      console.log();
      console.log(chalk.cyan('Template used: ') + chalk.white(options.template));
      console.log(chalk.cyan('Next: ') + chalk.white(`Edit skills/${name}/SKILL.md to customize`));
      console.log();

    } catch (error) {
      console.error(chalk.red('❌ Failed to add skill:'), error);
      process.exit(1);
    }
  });

// aegis skill list
skillCommand
  .command('list')
  .description('List all skills')
  .option('-d, --directory <dir>', 'Skills directory', './skills')
  .action(async (options: { directory: string }) => {
    const skillsDir = join(process.cwd(), options.directory);

    console.log(chalk.blue('📋 Skills'));
    console.log();

    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory());

      if (dirs.length === 0) {
        console.log(chalk.yellow('No skills found.'));
        console.log(chalk.cyan('Add a skill: ') + chalk.white('aegis skill add <name>'));
        return;
      }

      for (const dir of dirs) {
        const skillFile = join(skillsDir, dir.name, 'SKILL.md');
        try {
          const content = await readFile(skillFile, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const frontmatter = parseYaml(frontmatterMatch[1]);
            const roles = frontmatter.allowedRoles?.join(', ') || 'none';
            console.log(chalk.green(`  ${frontmatter.id || dir.name}`));
            console.log(chalk.gray(`    ${frontmatter.description || 'No description'}`));
            console.log(chalk.gray(`    Roles: ${roles}`));
            console.log();
          }
        } catch {
          console.log(chalk.yellow(`  ${dir.name} (invalid SKILL.md)`));
        }
      }

    } catch (error) {
      console.error(chalk.red('❌ Failed to list skills:'), error);
      process.exit(1);
    }
  });

// aegis skill templates
skillCommand
  .command('templates')
  .description('List available skill templates')
  .action(() => {
    console.log(chalk.blue('📄 Available Templates'));
    console.log();

    const templates = [
      { name: 'basic', desc: 'Minimal skill template' },
      { name: 'browser-limited', desc: 'Read-only browser access' },
      { name: 'code-reviewer', desc: 'Code review with git tools' },
      { name: 'data-analyst', desc: 'Read-only database access' },
      { name: 'flight-booking', desc: 'Travel booking (time-restricted)' },
      { name: 'personal-assistant', desc: 'Calendar and email access' }
    ];

    for (const t of templates) {
      console.log(chalk.green(`  ${t.name}`));
      console.log(chalk.gray(`    ${t.desc}`));
      console.log();
    }

    console.log(chalk.cyan('Usage: ') + chalk.white('aegis skill add <name> --template <template>'));
  });
