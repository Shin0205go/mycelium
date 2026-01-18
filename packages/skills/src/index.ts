#!/usr/bin/env node
// ============================================================================
// Mycelium Skills - MCP Server for Skill Definitions
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
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 */
interface SkillDefinition {
  id: string;           // Internal ID (defaults to name)
  name: string;         // Official: skill name
  displayName: string;  // Human-readable name
  description: string;  // Official: skill description
  allowedRoles: string[];  // Mycelium: roles that can use this skill
  allowedTools: string[];  // Mycelium: tools this skill grants
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

        // Normalize field names (support official + Mycelium formats)
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

  console.error(`Mycelium Skills Server starting...`);
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

  console.error('Mycelium Skills Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
