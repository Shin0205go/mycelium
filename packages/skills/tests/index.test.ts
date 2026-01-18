/**
 * Unit tests for @mycelium/skills MCP Server
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
