#!/usr/bin/env node
// ============================================================================
// AEGIS Skills - MCP Server for Skill Definitions
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Skill definition with role permissions
 */
interface SkillDefinition {
  id: string;
  displayName: string;
  description: string;
  allowedRoles: string[];
  allowedTools: string[];
  version?: string;
  category?: string;
  tags?: string[];
  instruction?: string;
}

/**
 * Parse SKILL.md frontmatter
 */
function parseSkillManifest(content: string): Partial<SkillDefinition> & { instruction?: string; name?: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: Record<string, any> = {};

  // Simple YAML-like parsing
  const lines = frontmatter.split('\n');
  let currentKey = '';
  let currentArray: string[] = [];
  let inArray = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- ') && inArray) {
      currentArray.push(trimmed.slice(2));
    } else if (trimmed.includes(':')) {
      if (inArray && currentKey) {
        result[currentKey] = currentArray;
        currentArray = [];
        inArray = false;
      }

      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();
      currentKey = key.trim();

      if (value === '') {
        inArray = true;
      } else {
        result[currentKey] = value;
      }
    }
  }

  if (inArray && currentKey) {
    result[currentKey] = currentArray;
  }

  // Extract instruction (content after frontmatter)
  const instructionMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  if (instructionMatch) {
    result.instruction = instructionMatch[1].trim();
  }

  return result as Partial<SkillDefinition> & { instruction?: string };
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
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const content = await fs.readFile(skillPath, 'utf-8');
          const manifest = parseSkillManifest(content);

          const skillId = manifest.id || (manifest as any).name;
          // Support both 'allowedRoles' and 'allowed-roles', 'allowedTools' and 'allowed-tools'
          const allowedRoles = manifest.allowedRoles || (manifest as any)['allowedRoles'] || [];
          const allowedTools = manifest.allowedTools || (manifest as any)['allowed-tools'] || [];

          if (skillId && allowedRoles.length > 0) {
            skills.push({
              id: skillId,
              displayName: manifest.displayName || skillId,
              description: manifest.description || '',
              allowedRoles: allowedRoles,
              allowedTools: allowedTools,
              version: manifest.version,
              category: manifest.category,
              tags: manifest.tags,
              instruction: manifest.instruction,
            });
          }
        } catch (err) {
          // Skip if SKILL.md doesn't exist
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

  console.error(`AEGIS Skills Server starting...`);
  console.error(`Skills directory: ${skillsDir}`);

  // Load skills
  let skills = await loadSkills(skillsDir);
  console.error(`Loaded ${skills.length} skills`);

  // Create MCP Server
  const server = new Server(
    {
      name: 'aegis-skills',
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

  console.error('AEGIS Skills Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
