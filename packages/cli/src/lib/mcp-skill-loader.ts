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

/** Source of loaded skills */
export type SkillSource = 'mcp' | 'disk' | 'hardcoded';

/** Result of skill loading with source tracking */
export interface SkillLoadResult {
  skills: SkillDefinition[];
  source: SkillSource;
  error?: string;
}

export interface MCPSkillLoaderOptions {
  /** User role to filter skills */
  role?: string;
  /** Timeout for MCP connection (ms) */
  timeout?: number;
  /** Fall back to disk if MCP fails */
  fallbackToDisk?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
}

/** Minimal hardcoded skills as last resort */
const MINIMAL_HARDCODED_SKILLS: SkillDefinition[] = [
  {
    id: 'common',
    displayName: 'Common',
    description: '基本的なスキル情報の取得',
    allowedRoles: ['*'],
    allowedTools: [
      'mycelium-skills__get_skill',
      'mycelium-skills__list_skills',
    ],
  },
];

/**
 * Load skills with source tracking
 * Priority: MCP → Disk → Hardcoded
 */
export async function loadSkillsWithSource(
  options: MCPSkillLoaderOptions = {}
): Promise<SkillLoadResult> {
  const { role, timeout = 10000, fallbackToDisk = true, verbose = false } = options;

  // Get MCP server path
  const projectRoot = process.cwd();
  const monorepoPath = join(projectRoot, 'packages', 'skills', 'dist', 'index.js');
  const installedPath = join(projectRoot, 'node_modules', '@mycelium', 'skills', 'dist', 'index.js');
  const skillsServerPath = existsSync(monorepoPath) ? monorepoPath : installedPath;
  const skillsDir = join(projectRoot, 'packages', 'skills', 'skills');

  const client = new MCPClient('node', [skillsServerPath, skillsDir]);

  // 1. Try MCP server (preferred source)
  try {
    const connectPromise = client.connect();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MCP connection timeout')), timeout)
    );

    await Promise.race([connectPromise, timeoutPromise]);
    const result = await client.listSkills(role);

    const skills: SkillDefinition[] = result.skills.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      description: s.description,
      allowedRoles: s.allowedRoles,
      allowedTools: s.allowedTools,
      triggers: s.triggers,
    }));

    client.disconnect();

    if (skills.length > 0) {
      if (verbose) {
        console.log(`[SkillLoader] MCP: ${skills.length} skills loaded`);
      }
      return { skills, source: 'mcp' };
    }
  } catch (error) {
    client.disconnect();
    const errorMsg = (error as Error).message;
    if (verbose) {
      console.error(`[SkillLoader] MCP failed: ${errorMsg}`);
    }

    // 2. Try disk fallback
    if (fallbackToDisk) {
      try {
        const diskSkills = await loadSkillsFromDisk();
        if (diskSkills.length > 0) {
          if (verbose) {
            console.warn(`[SkillLoader] Disk fallback: ${diskSkills.length} skills loaded`);
          }
          return { skills: diskSkills, source: 'disk', error: errorMsg };
        }
      } catch (diskError) {
        if (verbose) {
          console.error(`[SkillLoader] Disk failed: ${(diskError as Error).message}`);
        }
      }
    }

    // 3. Final fallback to hardcoded
    if (verbose) {
      console.error('[SkillLoader] All sources failed, using hardcoded minimal skills');
    }
    return {
      skills: MINIMAL_HARDCODED_SKILLS,
      source: 'hardcoded',
      error: 'MCP and disk loading failed',
    };
  }

  // Empty MCP result, try disk
  if (fallbackToDisk) {
    try {
      const diskSkills = await loadSkillsFromDisk();
      if (diskSkills.length > 0) {
        return { skills: diskSkills, source: 'disk' };
      }
    } catch {
      // Fall through to hardcoded
    }
  }

  return { skills: MINIMAL_HARDCODED_SKILLS, source: 'hardcoded' };
}

/**
 * Load skills from MCP server (simple interface)
 * Falls back to disk if MCP fails
 */
export async function loadSkillsFromMCP(
  options: MCPSkillLoaderOptions = {}
): Promise<SkillDefinition[]> {
  const result = await loadSkillsWithSource(options);
  return result.skills;
}

/**
 * Initialize skills with MCP preference
 * Returns skills and source for logging
 */
export async function initializeSkills(
  role: string = 'developer',
  verbose: boolean = false
): Promise<SkillLoadResult> {
  const result = await loadSkillsWithSource({ role, fallbackToDisk: true, verbose });

  // Warn if skill count is suspiciously low
  if (result.skills.length < 3 && verbose) {
    console.warn(`[SkillLoader] Warning: Only ${result.skills.length} skills loaded (expected more)`);
  }

  return result;
}
