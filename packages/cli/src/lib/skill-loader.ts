/**
 * Skill Loader - Load skill definitions from disk
 *
 * Loads skills directly from packages/skills/skills directory
 * for faster startup without MCP server roundtrip.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import type { SkillDefinition } from '@mycelium/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Raw YAML structure from SKILL.yaml
 */
interface RawSkillYaml {
  name?: string;
  description?: string;
  id?: string;
  displayName?: string;
  allowedRoles?: string[];
  'allowed-roles'?: string[];
  allowedTools?: string[];
  'allowed-tools'?: string[];
  triggers?: string[];
}

/**
 * Default skills directory (relative to CLI package)
 */
function getDefaultSkillsDir(): string {
  // From packages/cli/dist/lib -> packages/skills/skills
  // __dirname = packages/cli/dist/lib
  // .. -> packages/cli/dist
  // .. -> packages/cli
  // .. -> packages
  // skills/skills -> packages/skills/skills
  return path.resolve(__dirname, '..', '..', '..', 'skills', 'skills');
}

/**
 * Parse SKILL.yaml content
 */
function parseSkillYaml(content: string): RawSkillYaml {
  try {
    return (yaml.load(content) as RawSkillYaml) || {};
  } catch {
    return {};
  }
}

/**
 * Load all skills from the skills directory
 */
export async function loadSkillsFromDisk(
  skillsDir?: string
): Promise<SkillDefinition[]> {
  const dir = skillsDir || getDefaultSkillsDir();
  const skills: SkillDefinition[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(dir, entry.name);
      const yamlPath = path.join(skillDir, 'SKILL.yaml');

      try {
        const content = await fs.readFile(yamlPath, 'utf-8');
        const manifest = parseSkillYaml(content);

        const skillName = manifest.name || manifest.id;
        const skillId = manifest.id || manifest.name;
        const allowedRoles =
          manifest.allowedRoles || manifest['allowed-roles'] || [];
        const allowedTools =
          manifest.allowedTools || manifest['allowed-tools'] || [];

        if (skillName && allowedRoles.length > 0) {
          skills.push({
            id: skillId!,
            displayName: manifest.displayName || skillName,
            description: manifest.description || '',
            allowedRoles,
            allowedTools,
            triggers: manifest.triggers,
          });
        }
      } catch {
        // Skip skills without valid SKILL.yaml
      }
    }
  } catch (err) {
    console.error(`Failed to load skills from ${dir}:`, err);
  }

  return skills;
}

/**
 * Load skills that are allowed for a specific role
 */
export async function loadSkillsForRole(
  role: string,
  skillsDir?: string
): Promise<SkillDefinition[]> {
  const allSkills = await loadSkillsFromDisk(skillsDir);

  return allSkills.filter(
    (s) => s.allowedRoles.includes('*') || s.allowedRoles.includes(role)
  );
}

/**
 * Get skill IDs that are allowed for a specific role
 */
export async function getAllowedSkillIdsForRole(
  role: string,
  skillsDir?: string
): Promise<string[]> {
  const skills = await loadSkillsForRole(role, skillsDir);
  return skills.map((s) => s.id);
}
