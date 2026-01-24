#!/usr/bin/env node
// ============================================================================
// MYCELIUM Skills - MCP Server for Skill Definitions
// Provides skill manifests with declarative role permissions
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import yaml from 'js-yaml';

/** Supported script extensions and their runners */
const SCRIPT_RUNNERS: Record<string, string[]> = {
  '.py': ['python3'],
  '.sh': ['bash'],
  '.js': ['node'],
  '.ts': ['npx', 'tsx'],
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom slash command defined by a skill
 */
interface SkillCommand {
  name: string;
  description: string;
  handlerType: 'tool' | 'script';
  toolName?: string;
  scriptPath?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
    default?: string;
  }>;
  usage?: string;
}

/**
 * Skill definition with role permissions
 *
 * Compatible with official Claude Agent Skills format:
 * - name: Skill identifier (required, max 64 chars, lowercase/numbers/hyphens)
 * - description: What the skill does and when to use it (required, max 1024 chars)
 *
 * Mycelium RBAC extensions:
 * - allowedRoles: Roles that can use this skill
 * - allowedTools: MCP tools this skill grants access to
 * - commands: Custom slash commands this skill provides
 */
interface SkillDefinition {
  id: string;           // Internal ID (defaults to name)
  name: string;         // Official: skill name
  displayName: string;  // Human-readable name
  description: string;  // Official: skill description
  allowedRoles: string[];  // Mycelium: roles that can use this skill
  allowedTools: string[];  // Mycelium: tools this skill grants
  commands?: SkillCommand[];  // Mycelium: custom slash commands
  version?: string;
  category?: string;
  tags?: string[];
  instruction?: string;  // Content from SKILL.md body or README.md
}

/**
 * Raw YAML structure (supports official + Mycelium formats)
 */
interface RawSkillYaml {
  // Official Claude Skills fields
  name?: string;           // Required in official format
  description?: string;    // Required in official format

  // Mycelium RBAC fields
  id?: string;             // Optional, defaults to name
  displayName?: string;    // Optional, defaults to name
  allowedRoles?: string[];
  'allowed-roles'?: string[];
  allowedTools?: string[];
  'allowed-tools'?: string[];

  // Custom slash commands
  commands?: SkillCommand[];

  // Optional metadata
  version?: string;
  category?: string;
  tags?: string[];
}

/**
 * Parse SKILL.yaml file
 */
function parseSkillYaml(content: string): RawSkillYaml {
  try {
    return yaml.load(content) as RawSkillYaml || {};
  } catch (err) {
    console.error('Failed to parse YAML:', err);
    return {};
  }
}

/**
 * Parse SKILL.md frontmatter (legacy support)
 */
function parseSkillMdFrontmatter(content: string): RawSkillYaml {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }
  return parseSkillYaml(frontmatterMatch[1]);
}

/**
 * Load all skills from directory
 */
async function loadSkills(skillsDir: string): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(skillsDir, entry.name);
        let manifest: RawSkillYaml = {};
        let instruction: string | undefined;

        // Try SKILL.yaml first, then fall back to SKILL.md for metadata
        const yamlPath = path.join(skillDir, 'SKILL.yaml');
        const mdPath = path.join(skillDir, 'SKILL.md');
        const readmePath = path.join(skillDir, 'README.md');

        let hasYaml = false;
        try {
          const yamlContent = await fs.readFile(yamlPath, 'utf-8');
          manifest = parseSkillYaml(yamlContent);
          hasYaml = true;
        } catch {
          // No SKILL.yaml, will try SKILL.md
        }

        // Try SKILL.md - for metadata and/or instruction content
        try {
          const mdContent = await fs.readFile(mdPath, 'utf-8');
          const mdManifest = parseSkillMdFrontmatter(mdContent);

          if (hasYaml) {
            // Merge: SKILL.md provides base metadata, SKILL.yaml overrides/extends
            manifest = { ...mdManifest, ...manifest };
          } else {
            // Use SKILL.md for metadata
            manifest = mdManifest;
          }

          // Extract instruction from SKILL.md content after frontmatter
          const instructionMatch = mdContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
          if (instructionMatch) {
            instruction = instructionMatch[1].trim();
          }
        } catch {
          if (!hasYaml) {
            // Skip if neither exists
            continue;
          }
        }

        // Try to load README.md for instruction (if not already set from SKILL.md)
        if (!instruction) {
          try {
            instruction = await fs.readFile(readmePath, 'utf-8');
          } catch {
            // No README.md, that's fine
          }
        }

        // Normalize field names (support official + MYCELIUM formats)
        const skillName = manifest.name || manifest.id;
        const skillId = manifest.id || manifest.name;
        const allowedRoles = manifest.allowedRoles || manifest['allowed-roles'] || [];
        const allowedTools = manifest.allowedTools || manifest['allowed-tools'] || [];

        // Official format requires name and description
        // Mycelium format requires allowedRoles
        if (skillName && allowedRoles.length > 0) {
          skills.push({
            id: skillId!,
            name: skillName,
            displayName: manifest.displayName || skillName,
            description: manifest.description || '',
            allowedRoles: allowedRoles,
            allowedTools: allowedTools,
            commands: manifest.commands,
            version: manifest.version,
            category: manifest.category,
            tags: manifest.tags,
            instruction: instruction,
          });
        }
      }
    }
  } catch (err) {
    console.error('Failed to load skills:', err);
  }

  return skills;
}

async function main() {
  // Get skills directory from args or default
  const skillsDir = process.argv[2] || path.join(__dirname, '..', 'skills');

  console.error(`MYCELIUM Skills Server starting...`);
  console.error(`Skills directory: ${skillsDir}`);

  // Load skills
  let skills = await loadSkills(skillsDir);
  console.error(`Loaded ${skills.length} skills`);

  // Create MCP Server
  const server = new Server(
    {
      name: 'mycelium-skills',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List Tools Handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_skills',
          description: 'List all available skills with their role permissions',
          inputSchema: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                description: 'Optional: Filter skills by role',
              },
            },
          },
        },
        {
          name: 'get_skill',
          description: 'Get detailed information about a specific skill',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The skill ID',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'list_resources',
          description: 'List resources available in a skill directory',
          inputSchema: {
            type: 'object',
            properties: {
              skillId: {
                type: 'string',
                description: 'The skill ID to list resources for',
              },
            },
            required: ['skillId'],
          },
        },
        {
          name: 'get_resource',
          description: 'Get a resource file from a skill directory',
          inputSchema: {
            type: 'object',
            properties: {
              skillId: {
                type: 'string',
                description: 'The skill ID',
              },
              resourcePath: {
                type: 'string',
                description: 'Path to the resource file within the skill directory',
              },
            },
            required: ['skillId', 'resourcePath'],
          },
        },
        {
          name: 'reload_skills',
          description: 'Reload skills from disk',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'run_script',
          description: 'Execute a script file within a skill directory. Supports Python (.py), Shell (.sh), Node.js (.js), and TypeScript (.ts) scripts.',
          inputSchema: {
            type: 'object',
            properties: {
              skill: {
                type: 'string',
                description: 'The skill ID containing the script',
              },
              path: {
                type: 'string',
                description: 'Relative path to the script file within the skill directory',
              },
              args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional arguments to pass to the script',
              },
            },
            required: ['skill', 'path'],
          },
        },
        {
          name: 'list_commands',
          description: 'List all custom slash commands defined by skills',
          inputSchema: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                description: 'Optional: Filter commands by role',
              },
            },
          },
        },
      ],
    };
  });

  // Call Tool Handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'list_skills': {
        const role = (args as any)?.role;
        let filteredSkills = skills;

        if (role) {
          filteredSkills = skills.filter(s =>
            s.allowedRoles.includes(role) || s.allowedRoles.includes('*')
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ skills: filteredSkills }, null, 2),
            },
          ],
        };
      }

      case 'get_skill': {
        const id = (args as any)?.id;
        const skill = skills.find(s => s.id === id);

        if (!skill) {
          return {
            content: [{ type: 'text', text: `Skill not found: ${id}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(skill, null, 2),
            },
          ],
        };
      }

      case 'list_resources': {
        const skillId = (args as any)?.skillId;
        const skill = skills.find(s => s.id === skillId);

        if (!skill) {
          return {
            content: [{ type: 'text', text: `Skill not found: ${skillId}` }],
            isError: true,
          };
        }

        try {
          const skillDir = path.join(skillsDir, skillId);
          const entries = await fs.readdir(skillDir, { withFileTypes: true });
          const resources = entries
            .filter(e => !e.name.startsWith('.') && e.name !== 'SKILL.yaml' && e.name !== 'SKILL.md')
            .map(e => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
            }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ resources }, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Failed to list resources: ${err}` }],
            isError: true,
          };
        }
      }

      case 'get_resource': {
        const skillId = (args as any)?.skillId;
        const resourcePath = (args as any)?.resourcePath;

        if (!skillId || !resourcePath) {
          return {
            content: [{ type: 'text', text: 'Missing skillId or resourcePath' }],
            isError: true,
          };
        }

        // Security: prevent path traversal
        const normalizedPath = path.normalize(resourcePath);
        if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
          return {
            content: [{ type: 'text', text: 'Invalid resource path' }],
            isError: true,
          };
        }

        try {
          const fullPath = path.join(skillsDir, skillId, normalizedPath);
          const content = await fs.readFile(fullPath, 'utf-8');

          return {
            content: [
              {
                type: 'text',
                text: content,
              },
            ],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Failed to read resource: ${err}` }],
            isError: true,
          };
        }
      }

      case 'reload_skills': {
        skills = await loadSkills(skillsDir);
        return {
          content: [
            {
              type: 'text',
              text: `Reloaded ${skills.length} skills`,
            },
          ],
        };
      }

      case 'run_script': {
        const skillId = (args as any)?.skill;
        const scriptPath = (args as any)?.path;
        const scriptArgs = (args as any)?.args || [];

        if (!skillId || !scriptPath) {
          return {
            content: [{ type: 'text', text: 'Missing skill or path parameter' }],
            isError: true,
          };
        }

        // Verify skill exists
        const skill = skills.find(s => s.id === skillId);
        if (!skill) {
          return {
            content: [{ type: 'text', text: `Skill not found: ${skillId}` }],
            isError: true,
          };
        }

        // Security: prevent path traversal
        const normalizedPath = path.normalize(scriptPath);
        if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
          return {
            content: [{ type: 'text', text: 'Invalid script path: path traversal not allowed' }],
            isError: true,
          };
        }

        // Check file extension
        const ext = path.extname(normalizedPath).toLowerCase();
        const runner = SCRIPT_RUNNERS[ext];
        if (!runner) {
          return {
            content: [{ type: 'text', text: `Unsupported script type: ${ext}. Supported: ${Object.keys(SCRIPT_RUNNERS).join(', ')}` }],
            isError: true,
          };
        }

        const fullPath = path.join(skillsDir, skillId, normalizedPath);

        // Verify file exists
        try {
          await fs.access(fullPath);
        } catch {
          return {
            content: [{ type: 'text', text: `Script not found: ${scriptPath}` }],
            isError: true,
          };
        }

        // Execute script
        try {
          const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
            const [cmd, ...cmdArgs] = runner;
            const proc = spawn(cmd, [...cmdArgs, fullPath, ...scriptArgs], {
              cwd: path.join(skillsDir, skillId),
              env: { ...process.env, SKILL_ID: skillId, SKILL_DIR: path.join(skillsDir, skillId) },
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });

            proc.on('close', (code) => {
              resolve({ stdout, stderr, exitCode: code ?? 0 });
            });

            proc.on('error', (err) => {
              resolve({ stdout: '', stderr: err.message, exitCode: 1 });
            });
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: result.exitCode === 0,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                }, null, 2),
              },
            ],
            isError: result.exitCode !== 0,
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Failed to execute script: ${err}` }],
            isError: true,
          };
        }
      }

      case 'list_commands': {
        const role = (args as any)?.role;

        // Collect all commands from all skills (optionally filtered by role)
        const commands: Array<{
          command: string;
          description: string;
          skillId: string;
          skillName: string;
          handlerType: string;
          toolName?: string;
          scriptPath?: string;
          arguments?: SkillCommand['arguments'];
          usage?: string;
        }> = [];

        for (const skill of skills) {
          // Filter by role if specified
          if (role && !skill.allowedRoles.includes(role) && !skill.allowedRoles.includes('*')) {
            continue;
          }

          if (skill.commands) {
            for (const cmd of skill.commands) {
              commands.push({
                command: cmd.name,
                description: cmd.description,
                skillId: skill.id,
                skillName: skill.displayName,
                handlerType: cmd.handlerType,
                toolName: cmd.toolName,
                scriptPath: cmd.scriptPath,
                arguments: cmd.arguments,
                usage: cmd.usage,
              });
            }
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ commands }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MYCELIUM Skills Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
