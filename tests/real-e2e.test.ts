/**
 * Real E2E Tests with Actual Server
 *
 * These tests use the actual aegis-skills MCP server.
 * Run with: npm run test:e2e
 *
 * Requires: node_modules/aegis-skills to be installed
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

// Skip if aegis-skills is not installed
const AEGIS_SKILLS_PATH = join(process.cwd(), 'node_modules/aegis-skills/index.js');
const SKILLS_DIR = join(process.cwd(), 'node_modules/aegis-skills/skills');

interface SkillData {
  id: string;
  displayName: string;
  description: string;
  allowedRoles?: string[];
  allowedTools?: string[];
}

describe('Real E2E: aegis-skills Server Integration', () => {
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
    // Check if aegis-skills is installed
    try {
      const { access } = await import('fs/promises');
      await access(AEGIS_SKILLS_PATH);
    } catch {
      console.log('⚠️ aegis-skills not installed, skipping real E2E tests');
      return;
    }

    // Start aegis-skills server
    serverProcess = spawn('node', [AEGIS_SKILLS_PATH, SKILLS_DIR], {
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
});
