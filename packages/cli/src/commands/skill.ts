// ============================================================================
// aegis skill - Manage skills
// ============================================================================

import { Command } from 'commander';
import { mkdir, writeFile, readdir, readFile, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { parse as parseYaml } from 'yaml';
import { existsSync } from 'fs';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

// Detect skills directory (monorepo-aware)
function getDefaultSkillsDir(): string {
  const cwd = process.cwd();
  const monorepoPath = join(cwd, 'packages/skills/skills');
  if (existsSync(monorepoPath)) {
    return 'packages/skills/skills';
  }
  return './skills';
}

// Skill templates (Official Claude Skills format with AEGIS RBAC extensions)
const SKILL_TEMPLATES: Record<string, string> = {
  'basic': `---
name: {{name}}
description: Basic skill template for filesystem operations

# AEGIS RBAC Extensions
allowedRoles:
  - developer
allowedTools:
  - filesystem__read_file
  - filesystem__list_directory
grants:
  memory: none
---

# {{displayName}}

Basic skill for reading and exploring files.

## Instructions

When using this skill:
1. Use \`filesystem__read_file\` to read file contents
2. Use \`filesystem__list_directory\` to explore directory structure
3. Always verify file paths before reading

## Examples

Reading a configuration file:
\`\`\`bash
cat config.json
\`\`\`

Listing directory contents:
\`\`\`bash
ls -la ./src
\`\`\`
`,

  'browser-limited': `---
name: browser-limited
description: Read-only browser access for web research. Use when analyzing web content or gathering information from websites.

# AEGIS RBAC Extensions
allowedRoles:
  - researcher
  - analyst
allowedTools:
  - playwright__browser_navigate
  - playwright__browser_snapshot
  - playwright__browser_take_screenshot
grants:
  memory: isolated
---

# Limited Browser Access

Read-only browser capabilities for web research and content analysis.

## Instructions

1. Navigate to URLs using \`playwright__browser_navigate\`
2. Take snapshots for accessibility tree analysis
3. Capture screenshots for visual verification
4. Extract text content from pages

## Restrictions

- No form submission or interaction
- No cookie manipulation
- Read-only operations only

## Examples

\`\`\`bash
# Navigate to a page
playwright__browser_navigate --url "https://example.com"

# Take accessibility snapshot
playwright__browser_snapshot

# Capture screenshot
playwright__browser_take_screenshot
\`\`\`
`,

  'code-reviewer': `---
name: code-reviewer
description: Code review and analysis tools with git integration and team memory access. Use for pull requests, code audits, and knowledge sharing.

# AEGIS RBAC Extensions
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

Professional code review with git history analysis and team collaboration.

## Instructions

### Code Review Workflow

1. **Read the code**: Use \`filesystem__read_file\` to examine source files
2. **Check history**: Use \`git__log\` and \`git__blame\` to understand changes
3. **View diffs**: Use \`git__diff\` to see what changed
4. **Access context**: Use team memory to recall related discussions

### Review Checklist

- Code quality and readability
- Security vulnerabilities
- Performance implications
- Test coverage
- Documentation

## Examples

\`\`\`bash
# View recent changes
git diff main...feature-branch

# Check file history
git log -p --follow src/main.ts

# Find who changed a line
git blame src/auth.ts
\`\`\`
`,

  'data-analyst': `---
name: data-analyst
description: Read-only database access for data analysis. Execute SELECT queries, explore schemas, and analyze patterns.

# AEGIS RBAC Extensions
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

Read-only database access for analytics and reporting.

## Instructions

### Data Analysis Workflow

1. **Explore schema**: List tables and describe their structure
2. **Write queries**: Use SELECT statements to extract data
3. **Analyze results**: Look for patterns and insights
4. **Document findings**: Save insights to memory

### Query Guidelines

- Use \`LIMIT\` to avoid large result sets
- Optimize queries with appropriate indexes
- Respect query timeout (30 seconds)

## Restrictions

- **Read-only**: No INSERT, UPDATE, DELETE, or DDL
- **Query timeout**: 30 seconds maximum
- **Result limit**: 1000 rows per query

## Examples

\`\`\`sql
-- List all tables
SELECT table_name FROM information_schema.tables;

-- Analyze sales data
SELECT
  DATE(created_at) as date,
  COUNT(*) as orders,
  SUM(total) as revenue
FROM orders
WHERE created_at >= '2024-01-01'
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;
\`\`\`
`,

  'flight-booking': `---
name: flight-booking
description: Flight search and booking capabilities with time-based access control. Use for travel planning and reservations.

# AEGIS RBAC Extensions
allowedRoles:
  - travel-agent
  - assistant
allowedTools:
  - playwright__browser_navigate
  - playwright__browser_type
  - playwright__browser_click
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

Automated flight search and booking with business hours enforcement.

## Instructions

### Booking Workflow

1. **Search flights**: Navigate to airline websites
2. **Fill forms**: Enter passenger and travel details
3. **Review options**: Compare prices and schedules
4. **Create calendar event**: Add trip to calendar

### Security

- **Time restriction**: Weekdays 9 AM - 6 PM ET only
- **Required skill**: \`travel_booking\` capability needed
- **Verification**: Always confirm details before booking

## Examples

\`\`\`bash
# Search for flights
playwright__browser_navigate --url "https://airline.example.com"

# Fill search form
playwright__browser_type --element "departure" --text "JFK"
playwright__browser_type --element "arrival" --text "LAX"

# Create calendar event
calendar__create_event --title "Flight to LAX" --date "2024-06-15"
\`\`\`
`,

  'personal-assistant': `---
name: personal-assistant
description: Calendar and email management for personal assistance tasks. Schedule meetings, read emails, and coordinate events.

# AEGIS RBAC Extensions
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

Calendar and email management for scheduling and coordination.

## Instructions

### Daily Workflow

1. **Check calendar**: Review today's events and upcoming meetings
2. **Process emails**: Read and categorize incoming messages
3. **Schedule meetings**: Create and update calendar events
4. **Coordinate**: Find available time slots and send summaries

### Best Practices

- Always check for conflicts before creating events
- Respect working hours when scheduling
- Summarize important emails
- Keep calendar descriptions clear and concise

## Examples

\`\`\`bash
# Read today's calendar
calendar__read_events --date "today"

# Create a meeting
calendar__create_event \\
  --title "Team Sync" \\
  --date "2024-06-15" \\
  --time "14:00" \\
  --duration "60"

# Check recent emails
email__list --folder "inbox" --limit 10
\`\`\`
`
};

export const skillCommand = new Command('skill')
  .description('Manage skills (create, list, and view templates)');

/**
 * Split template into SKILL.yaml and SKILL.md
 */
function splitTemplate(template: string): { yaml: string; markdown: string } {
  const frontmatterMatch = template.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { yaml: '', markdown: template };
  }

  let yaml = frontmatterMatch[1];
  const markdown = frontmatterMatch[2].trim();

  // Remove "# AEGIS RBAC Extensions" comment from YAML (it's documentation)
  yaml = yaml.replace(/^# AEGIS RBAC Extensions\n/m, '');

  return { yaml, markdown };
}

/**
 * Interactive skill creation
 */
async function createSkillInteractive(skillName: string): Promise<{ yaml: string; markdown: string }> {
  const rl = readline.createInterface({ input, output });

  console.log(chalk.cyan('\n📝 Creating new skill interactively\n'));

  try {
    // Name (pre-filled)
    console.log(chalk.gray(`Skill name: ${chalk.white(skillName)}`));

    // Description
    const description = await rl.question(chalk.cyan('Description: '));

    // Allowed Roles
    console.log(chalk.gray('\nEnter allowed roles (comma-separated, e.g., developer,admin):'));
    const rolesInput = await rl.question(chalk.cyan('Allowed roles: '));
    const allowedRoles = rolesInput.split(',').map(r => r.trim()).filter(r => r);

    // Allowed Tools
    console.log(chalk.gray('\nEnter allowed tools (comma-separated, e.g., filesystem__read_file,git__log):'));
    console.log(chalk.gray('Use * for all tools, server__* for all tools from a server'));
    const toolsInput = await rl.question(chalk.cyan('Allowed tools: '));
    const allowedTools = toolsInput.split(',').map(t => t.trim()).filter(t => t);

    // Memory policy
    console.log(chalk.gray('\nMemory access policy:'));
    console.log(chalk.gray('  none     - No memory access'));
    console.log(chalk.gray('  isolated - Own role memory only'));
    console.log(chalk.gray('  team     - Access team roles\' memories'));
    console.log(chalk.gray('  all      - Access all memories (admin)'));
    const memoryPolicy = await rl.question(chalk.cyan('Memory policy [none]: ')) || 'none';

    // Build YAML
    const yamlContent = `name: ${skillName}
description: ${description}

# AEGIS RBAC
allowedRoles:
${allowedRoles.map(r => `  - ${r}`).join('\n')}
allowedTools:
${allowedTools.map(t => `  - ${t}`).join('\n')}
grants:
  memory: ${memoryPolicy}
`;

    // Build Markdown
    const displayName = skillName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const markdownContent = `# ${displayName}

${description}

## Instructions

1. Step-by-step instructions on how to use this skill
2. Add more guidance as needed

## Examples

\`\`\`bash
# Example command
echo "Add examples here"
\`\`\`
`;

    rl.close();
    console.log();

    return { yaml: yamlContent, markdown: markdownContent };
  } catch (error) {
    rl.close();
    throw error;
  }
}

// aegis skill add <name>
skillCommand
  .command('add')
  .description('Create a new skill interactively')
  .argument('<name>', 'Skill name')
  .option('-d, --directory <dir>', 'Skills directory', './skills')
  .action(async (name: string, options: { directory: string }) => {
    const skillsDir = join(process.cwd(), options.directory);
    const skillDir = join(skillsDir, name);
    const yamlFile = join(skillDir, 'SKILL.yaml');
    const mdFile = join(skillDir, 'SKILL.md');

    console.log(chalk.blue(`📦 Creating skill: ${name}`));

    try {
      // Check if skill already exists
      try {
        await access(skillDir);
        console.error(chalk.red(`\n❌ Skill "${name}" already exists at ${skillDir}`));
        process.exit(1);
      } catch {
        // Good, doesn't exist
      }

      // Interactive mode (always)
      const { yaml, markdown } = await createSkillInteractive(name);

      // Create skill directory and files
      await mkdir(skillDir, { recursive: true });
      await writeFile(yamlFile, yaml);
      await writeFile(mdFile, markdown);

      console.log(chalk.green(`✓ Created skills/${name}/SKILL.yaml`));
      console.log(chalk.green(`✓ Created skills/${name}/SKILL.md`));
      console.log();
      console.log(chalk.cyan('Files created successfully!'));
      console.log(chalk.gray('You can now edit the files to add more details.'));
      console.log();

    } catch (error) {
      console.error(chalk.red('\n❌ Failed to create skill:'), error);
      process.exit(1);
    }
  });

// aegis skill list
skillCommand
  .command('list')
  .description('List all skills')
  .option('-d, --directory <dir>', 'Skills directory')
  .option('-v, --verbose', 'Show detailed information')
  .action(async (options: { directory?: string; verbose?: boolean }) => {
    const defaultDir = getDefaultSkillsDir();
    const skillsDir = join(process.cwd(), options.directory || defaultDir);

    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory());

      if (dirs.length === 0) {
        console.log(chalk.yellow('\nNo skills found.\n'));
        console.log(chalk.cyan('Add a skill: ') + chalk.white('aegis skill add <name>'));
        return;
      }

      console.log(chalk.cyan(`\nSkills (${dirs.length}):\n`));

      const skills: Array<{ id: string; description?: string; roles: string[]; tools: number }> = [];

      for (const dir of dirs) {
        // Try SKILL.yaml first (monorepo), then SKILL.md (user projects)
        const yamlFile = join(skillsDir, dir.name, 'SKILL.yaml');
        const mdFile = join(skillsDir, dir.name, 'SKILL.md');

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
              id: frontmatter.id || dir.name,
              description: frontmatter.description,
              roles: frontmatter.allowedRoles || [],
              tools: frontmatter.allowedTools?.length || 0
            });
          }
        } catch {
          // Skip invalid skills
        }
      }

      // Sort by ID
      skills.sort((a, b) => a.id.localeCompare(b.id));

      for (const skill of skills) {
        if (options.verbose) {
          console.log(`  • ${chalk.bold(skill.id)}`);
          if (skill.description) {
            console.log(chalk.gray(`    ${skill.description}`));
          }
          console.log(chalk.gray(`    Roles: ${skill.roles.join(', ') || 'none'}`));
          console.log(chalk.gray(`    Tools: ${skill.tools} patterns`));
          console.log();
        } else {
          console.log(`  • ${chalk.bold(skill.id)}`);
        }
      }

      if (!options.verbose) {
        console.log();
        console.log(chalk.gray('Use --verbose for detailed information'));
      }
      console.log();

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
    console.log(chalk.blue('📄 Skill Templates'));
    console.log();
    console.log('Templates are pre-configured skill definitions that you can use as starting points');
    console.log('when creating new skills. Each template includes common role/tool configurations.');
    console.log();

    const templates = [
      { name: 'basic', desc: 'Minimal skill template', tools: 'filesystem read' },
      { name: 'browser-limited', desc: 'Read-only browser access', tools: 'navigate, screenshot' },
      { name: 'code-reviewer', desc: 'Code review with git tools', tools: 'git, filesystem, team memory' },
      { name: 'data-analyst', desc: 'Read-only database access', tools: 'database read' },
      { name: 'flight-booking', desc: 'Travel booking (time-restricted)', tools: 'booking API, time rules' },
      { name: 'personal-assistant', desc: 'Calendar and email access', tools: 'calendar, email, memory' }
    ];

    for (const t of templates) {
      console.log(chalk.green(`  ${t.name}`));
      console.log(chalk.gray(`    ${t.desc}`));
      console.log(chalk.gray(`    Tools: ${t.tools}`));
      console.log();
    }

    console.log(chalk.cyan('Create a new skill from template:'));
    console.log(chalk.white('  aegis skill add my-skill --template basic'));
    console.log();
    console.log(chalk.gray('This will create: skills/my-skill/SKILL.md'));
    console.log(chalk.gray('Then edit the file to customize roles, tools, and permissions.'));
  });
