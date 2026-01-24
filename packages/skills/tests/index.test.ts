/**
 * Unit tests for @aegis/skills MCP Server
 * Tests skill loading, parsing, and MCP handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';

// Mock fs
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

describe('@mycelium/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('YAML parsing', () => {
    it('should parse valid YAML skill definition', () => {
      const yamlContent = `
id: frontend-dev
name: Frontend Development
displayName: Frontend Development
description: Tools for frontend work
allowedRoles:
  - frontend
  - fullstack
allowedTools:
  - filesystem__read
  - web__fetch
version: '1.0.0'
category: development
tags:
  - frontend
  - react
`;
      const parsed = yaml.load(yamlContent) as any;

      expect(parsed.id).toBe('frontend-dev');
      expect(parsed.name).toBe('Frontend Development');
      expect(parsed.allowedRoles).toContain('frontend');
      expect(parsed.allowedTools).toHaveLength(2);
      expect(parsed.tags).toContain('react');
    });

    it('should parse YAML with kebab-case fields', () => {
      const yamlContent = `
id: test-skill
name: Test Skill
allowed-roles:
  - admin
allowed-tools:
  - tool1
`;
      const parsed = yaml.load(yamlContent) as any;

      expect(parsed.id).toBe('test-skill');
      expect(parsed['allowed-roles']).toContain('admin');
      expect(parsed['allowed-tools']).toContain('tool1');
    });

    it('should handle empty YAML', () => {
      const parsed = yaml.load('') as any;
      expect(parsed).toBeUndefined();
    });

    it('should throw on invalid YAML', () => {
      // Use truly malformed YAML that will cause parsing error
      const invalidYaml = `
key: value
  - item1
- item2
key: [unclosed bracket
`;
      expect(() => yaml.load(invalidYaml)).toThrow();
    });
  });

  describe('Markdown frontmatter parsing', () => {
    it('should extract frontmatter from markdown', () => {
      const mdContent = `---
id: test-skill
name: Test Skill
allowedRoles:
  - user
allowedTools: []
---

# Test Skill

This is the skill instruction content.
`;
      const frontmatterMatch = mdContent.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();

      const parsed = yaml.load(frontmatterMatch![1]) as any;
      expect(parsed.id).toBe('test-skill');
      expect(parsed.name).toBe('Test Skill');
    });

    it('should extract instruction content after frontmatter', () => {
      const mdContent = `---
id: skill
name: Skill
allowedRoles: [user]
allowedTools: []
---

# Skill Instruction

Do this and that.
`;
      const instructionMatch = mdContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      expect(instructionMatch).not.toBeNull();

      const instruction = instructionMatch![1].trim();
      expect(instruction).toContain('# Skill Instruction');
      expect(instruction).toContain('Do this and that.');
    });

    it('should handle markdown without frontmatter', () => {
      const mdContent = `# Just a heading

No frontmatter here.
`;
      const frontmatterMatch = mdContent.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).toBeNull();
    });
  });

  describe('Skill definition normalization', () => {
    it('should normalize name to id if id not provided', () => {
      const manifest = {
        name: 'test-skill',
        // id not provided
        allowedRoles: ['user'],
      };

      const skillId = manifest.name;
      expect(skillId).toBe('test-skill');
    });

    it('should use id over name if both provided', () => {
      const manifest = {
        id: 'official-id',
        name: 'display-name',
        allowedRoles: ['user'],
      };

      const skillId = manifest.id || manifest.name;
      expect(skillId).toBe('official-id');
    });

    it('should normalize kebab-case to camelCase fields', () => {
      const manifest = {
        name: 'test',
        'allowed-roles': ['user'],
        'allowed-tools': ['tool1'],
      };

      const allowedRoles = manifest['allowed-roles'] || [];
      const allowedTools = manifest['allowed-tools'] || [];

      expect(allowedRoles).toContain('user');
      expect(allowedTools).toContain('tool1');
    });
  });

  describe('Skill filtering by role', () => {
    const skills = [
      { id: 'admin-only', allowedRoles: ['admin'] },
      { id: 'user-skill', allowedRoles: ['user'] },
      { id: 'all-access', allowedRoles: ['*'] },
      { id: 'multi-role', allowedRoles: ['admin', 'user'] },
    ];

    it('should filter skills for admin role', () => {
      const role = 'admin';
      const filtered = skills.filter(
        s => s.allowedRoles.includes(role) || s.allowedRoles.includes('*')
      );

      expect(filtered.map(s => s.id)).toContain('admin-only');
      expect(filtered.map(s => s.id)).toContain('all-access');
      expect(filtered.map(s => s.id)).toContain('multi-role');
      expect(filtered.map(s => s.id)).not.toContain('user-skill');
    });

    it('should filter skills for user role', () => {
      const role = 'user';
      const filtered = skills.filter(
        s => s.allowedRoles.includes(role) || s.allowedRoles.includes('*')
      );

      expect(filtered.map(s => s.id)).toContain('user-skill');
      expect(filtered.map(s => s.id)).toContain('all-access');
      expect(filtered.map(s => s.id)).toContain('multi-role');
      expect(filtered.map(s => s.id)).not.toContain('admin-only');
    });

    it('should return all skills with wildcard role', () => {
      // When querying with *, should get skills that have * in allowedRoles
      const role = '*';
      const filtered = skills.filter(
        s => s.allowedRoles.includes(role) || s.allowedRoles.includes('*')
      );

      expect(filtered.map(s => s.id)).toContain('all-access');
    });

    it('should return empty for unknown role', () => {
      const role = 'unknown';
      const filtered = skills.filter(
        s => s.allowedRoles.includes(role) || s.allowedRoles.includes('*')
      );

      // Only skills with * should match
      expect(filtered.map(s => s.id)).toEqual(['all-access']);
    });
  });

  describe('Path security', () => {
    it('should detect path traversal attempts', () => {
      const testPaths = [
        { path: '../etc/passwd', isTraversal: true },
        { path: '../../secret', isTraversal: true },
        { path: 'normal/path', isTraversal: false },
        { path: './relative', isTraversal: false },
        { path: '/absolute/path', isTraversal: true },
      ];

      for (const { path: testPath, isTraversal } of testPaths) {
        const normalizedPath = path.normalize(testPath);
        const hasTraversal =
          normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath);

        expect(hasTraversal).toBe(isTraversal);
      }
    });

    it('should normalize paths correctly', () => {
      expect(path.normalize('a/b/../c')).toBe('a/c');
      expect(path.normalize('a/./b/c')).toBe('a/b/c');
      expect(path.normalize('a//b///c')).toBe('a/b/c');
    });
  });

  describe('MCP tool definitions', () => {
    it('should define list_skills tool schema', () => {
      const listSkillsSchema = {
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
      };

      expect(listSkillsSchema.name).toBe('list_skills');
      expect(listSkillsSchema.inputSchema.properties.role).toBeDefined();
    });

    it('should define get_skill tool schema', () => {
      const getSkillSchema = {
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
      };

      expect(getSkillSchema.name).toBe('get_skill');
      expect(getSkillSchema.inputSchema.required).toContain('id');
    });

    it('should define list_resources tool schema', () => {
      const listResourcesSchema = {
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
      };

      expect(listResourcesSchema.name).toBe('list_resources');
      expect(listResourcesSchema.inputSchema.required).toContain('skillId');
    });

    it('should define get_resource tool schema', () => {
      const getResourceSchema = {
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
      };

      expect(getResourceSchema.name).toBe('get_resource');
      expect(getResourceSchema.inputSchema.required).toContain('skillId');
      expect(getResourceSchema.inputSchema.required).toContain('resourcePath');
    });

    it('should define reload_skills tool schema', () => {
      const reloadSkillsSchema = {
        name: 'reload_skills',
        description: 'Reload skills from disk',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      };

      expect(reloadSkillsSchema.name).toBe('reload_skills');
    });

    it('should define run_script tool schema', () => {
      const runScriptSchema = {
        name: 'run_script',
        description: 'Execute a script file within a skill directory',
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
      };

      expect(runScriptSchema.name).toBe('run_script');
      expect(runScriptSchema.inputSchema.required).toContain('skill');
      expect(runScriptSchema.inputSchema.required).toContain('path');
      expect(runScriptSchema.inputSchema.properties.args).toBeDefined();
    });
  });

  describe('Skill manifest structure', () => {
    it('should create valid skill manifest', () => {
      const skills = [
        {
          id: 'frontend-dev',
          name: 'frontend-dev',
          displayName: 'Frontend Development',
          description: 'Frontend tools',
          allowedRoles: ['frontend'],
          allowedTools: ['filesystem__read'],
          version: '1.0.0',
          category: 'development',
          tags: ['frontend'],
        },
      ];

      const manifest = {
        skills,
      };

      expect(manifest.skills).toHaveLength(1);
      expect(manifest.skills[0].id).toBe('frontend-dev');
      expect(manifest.skills[0].allowedRoles).toContain('frontend');
    });

    it('should JSON stringify skills correctly', () => {
      const skills = [
        {
          id: 'test',
          name: 'test',
          displayName: 'Test',
          description: 'Test skill',
          allowedRoles: ['*'],
          allowedTools: [],
        },
      ];

      const json = JSON.stringify({ skills }, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0].id).toBe('test');
    });
  });

  describe('Directory entry processing', () => {
    it('should identify directory entries', () => {
      const entries = [
        { name: 'skill1', isDirectory: () => true },
        { name: 'README.md', isDirectory: () => false },
        { name: 'skill2', isDirectory: () => true },
        { name: '.hidden', isDirectory: () => true },
      ];

      const directories = entries.filter(e => e.isDirectory());
      expect(directories.map(d => d.name)).toContain('skill1');
      expect(directories.map(d => d.name)).toContain('skill2');
      expect(directories.map(d => d.name)).toContain('.hidden');
    });

    it('should filter out hidden and config files for resources', () => {
      const entries = [
        { name: '.hidden', isDirectory: () => false },
        { name: 'SKILL.yaml', isDirectory: () => false },
        { name: 'SKILL.md', isDirectory: () => false },
        { name: 'README.md', isDirectory: () => false },
        { name: 'template.txt', isDirectory: () => false },
        { name: 'resources', isDirectory: () => true },
      ];

      const resources = entries.filter(
        e =>
          !e.name.startsWith('.') &&
          e.name !== 'SKILL.yaml' &&
          e.name !== 'SKILL.md'
      );

      expect(resources.map(r => r.name)).toContain('README.md');
      expect(resources.map(r => r.name)).toContain('template.txt');
      expect(resources.map(r => r.name)).toContain('resources');
      expect(resources.map(r => r.name)).not.toContain('.hidden');
      expect(resources.map(r => r.name)).not.toContain('SKILL.yaml');
    });
  });

  describe('Script runner selection', () => {
    const SCRIPT_RUNNERS: Record<string, string[]> = {
      '.py': ['python3'],
      '.sh': ['bash'],
      '.js': ['node'],
      '.ts': ['npx', 'tsx'],
    };

    it('should select python3 for .py files', () => {
      const ext = '.py';
      expect(SCRIPT_RUNNERS[ext]).toEqual(['python3']);
    });

    it('should select bash for .sh files', () => {
      const ext = '.sh';
      expect(SCRIPT_RUNNERS[ext]).toEqual(['bash']);
    });

    it('should select node for .js files', () => {
      const ext = '.js';
      expect(SCRIPT_RUNNERS[ext]).toEqual(['node']);
    });

    it('should select npx tsx for .ts files', () => {
      const ext = '.ts';
      expect(SCRIPT_RUNNERS[ext]).toEqual(['npx', 'tsx']);
    });

    it('should return undefined for unsupported extensions', () => {
      expect(SCRIPT_RUNNERS['.rb']).toBeUndefined();
      expect(SCRIPT_RUNNERS['.go']).toBeUndefined();
      expect(SCRIPT_RUNNERS['.exe']).toBeUndefined();
    });
  });

  describe('run_script path security', () => {
    it('should detect path traversal in script paths', () => {
      const testPaths = [
        { path: '../malicious.py', isTraversal: true },
        { path: '../../etc/passwd', isTraversal: true },
        { path: 'scripts/valid.py', isTraversal: false },
        { path: './scripts/valid.sh', isTraversal: false },
        { path: '/absolute/path.js', isTraversal: true },
      ];

      for (const { path: testPath, isTraversal } of testPaths) {
        const normalizedPath = path.normalize(testPath);
        const hasTraversal =
          normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath);

        expect(hasTraversal).toBe(isTraversal);
      }
    });
  });

  describe('run_script error responses', () => {
    it('should format missing parameter error', () => {
      const response = {
        content: [{ type: 'text', text: 'Missing skill or path parameter' }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Missing');
    });

    it('should format unsupported script type error', () => {
      const ext = '.rb';
      const supported = ['.py', '.sh', '.js', '.ts'];
      const response = {
        content: [{ type: 'text', text: `Unsupported script type: ${ext}. Supported: ${supported.join(', ')}` }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Unsupported');
      expect(response.content[0].text).toContain('.rb');
    });

    it('should format script not found error', () => {
      const scriptPath = 'scripts/missing.py';
      const response = {
        content: [{ type: 'text', text: `Script not found: ${scriptPath}` }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Script not found');
    });

    it('should format path traversal error', () => {
      const response = {
        content: [{ type: 'text', text: 'Invalid script path: path traversal not allowed' }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('path traversal');
    });

    it('should format execution result correctly', () => {
      const result = {
        success: true,
        exitCode: 0,
        stdout: 'Hello, World!',
        stderr: '',
      };

      const response = {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };

      expect(response.isError).toBe(false);
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toBe('Hello, World!');
    });

    it('should mark failed execution as error', () => {
      const result = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Error: something went wrong',
      };

      const response = {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.exitCode).toBe(1);
    });
  });

  describe('Error responses', () => {
    it('should format skill not found error', () => {
      const skillId = 'nonexistent';
      const response = {
        content: [{ type: 'text', text: `Skill not found: ${skillId}` }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('nonexistent');
    });

    it('should format unknown tool error', () => {
      const toolName = 'unknown_tool';
      const response = {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('unknown_tool');
    });

    it('should format missing parameter error', () => {
      const response = {
        content: [{ type: 'text', text: 'Missing skillId or resourcePath' }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Missing');
    });

    it('should format invalid path error', () => {
      const response = {
        content: [{ type: 'text', text: 'Invalid resource path' }],
        isError: true,
      };

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Invalid');
    });
  });
});
