// ============================================================================
// mycelium policy - Policy verification and testing
// ============================================================================

import { Command } from 'commander';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { parse as parseYaml } from 'yaml';

// Types (inline to avoid build dependency issues)
interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

// Silent logger for CLI
const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

interface SkillFrontmatter {
  id: string;
  displayName: string;
  description: string;
  allowedRoles: string[];
  allowedTools: string[];
  grants?: {
    memory?: 'none' | 'isolated' | 'team' | 'all';
    memoryTeamRoles?: string[];
  };
  metadata?: Record<string, unknown>;
  identity?: {
    skillMatching?: Array<{
      role: string;
      requiredSkills?: string[];
      anySkills?: string[];
      minSkillMatch?: number;
      forbiddenSkills?: string[];
      context?: {
        allowedTime?: string;
        allowedDays?: number[];
        timezone?: string;
      };
      priority?: number;
      description?: string;
    }>;
    trustedPrefixes?: string[];
  };
}

// A2A types (inline to avoid build dependency issues)
interface AgentSkill {
  id: string;
  name?: string;
  description?: string;
}

interface AgentIdentity {
  name: string;
  version?: string;
  skills?: AgentSkill[];
}

interface SkillDefinition {
  id: string;
  displayName: string;
  description: string;
  allowedRoles: string[];
  allowedTools: string[];
  grants?: {
    memory?: 'none' | 'isolated' | 'team' | 'all';
    memoryTeamRoles?: string[];
  };
  metadata?: Record<string, unknown>;
  identity?: {
    skillMatching?: Array<{
      role: string;
      requiredSkills?: string[];
      anySkills?: string[];
      minSkillMatch?: number;
      forbiddenSkills?: string[];
      context?: {
        allowedTime?: string;
        allowedDays?: number[];
        timezone?: string;
      };
      priority?: number;
      description?: string;
    }>;
    trustedPrefixes?: string[];
  };
}

async function loadSkills(skillsDir: string): Promise<SkillFrontmatter[]> {
  const skills: SkillFrontmatter[] = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    for (const dir of dirs) {
      const skillFile = join(skillsDir, dir.name, 'SKILL.md');
      try {
        const content = await readFile(skillFile, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = parseYaml(frontmatterMatch[1]) as SkillFrontmatter;
          skills.push(frontmatter);
        }
      } catch {
        // Skip invalid skills
      }
    }
  } catch {
    // Skills directory doesn't exist
  }

  return skills;
}

export const policyCommand = new Command('policy')
  .description('Policy verification and testing');

// mycelium policy check --role <role>
policyCommand
  .command('check')
  .description('Check effective permissions for a role')
  .requiredOption('-r, --role <role>', 'Role ID to check')
  .option('-d, --directory <dir>', 'Skills directory', './skills')
  .action(async (options: { role: string; directory: string }) => {
    const skillsDir = join(process.cwd(), options.directory);

    console.log(chalk.blue(`🔍 Checking policy for role: ${options.role}`));
    console.log();

    try {
      const skills = await loadSkills(skillsDir);

      if (skills.length === 0) {
        console.log(chalk.yellow('No skills found.'));
        console.log(chalk.cyan('Initialize project: ') + chalk.white('mycelium init'));
        return;
      }

      // Build skill manifest
      const manifest = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description,
          allowedRoles: s.allowedRoles,
          allowedTools: s.allowedTools,
          grants: s.grants,
          metadata: s.metadata
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      // Dynamic import to avoid build-time dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const importDynamic = new Function('modulePath', 'return import(modulePath)');
      const rbacModule = await importDynamic('@mycelium/rbac');
      const RoleManager = rbacModule.RoleManager;

      // Create role manager and load skills
      const roleManager = new RoleManager(silentLogger);
      await roleManager.initialize();
      await roleManager.loadFromSkillManifest(manifest);

      // Check if role exists
      if (!roleManager.hasRole(options.role)) {
        console.log(chalk.red(`❌ Role "${options.role}" not found`));
        console.log();
        console.log(chalk.cyan('Available roles:'));
        for (const roleId of roleManager.getRoleIds()) {
          console.log(chalk.white(`  - ${roleId}`));
        }
        return;
      }

      const role = roleManager.getRole(options.role);
      if (!role) return;

      // Get inheritance chain
      const chain = roleManager.getInheritanceChain(options.role);
      const hasInheritance = chain.length > 1;

      // Header
      console.log(chalk.green(`Role: ${role.name}`));
      console.log(chalk.gray(role.description));
      console.log();

      // Inheritance
      if (hasInheritance) {
        console.log(chalk.cyan('Inheritance Chain:'));
        console.log(chalk.white(`  ${chain.join(' → ')}`));
        console.log();
      }

      // Effective servers
      const effectiveServers = roleManager.getEffectiveServers(options.role);
      console.log(chalk.cyan('Allowed Servers:'));
      if (effectiveServers.length === 0) {
        console.log(chalk.gray('  (none)'));
      } else {
        for (const server of effectiveServers) {
          const inherited = hasInheritance && !role.allowedServers.includes(server);
          const suffix = inherited ? chalk.gray(' (inherited)') : '';
          console.log(chalk.white(`  - ${server}`) + suffix);
        }
      }
      console.log();

      // Effective tools
      const effectivePerms = roleManager.getEffectiveToolPermissions(options.role);
      console.log(chalk.cyan('Allowed Tools:'));
      if (!effectivePerms.allowPatterns?.length) {
        console.log(chalk.gray('  (none)'));
      } else {
        const ownPatterns = role.toolPermissions?.allowPatterns || [];
        for (const pattern of effectivePerms.allowPatterns) {
          const inherited = hasInheritance && !ownPatterns.includes(pattern);
          const suffix = inherited ? chalk.gray(' (inherited)') : '';
          console.log(chalk.white(`  - ${pattern}`) + suffix);
        }
      }
      console.log();

      // Memory permission
      const memPerm = roleManager.getEffectiveMemoryPermission(options.role);
      console.log(chalk.cyan('Memory Access:'));
      console.log(chalk.white(`  Policy: ${memPerm.policy}`));
      if (memPerm.policy === 'team' && memPerm.teamRoles?.length) {
        console.log(chalk.white(`  Team Roles: ${memPerm.teamRoles.join(', ')}`));
      }
      console.log();

      // Skills
      const roleSkills = skills.filter(s =>
        s.allowedRoles.includes(options.role) || s.allowedRoles.includes('*')
      );
      console.log(chalk.cyan('Skills:'));
      if (roleSkills.length === 0) {
        console.log(chalk.gray('  (none)'));
      } else {
        for (const skill of roleSkills) {
          console.log(chalk.white(`  - ${skill.id}`));
        }
      }
      console.log();

    } catch (error) {
      console.error(chalk.red('❌ Failed to check policy:'), error);
      process.exit(1);
    }
  });

// mycelium policy test --agent <name> [--skills <skills>] [--time <datetime>]
policyCommand
  .command('test')
  .description('Test A2A identity resolution')
  .requiredOption('-a, --agent <name>', 'Agent name')
  .option('-s, --skills <skills>', 'Comma-separated agent skills', '')
  .option('-t, --time <datetime>', 'Simulate time (ISO format or "HH:MM")')
  .option('-d, --directory <dir>', 'Skills directory', './skills')
  .action(async (options: { agent: string; skills: string; time?: string; directory: string }) => {
    const skillsDir = join(process.cwd(), options.directory);

    console.log(chalk.blue(`🧪 Testing A2A identity resolution`));
    console.log();

    try {
      const skills = await loadSkills(skillsDir);

      if (skills.length === 0) {
        console.log(chalk.yellow('No skills found.'));
        console.log(chalk.cyan('Initialize project: ') + chalk.white('mycelium init'));
        return;
      }

      // Dynamic import to avoid build-time dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const importDynamic = new Function('modulePath', 'return import(modulePath)');
      const a2aModule = await importDynamic('@mycelium/a2a');
      const createIdentityResolver = a2aModule.createIdentityResolver;

      // Create identity resolver
      const resolver = createIdentityResolver(silentLogger);

      // Load identity rules from skills
      const skillDefinitions: SkillDefinition[] = skills.map(s => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
        allowedRoles: s.allowedRoles,
        allowedTools: s.allowedTools,
        grants: s.grants,
        metadata: s.metadata,
        identity: s.identity
      }));
      resolver.loadFromSkills(skillDefinitions);

      // Build agent identity
      const agentSkills = options.skills
        ? options.skills.split(',').map(s => ({ id: s.trim() }))
        : [];

      const agentIdentity: AgentIdentity = {
        name: options.agent,
        skills: agentSkills
      };

      // Show input
      console.log(chalk.cyan('Agent:'));
      console.log(chalk.white(`  Name: ${options.agent}`));
      console.log(chalk.white(`  Skills: ${agentSkills.map(s => s.id).join(', ') || '(none)'}`));
      if (options.time) {
        console.log(chalk.white(`  Simulated Time: ${options.time}`));
      }
      console.log();

      // Resolve identity
      try {
        const result = resolver.resolve(agentIdentity);

        console.log(chalk.green('✓ Resolution Success'));
        console.log();
        console.log(chalk.cyan('Result:'));
        console.log(chalk.white(`  Role: ${result.roleId}`));
        console.log(chalk.white(`  Trusted: ${result.isTrusted ? 'Yes' : 'No'}`));

        if (result.matchedRule) {
          console.log(chalk.white(`  Matched Rule: ${result.matchedRule.description || 'unnamed'}`));
          console.log(chalk.white(`  Matched Skills: ${result.matchedSkills.join(', ') || '(none)'}`));
        } else {
          console.log(chalk.gray('  (Default role - no rule matched)'));
        }
        console.log();

      } catch (error) {
        console.log(chalk.red('✗ Resolution Failed'));
        console.log();
        console.log(chalk.red(`  Error: ${(error as Error).message}`));
        console.log();
      }

      // Show stats
      const stats = resolver.getStats();
      console.log(chalk.cyan('Resolver Stats:'));
      console.log(chalk.gray(`  Total Rules: ${stats.totalRules}`));
      console.log(chalk.gray(`  Rules by Role: ${JSON.stringify(stats.rulesByRole)}`));
      console.log(chalk.gray(`  Trusted Prefixes: ${stats.trustedPrefixes.join(', ') || '(none)'}`));
      console.log();

    } catch (error) {
      console.error(chalk.red('❌ Failed to test policy:'), error);
      process.exit(1);
    }
  });

// mycelium policy roles
policyCommand
  .command('roles')
  .description('List all available roles')
  .option('-d, --directory <dir>', 'Skills directory', './skills')
  .action(async (options: { directory: string }) => {
    const skillsDir = join(process.cwd(), options.directory);

    console.log(chalk.blue('👥 Available Roles'));
    console.log();

    try {
      const skills = await loadSkills(skillsDir);

      if (skills.length === 0) {
        console.log(chalk.yellow('No skills found.'));
        return;
      }

      // Collect all roles
      const roleMap = new Map<string, { skills: string[]; tools: Set<string> }>();

      for (const skill of skills) {
        for (const roleId of skill.allowedRoles) {
          if (roleId === '*') continue;

          if (!roleMap.has(roleId)) {
            roleMap.set(roleId, { skills: [], tools: new Set() });
          }

          const role = roleMap.get(roleId)!;
          role.skills.push(skill.id);
          for (const tool of skill.allowedTools) {
            role.tools.add(tool);
          }
        }
      }

      // Display roles
      for (const [roleId, info] of roleMap.entries()) {
        console.log(chalk.green(`  ${roleId}`));
        console.log(chalk.gray(`    Skills: ${info.skills.join(', ')}`));
        console.log(chalk.gray(`    Tools: ${info.tools.size} patterns`));
        console.log();
      }

    } catch (error) {
      console.error(chalk.red('❌ Failed to list roles:'), error);
      process.exit(1);
    }
  });
