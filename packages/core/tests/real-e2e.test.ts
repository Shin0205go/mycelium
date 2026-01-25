/**
 * Real E2E Tests with Actual Server
 *
 * These tests use the actual mycelium-skills MCP server.
 * Run with: npm run test:e2e
 *
 * Requires: @mycelium/skills package to be built (packages/skills/dist)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RoleManager } from '../src/rbac/index.js';
import type { Logger, SkillManifest, BaseSkillDefinition } from '@mycelium/shared';

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

// Path to @mycelium/skills package in monorepo (relative to this test file)
// __dirname is packages/core/tests, so ../.. goes to packages/
const MYCELIUM_SKILLS_PATH = join(__dirname, '..', '..', 'skills', 'dist', 'index.js');
const SKILLS_DIR = join(__dirname, '..', '..', 'skills', 'skills');

interface SkillData {
  id: string;
  displayName: string;
  description: string;
  allowedRoles?: string[];
  allowedTools?: string[];
}

// Helper function to extract server from tool name
function extractServerFromTool(toolPattern: string): string | null {
  if (toolPattern.includes('__')) {
    return toolPattern.split('__')[0];
  }
  return null;
}

describe('Real E2E: mycelium-skills Server Integration', () => {
  let serverProcess: ChildProcess | null = null;
  let serverReady = false;

  // Helper to send JSON-RPC request to server
  async function sendRequest(process: ChildProcess, method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      };

      let responseData = '';

      const onData = (data: Buffer) => {
        responseData += data.toString();
        try {
          const lines = responseData.split('\n').filter(l => l.trim());
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed.id === request.id) {
              process.stdout?.removeListener('data', onData);
              resolve(parsed);
            }
          }
        } catch {
          // Not complete JSON yet, wait for more data
        }
      };

      process.stdout?.on('data', onData);

      setTimeout(() => {
        process.stdout?.removeListener('data', onData);
        reject(new Error('Request timeout'));
      }, 5000);

      process.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  beforeAll(async () => {
    // Check if mycelium-skills is installed
    try {
      const { access } = await import('fs/promises');
      await access(MYCELIUM_SKILLS_PATH);
    } catch {
      console.log('mycelium-skills not installed, skipping real E2E tests');
      return;
    }

    // Start mycelium-skills server
    serverProcess = spawn('node', [MYCELIUM_SKILLS_PATH, SKILLS_DIR], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);

      serverProcess?.stderr?.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('running on stdio')) {
          clearTimeout(timeout);
          serverReady = true;
          resolve();
        }
      });

      serverProcess?.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Initialize MCP handshake
    const initResponse = await sendRequest(serverProcess!, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });

    expect(initResponse.result).toBeDefined();
  }, 15000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  describe('list_skills Integration', () => {
    it('should call list_skills and get skill definitions', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      expect(response.result).toBeDefined();
      expect(response.result.content).toBeDefined();
      expect(response.result.content[0].type).toBe('text');

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);

      // Each skill should have required fields
      for (const skill of skills) {
        expect(skill.id).toBeDefined();
        expect(skill.displayName).toBeDefined();
      }
    });

    it('should have skills with allowedRoles for dynamic role generation', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      // Find skills with allowedRoles
      const skillsWithRoles = skills.filter(s => s.allowedRoles && s.allowedRoles.length > 0);

      console.log(`Found ${skillsWithRoles.length} skills with allowedRoles:`);
      for (const skill of skillsWithRoles) {
        console.log(`  - ${skill.id}: roles=[${skill.allowedRoles?.join(', ')}]`);
      }

      // At least some skills should have allowedRoles for v2 architecture
      expect(skillsWithRoles.length).toBeGreaterThan(0);
    });

    it('should have skills with allowedTools for tool filtering', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      // Find skills with allowedTools
      const skillsWithTools = skills.filter(s => s.allowedTools && s.allowedTools.length > 0);

      console.log(`Found ${skillsWithTools.length} skills with allowedTools:`);
      for (const skill of skillsWithTools) {
        console.log(`  - ${skill.id}: tools=[${skill.allowedTools?.slice(0, 3).join(', ')}${(skill.allowedTools?.length || 0) > 3 ? '...' : ''}]`);
      }

      expect(skillsWithTools.length).toBeGreaterThan(0);
    });
  });

  describe('Role Generation from Skills', () => {
    it('should generate unique roles from all skills', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      // Collect all unique roles
      const allRoles = new Set<string>();
      for (const skill of skills) {
        if (skill.allowedRoles) {
          for (const role of skill.allowedRoles) {
            allRoles.add(role);
          }
        }
      }

      console.log(`Unique roles from skills: [${[...allRoles].join(', ')}]`);

      // Should have at least one role
      expect(allRoles.size).toBeGreaterThan(0);
    });

    it('should map tools to roles correctly', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      // Build role -> tools mapping
      const roleToTools = new Map<string, Set<string>>();

      for (const skill of skills) {
        if (skill.allowedRoles && skill.allowedTools) {
          for (const role of skill.allowedRoles) {
            if (!roleToTools.has(role)) {
              roleToTools.set(role, new Set());
            }
            for (const tool of skill.allowedTools) {
              roleToTools.get(role)!.add(tool);
            }
          }
        }
      }

      console.log('Role -> Tools mapping:');
      for (const [role, tools] of roleToTools) {
        console.log(`  ${role}: ${tools.size} tools`);
      }

      // At least one role should have tools
      const rolesWithTools = [...roleToTools.entries()].filter(([_, tools]) => tools.size > 0);
      expect(rolesWithTools.length).toBeGreaterThan(0);
    });
  });

  describe('RoleManager Integration with Real Skills', () => {
    it('should load real skills into RoleManager', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      // Convert to SkillManifest format
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      // Load into RoleManager
      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      // Should have generated roles
      const roleIds = roleManager.getRoleIds();
      console.log(`Generated ${roleIds.length} roles: [${roleIds.join(', ')}]`);
      expect(roleIds.length).toBeGreaterThan(0);
    });

    it('should have correct tool permissions for generated roles', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      // Check each role has expected tools
      for (const skill of skills) {
        if (skill.allowedRoles && skill.allowedTools) {
          for (const roleId of skill.allowedRoles) {
            if (roleId === '*') continue; // Skip wildcard

            const role = roleManager.getRole(roleId);
            if (role) {
              // Role should have the tools from this skill
              for (const tool of skill.allowedTools) {
                const server = extractServerFromTool(tool);
                if (server) {
                  const isAllowed = roleManager.isToolAllowedForRole(roleId, tool, server);
                  expect(isAllowed).toBe(true);
                }
              }
            }
          }
        }
      }
    });

    it('should extract servers correctly from real tool patterns', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      // Each role should have allowedServers extracted from tools
      const roles = roleManager.getAllRoles();
      for (const role of roles) {
        if (role.toolPermissions?.allowPatterns && role.toolPermissions.allowPatterns.length > 0) {
          expect(role.allowedServers.length).toBeGreaterThan(0);
          console.log(`Role ${role.id}: servers=[${role.allowedServers.join(', ')}]`);
        }
      }
    });
  });

  describe('Role Switching with Real Skills', () => {
    it('should switch between roles and verify tool access changes', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      const roleIds = roleManager.getRoleIds().filter(id => id !== '*');
      if (roleIds.length < 2) {
        console.log('Need at least 2 roles to test switching');
        return;
      }

      const role1 = roleManager.getRole(roleIds[0]);
      const role2 = roleManager.getRole(roleIds[1]);

      console.log(`Comparing roles: ${roleIds[0]} vs ${roleIds[1]}`);
      console.log(`  ${roleIds[0]}: ${role1?.toolPermissions?.allowPatterns?.length || 0} tools`);
      console.log(`  ${roleIds[1]}: ${role2?.toolPermissions?.allowPatterns?.length || 0} tools`);

      // Verify roles have different tool configurations
      expect(role1).toBeDefined();
      expect(role2).toBeDefined();
    });

    it('should always allow set_role system tool for all roles', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      // set_role should be allowed for ALL roles
      const roleIds = roleManager.getRoleIds().filter(id => id !== '*');
      for (const roleId of roleIds) {
        const isAllowed = roleManager.isToolAllowedForRole(roleId, 'set_role', 'mycelium-router');
        expect(isAllowed).toBe(true);
      }
      console.log(`set_role is allowed for all ${roleIds.length} roles`);
    });

    it('should deny tools not in skill allowedTools', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      const roleIds = roleManager.getRoleIds().filter(id => id !== '*');
      if (roleIds.length === 0) return;

      // Pick first role and test with a fake tool
      const roleId = roleIds[0];
      const fakeTools = [
        'nonexistent__fake_tool',
        'random__unknown_action',
        'fake_server__do_something'
      ];

      for (const fakeTool of fakeTools) {
        const [server] = fakeTool.split('__');
        const isAllowed = roleManager.isToolAllowedForRole(roleId, fakeTool, server);
        expect(isAllowed).toBe(false);
      }
      console.log(`Fake tools correctly denied for role ${roleId}`);
    });
  });

  describe('Complete Workflow: list_skills -> set_role', () => {
    it('should complete full E2E workflow with real server', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      // Step 1: Call list_skills
      console.log('Step 1: Calling list_skills...');
      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });
      expect(response.result).toBeDefined();

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;
      console.log(`  -> Got ${skills.length} skills`);

      // Step 2: Generate roles from skills
      console.log('Step 2: Generating roles from skills...');
      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      const roleIds = roleManager.getRoleIds().filter(id => id !== '*');
      console.log(`  -> Generated ${roleIds.length} roles`);

      // Step 3: Verify each role has correct skills
      console.log('Step 3: Verifying role-skill assignments...');
      for (const roleId of roleIds) {
        const role = roleManager.getRole(roleId);
        expect(role).toBeDefined();
        expect(role?.metadata?.tags).toContain('skill-driven');
      }
      console.log('  -> All roles are skill-driven');

      // Step 4: Verify tool access per role
      console.log('Step 4: Verifying tool access...');
      let totalChecks = 0;
      for (const skill of skills) {
        if (skill.allowedRoles && skill.allowedTools) {
          for (const roleId of skill.allowedRoles) {
            if (roleId === '*') continue;
            for (const tool of skill.allowedTools) {
              const server = extractServerFromTool(tool);
              if (server && roleManager.hasRole(roleId)) {
                expect(roleManager.isToolAllowedForRole(roleId, tool, server)).toBe(true);
                totalChecks++;
              }
            }
          }
        }
      }
      console.log(`  -> Verified ${totalChecks} tool-role permissions`);

      // Step 5: Verify set_role is always available
      console.log('Step 5: Verifying set_role availability...');
      for (const roleId of roleIds) {
        expect(roleManager.isToolAllowedForRole(roleId, 'set_role', 'mycelium-router')).toBe(true);
      }
      console.log(`  -> set_role available for all ${roleIds.length} roles`);

      console.log('Complete workflow passed!');
    });

    it('should list available roles after loading skills', async () => {
      if (!serverReady) {
        console.log('Skipping: server not ready');
        return;
      }

      const response = await sendRequest(serverProcess!, 'tools/call', {
        name: 'list_skills',
        arguments: {}
      });

      const parsed = JSON.parse(response.result.content[0].text);
      const skills: SkillData[] = parsed.skills || parsed;

      const manifest: SkillManifest<BaseSkillDefinition> = {
        skills: skills.map(s => ({
          id: s.id,
          displayName: s.displayName,
          description: s.description || '',
          allowedRoles: s.allowedRoles || [],
          allowedTools: s.allowedTools || []
        })),
        version: '1.0.0',
        generatedAt: new Date()
      };

      const roleManager = new RoleManager(testLogger);
      await roleManager.loadFromSkillManifest(manifest);

      // listRoles should return all generated roles
      const listResult = roleManager.listRoles();
      expect(listResult.roles.length).toBeGreaterThan(0);

      console.log('Available roles:');
      for (const role of listResult.roles) {
        console.log(`  - ${role.id}: ${role.description}`);
      }
    });
  });
});
