// ============================================================================
// Memory Handler - Role-based Memory Tool Handlers
// ============================================================================

import { Logger } from '../utils/logger.js';
import { RoleManager, RoleMemoryStore } from '../rbac/index.js';
import type { Role } from '@mycelium/shared';

/**
 * MCP tool response format
 */
interface ToolResponse {
  result: {
    content: Array<{ type: string; text: string }>;
    isError: boolean;
  };
}

/**
 * MemoryHandler handles all memory-related tool calls
 * Extracted from MyceliumRouterCore for better separation of concerns
 */
export class MemoryHandler {
  private roleManager: RoleManager;
  private memoryStore: RoleMemoryStore;

  constructor(
    _logger: Logger,
    roleManager: RoleManager,
    memoryStore: RoleMemoryStore
  ) {
    this.roleManager = roleManager;
    this.memoryStore = memoryStore;
  }

  /**
   * Initialize the memory store
   */
  async initialize(): Promise<void> {
    await this.memoryStore.initialize();
  }

  /**
   * Check if the current role has memory access
   * Throws an error if access is denied
   */
  checkMemoryAccess(currentRole: Role | null): string {
    const roleId = currentRole?.id;
    if (!roleId) {
      throw new Error('No role selected. Use set_role first.');
    }

    if (!this.roleManager.hasMemoryAccess(roleId)) {
      throw new Error(
        `Role '${roleId}' does not have memory access. ` +
        `Memory access must be granted via a skill with grants.memory defined.`
      );
    }

    return roleId;
  }

  /**
   * Handle save_memory tool call
   */
  async handleSaveMemory(
    args: Record<string, any>,
    currentRole: Role | null
  ): Promise<ToolResponse> {
    try {
      const roleId = this.checkMemoryAccess(currentRole);

      const { content, type, tags, source } = args;
      if (!content) {
        throw new Error('content is required');
      }

      const entry = await this.memoryStore.addEntry(roleId, content, {
        type: type || 'context',
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
        source: source || 'agent'
      });

      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Memory saved successfully.\n\nID: ${entry.id}\nType: ${entry.type}\nContent: ${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}`
            }
          ],
          isError: false
        }
      };
    } catch (error) {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Error saving memory: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      };
    }
  }

  /**
   * Handle recall_memory tool call
   */
  async handleRecallMemory(
    args: Record<string, any>,
    currentRole: Role | null
  ): Promise<ToolResponse> {
    try {
      const roleId = this.checkMemoryAccess(currentRole);

      const { query, type, tags, limit, all_roles } = args;
      const canAccessAll = this.roleManager.canAccessAllMemories(roleId);

      // Roles with 'all' policy can search across all roles
      if (canAccessAll && all_roles) {
        const entries = await this.memoryStore.searchAll({
          query,
          type,
          tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
          limit: limit || 10
        });

        if (entries.length === 0) {
          return {
            result: {
              content: [
                {
                  type: 'text',
                  text: 'No memories found across all roles.'
                }
              ],
              isError: false
            }
          };
        }

        const formattedEntries = entries.map((e, i) =>
          `### ${i + 1}. [${e.sourceRole}] [${e.type}] ${e.id}\n${e.content}\n${e.tags ? `Tags: ${e.tags.join(', ')}` : ''}`
        ).join('\n\n');

        return {
          result: {
            content: [
              {
                type: 'text',
                text: `Found ${entries.length} memories across all roles:\n\n${formattedEntries}`
              }
            ],
            isError: false
          }
        };
      }

      // Normal search for current role
      const entries = await this.memoryStore.search(roleId, {
        query,
        type,
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
        limit: limit || 10
      });

      if (entries.length === 0) {
        return {
          result: {
            content: [
              {
                type: 'text',
                text: 'No memories found matching your criteria.'
              }
            ],
            isError: false
          }
        };
      }

      const formattedEntries = entries.map((e, i) =>
        `### ${i + 1}. [${e.type}] ${e.id}\n${e.content}\n${e.tags ? `Tags: ${e.tags.join(', ')}` : ''}`
      ).join('\n\n');

      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Found ${entries.length} memories:\n\n${formattedEntries}`
            }
          ],
          isError: false
        }
      };
    } catch (error) {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Error recalling memory: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      };
    }
  }

  /**
   * Handle list_memories tool call
   */
  async handleListMemories(
    args: Record<string, any>,
    currentRole: Role | null
  ): Promise<ToolResponse> {
    try {
      const currentRoleId = this.checkMemoryAccess(currentRole);
      const canAccessAll = this.roleManager.canAccessAllMemories(currentRoleId);
      const { all_roles } = args;

      // Roles with 'all' policy can see all roles' stats
      if (canAccessAll && all_roles) {
        const allStats = await this.memoryStore.getAllStats();
        const rolesWithMemory = Object.keys(allStats);

        if (rolesWithMemory.length === 0) {
          return {
            result: {
              content: [
                {
                  type: 'text',
                  text: 'No memories found across any role.'
                }
              ],
              isError: false
            }
          };
        }

        let totalEntries = 0;
        const roleBreakdown = rolesWithMemory.map(roleId => {
          const stats = allStats[roleId];
          totalEntries += stats.totalEntries;
          const types = Object.entries(stats.byType)
            .map(([t, c]) => `${t}:${c}`)
            .join(', ');
          return `  - **${roleId}**: ${stats.totalEntries} entries (${types || 'empty'})`;
        }).join('\n');

        return {
          result: {
            content: [
              {
                type: 'text',
                text: `📊 Memory Statistics (All Roles)\n\n` +
                  `Total entries across all roles: ${totalEntries}\n` +
                  `Roles with memory: ${rolesWithMemory.length}\n\n` +
                  `By role:\n${roleBreakdown}`
              }
            ],
            isError: false
          }
        };
      }

      // Normal: show current role's stats
      const roleId = args.role_id || currentRoleId;
      const stats = await this.memoryStore.getStats(roleId);

      const typeBreakdown = Object.entries(stats.byType)
        .map(([type, count]) => `  - ${type}: ${count}`)
        .join('\n');

      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Memory Statistics for role "${roleId}":\n\n` +
                `Total entries: ${stats.totalEntries}\n\n` +
                `By type:\n${typeBreakdown || '  (no entries)'}\n\n` +
                `Oldest: ${stats.oldestEntry?.toISOString() || 'N/A'}\n` +
                `Newest: ${stats.newestEntry?.toISOString() || 'N/A'}`
            }
          ],
          isError: false
        }
      };
    } catch (error) {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: `Error listing memories: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      };
    }
  }
}

/**
 * Factory function for MemoryHandler
 */
export function createMemoryHandler(
  logger: Logger,
  roleManager: RoleManager,
  memoryStore: RoleMemoryStore
): MemoryHandler {
  return new MemoryHandler(logger, roleManager, memoryStore);
}
