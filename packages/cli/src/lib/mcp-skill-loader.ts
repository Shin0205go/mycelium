/**
 * MCP-based Skill Loader
 *
 * Loads skills from mycelium-skills MCP server.
 * Falls back to disk loading if MCP fails.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { MCPClient } from './mcp-client.js';
import { loadSkillsFromDisk } from './skill-loader.js';
import type { SkillDefinition } from '@mycelium/shared';

export interface MCPSkillLoaderOptions {
  /** User role to filter skills */
  role?: string;
  /** Timeout for MCP connection (ms) */
  timeout?: number;
  /** Fall back to disk if MCP fails */
  fallbackToDisk?: boolean;
}

/**
 * Load skills from MCP server
 */
export async function loadSkillsFromMCP(
  options: MCPSkillLoaderOptions = {}
): Promise<SkillDefinition[]> {
  const { role, timeout = 10000, fallbackToDisk = true } = options;

  // Get MCP server path
  const projectRoot = process.cwd();
  const monorepoPath = join(projectRoot, 'packages', 'skills', 'dist', 'index.js');
  const installedPath = join(projectRoot, 'node_modules', '@mycelium', 'skills', 'dist', 'index.js');
  const skillsServerPath = existsSync(monorepoPath) ? monorepoPath : installedPath;
  const skillsDir = join(projectRoot, 'packages', 'skills', 'skills');

  const client = new MCPClient('node', [skillsServerPath, skillsDir]);

  try {
    // Connect with timeout
    const connectPromise = client.connect();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MCP connection timeout')), timeout)
    );

    await Promise.race([connectPromise, timeoutPromise]);

    // Fetch skills
    const result = await client.listSkills(role);

    // Convert to SkillDefinition format
    const skills: SkillDefinition[] = result.skills.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      description: s.description,
      allowedRoles: s.allowedRoles,
      allowedTools: s.allowedTools,
      triggers: s.triggers,
    }));

    client.disconnect();
    return skills;
  } catch (error) {
    client.disconnect();

    if (fallbackToDisk) {
      console.error(`MCP skill loading failed, falling back to disk: ${(error as Error).message}`);
      return loadSkillsFromDisk();
    }

    throw error;
  }
}

/**
 * Initialize skills with MCP preference
 * - First tries MCP server
 * - Falls back to disk loading
 */
export async function initializeSkills(
  role: string = 'developer'
): Promise<SkillDefinition[]> {
  return loadSkillsFromMCP({ role, fallbackToDisk: true });
}
