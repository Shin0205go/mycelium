// ============================================================================
// AEGIS Role Memory - Transparent Markdown-based Memory per Role
// Inspired by Claude's simple, editable file-based approach
// ============================================================================

import { promises as fs } from 'fs';
import path from 'path';
import type { Logger } from '@aegis/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * A single memory entry
 */
export interface MemoryEntry {
  /** Unique entry ID */
  id: string;

  /** When this memory was created */
  createdAt: Date;

  /** When this memory was last accessed */
  lastAccessedAt: Date;

  /** Memory type for categorization */
  type: 'fact' | 'preference' | 'context' | 'episode' | 'learned';

  /** The memory content */
  content: string;

  /** Optional tags for filtering */
  tags?: string[];

  /** Relevance score (updated on access) */
  relevance?: number;

  /** Source of this memory (tool call, user input, etc.) */
  source?: string;
}

/**
 * Role memory structure
 */
export interface RoleMemory {
  /** Role ID this memory belongs to */
  roleId: string;

  /** Memory entries */
  entries: MemoryEntry[];

  /** Memory metadata */
  metadata: {
    /** When this memory was created */
    createdAt: Date;
    /** When this memory was last modified */
    lastModifiedAt: Date;
    /** Total number of entries ever added */
    totalEntriesAdded: number;
    /** Version for future migrations */
    version: string;
  };
}

/**
 * Options for memory search
 */
export interface MemorySearchOptions {
  /** Filter by type */
  type?: MemoryEntry['type'];

  /** Filter by tags (any match) */
  tags?: string[];

  /** Maximum number of results */
  limit?: number;

  /** Minimum relevance score */
  minRelevance?: number;

  /** Text search query */
  query?: string;
}

/**
 * Options for saving memory
 */
export interface SaveMemoryOptions {
  /** Memory type */
  type?: MemoryEntry['type'];

  /** Tags for the memory */
  tags?: string[];

  /** Source of the memory */
  source?: string;
}

// ============================================================================
// RoleMemoryStore Implementation
// ============================================================================

/**
 * Role Memory Store - Manages persistent memory for each role
 *
 * Design principles (inspired by Claude's memory):
 * 1. Transparent: Stored as human-readable Markdown files
 * 2. Editable: Users can directly edit memory files
 * 3. Role-isolated: Each role has separate memory
 * 4. Simple: No complex vector DB, just text search
 */
export class RoleMemoryStore {
  private memoryDir: string;
  private cache: Map<string, RoleMemory> = new Map();
  private logger: Logger;
  // Simple per-role locks for concurrent access
  private locks: Map<string, Promise<void>> = new Map();
  // Roles that can access all memories (e.g., admin)
  private static readonly SUPER_ROLES = ['admin'];

  constructor(memoryDir: string = './memory', logger?: Logger) {
    this.memoryDir = memoryDir;
    this.logger = logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  /**
   * Check if a role has super access (can read all memories)
   */
  isSuperRole(roleId: string): boolean {
    return RoleMemoryStore.SUPER_ROLES.includes(roleId);
  }

  /**
   * Acquire a lock for a role (simple mutex)
   */
  private async withLock<T>(roleId: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing lock
    const existing = this.locks.get(roleId);
    if (existing) {
      await existing;
    }

    // Create new lock
    let resolve: () => void;
    const lock = new Promise<void>((r) => {
      resolve = r;
    });
    this.locks.set(roleId, lock);

    try {
      return await fn();
    } finally {
      resolve!();
      this.locks.delete(roleId);
    }
  }

  /**
   * Initialize the memory store
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      this.logger.info(`Memory store initialized at ${this.memoryDir}`);
    } catch (error) {
      this.logger.error('Failed to initialize memory store', { error });
      throw error;
    }
  }

  /**
   * Get the memory file path for a role
   */
  private getMemoryPath(roleId: string): string {
    const safeRoleId = roleId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.memoryDir, `${safeRoleId}.memory.md`);
  }

  /**
   * Load memory for a role
   */
  async load(roleId: string): Promise<RoleMemory> {
    // Check cache first
    const cached = this.cache.get(roleId);
    if (cached) {
      return cached;
    }

    const memoryPath = this.getMemoryPath(roleId);

    try {
      const content = await fs.readFile(memoryPath, 'utf-8');
      const memory = this.parseMarkdown(roleId, content);
      this.cache.set(roleId, memory);
      return memory;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Create new memory for this role
        const memory = this.createEmptyMemory(roleId);
        this.cache.set(roleId, memory);
        return memory;
      }
      throw error;
    }
  }

  /**
   * Save memory for a role
   */
  async save(roleId: string, memory: RoleMemory): Promise<void> {
    const memoryPath = this.getMemoryPath(roleId);
    const content = this.toMarkdown(memory);

    await fs.writeFile(memoryPath, content, 'utf-8');
    this.cache.set(roleId, memory);

    this.logger.debug(`Saved memory for role ${roleId}`, {
      entries: memory.entries.length,
    });
  }

  /**
   * Add a memory entry for a role
   */
  async addEntry(
    roleId: string,
    content: string,
    options: SaveMemoryOptions = {}
  ): Promise<MemoryEntry> {
    return this.withLock(roleId, async () => {
      const memory = await this.load(roleId);

      const entry: MemoryEntry = {
        id: this.generateId(),
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        type: options.type || 'context',
        content,
        tags: options.tags,
        source: options.source,
        relevance: 1.0,
      };

      memory.entries.push(entry);
      memory.metadata.lastModifiedAt = new Date();
      memory.metadata.totalEntriesAdded++;

      await this.save(roleId, memory);

      this.logger.info(`Added memory entry for role ${roleId}`, {
        entryId: entry.id,
        type: entry.type,
      });

      return entry;
    });
  }

  /**
   * Search memory entries
   */
  async search(
    roleId: string,
    options: MemorySearchOptions = {}
  ): Promise<MemoryEntry[]> {
    const memory = await this.load(roleId);
    let results = [...memory.entries];

    // Filter by type
    if (options.type) {
      results = results.filter((e) => e.type === options.type);
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      results = results.filter(
        (e) => e.tags && e.tags.some((t) => options.tags!.includes(t))
      );
    }

    // Filter by relevance
    if (options.minRelevance !== undefined) {
      results = results.filter(
        (e) => (e.relevance || 0) >= options.minRelevance!
      );
    }

    // Text search (simple contains)
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter((e) => e.content.toLowerCase().includes(query));
    }

    // Sort by relevance and recency
    results.sort((a, b) => {
      const relevanceA = a.relevance || 0;
      const relevanceB = b.relevance || 0;
      if (relevanceA !== relevanceB) {
        return relevanceB - relevanceA;
      }
      return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
    });

    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    // Update access time for returned entries
    const now = new Date();
    for (const entry of results) {
      entry.lastAccessedAt = now;
    }

    return results;
  }

  /**
   * Recall memory - get most relevant memories for a context
   */
  async recall(roleId: string, context: string, limit: number = 5): Promise<MemoryEntry[]> {
    return this.search(roleId, {
      query: context,
      limit,
    });
  }

  /**
   * Search across ALL roles (admin only)
   * Returns entries with their source role
   */
  async searchAll(
    options: MemorySearchOptions = {}
  ): Promise<Array<MemoryEntry & { sourceRole: string }>> {
    const allRoles = await this.listRolesWithMemory();
    const allResults: Array<MemoryEntry & { sourceRole: string }> = [];

    for (const roleId of allRoles) {
      const entries = await this.search(roleId, { ...options, limit: undefined });
      for (const entry of entries) {
        allResults.push({ ...entry, sourceRole: roleId });
      }
    }

    // Sort by relevance and recency
    allResults.sort((a, b) => {
      const relevanceA = a.relevance || 0;
      const relevanceB = b.relevance || 0;
      if (relevanceA !== relevanceB) {
        return relevanceB - relevanceA;
      }
      return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
    });

    // Apply limit
    if (options.limit) {
      return allResults.slice(0, options.limit);
    }

    return allResults;
  }

  /**
   * Get stats for ALL roles (admin only)
   */
  async getAllStats(): Promise<Record<string, {
    totalEntries: number;
    byType: Record<string, number>;
  }>> {
    const allRoles = await this.listRolesWithMemory();
    const result: Record<string, { totalEntries: number; byType: Record<string, number> }> = {};

    for (const roleId of allRoles) {
      const stats = await this.getStats(roleId);
      result[roleId] = {
        totalEntries: stats.totalEntries,
        byType: stats.byType,
      };
    }

    return result;
  }

  /**
   * Delete a memory entry
   */
  async deleteEntry(roleId: string, entryId: string): Promise<boolean> {
    const memory = await this.load(roleId);
    const index = memory.entries.findIndex((e) => e.id === entryId);

    if (index === -1) {
      return false;
    }

    memory.entries.splice(index, 1);
    memory.metadata.lastModifiedAt = new Date();

    await this.save(roleId, memory);
    return true;
  }

  /**
   * Clear all memory for a role
   */
  async clear(roleId: string): Promise<void> {
    const memory = this.createEmptyMemory(roleId);
    await this.save(roleId, memory);
    this.logger.info(`Cleared memory for role ${roleId}`);
  }

  /**
   * List all roles with memory
   */
  async listRolesWithMemory(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.memoryDir);
      return files
        .filter((f) => f.endsWith('.memory.md'))
        .map((f) => f.replace('.memory.md', ''));
    } catch {
      return [];
    }
  }

  /**
   * Get memory statistics for a role
   */
  async getStats(roleId: string): Promise<{
    totalEntries: number;
    byType: Record<string, number>;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  }> {
    const memory = await this.load(roleId);

    const byType: Record<string, number> = {};
    let oldestEntry: Date | null = null;
    let newestEntry: Date | null = null;

    for (const entry of memory.entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;

      if (!oldestEntry || entry.createdAt < oldestEntry) {
        oldestEntry = entry.createdAt;
      }
      if (!newestEntry || entry.createdAt > newestEntry) {
        newestEntry = entry.createdAt;
      }
    }

    return {
      totalEntries: memory.entries.length,
      byType,
      oldestEntry,
      newestEntry,
    };
  }

  // ============================================================================
  // Markdown Serialization (Human-readable format)
  // ============================================================================

  /**
   * Convert memory to Markdown format
   */
  private toMarkdown(memory: RoleMemory): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Memory: ${memory.roleId}`);
    lines.push('');
    lines.push(`> Last modified: ${memory.metadata.lastModifiedAt.toISOString()}`);
    lines.push(`> Total entries: ${memory.entries.length}`);
    lines.push(`> Version: ${memory.metadata.version}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Group entries by type
    const byType = new Map<string, MemoryEntry[]>();
    for (const entry of memory.entries) {
      const entries = byType.get(entry.type) || [];
      entries.push(entry);
      byType.set(entry.type, entries);
    }

    // Output each type section
    const typeOrder: MemoryEntry['type'][] = ['fact', 'preference', 'context', 'episode', 'learned'];

    for (const type of typeOrder) {
      const entries = byType.get(type);
      if (!entries || entries.length === 0) continue;

      lines.push(`## ${this.typeToHeading(type)}`);
      lines.push('');

      for (const entry of entries) {
        lines.push(`### [${entry.id}]`);
        lines.push('');
        lines.push(entry.content);
        lines.push('');

        // Metadata as HTML comment (preserved but hidden)
        const meta = {
          createdAt: entry.createdAt.toISOString(),
          lastAccessedAt: entry.lastAccessedAt.toISOString(),
          tags: entry.tags,
          source: entry.source,
          relevance: entry.relevance,
        };
        lines.push(`<!-- ${JSON.stringify(meta)} -->`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Parse Markdown back to memory structure
   */
  private parseMarkdown(roleId: string, content: string): RoleMemory {
    const memory = this.createEmptyMemory(roleId);
    const lines = content.split('\n');

    let currentType: MemoryEntry['type'] = 'context';
    let currentId: string | null = null;
    let currentContent: string[] = [];
    let currentMeta: Partial<MemoryEntry> = {};

    const saveCurrentEntry = () => {
      if (currentId && currentContent.length > 0) {
        const entry: MemoryEntry = {
          id: currentId,
          type: currentType,
          content: currentContent.join('\n').trim(),
          createdAt: currentMeta.createdAt ? new Date(currentMeta.createdAt) : new Date(),
          lastAccessedAt: currentMeta.lastAccessedAt
            ? new Date(currentMeta.lastAccessedAt)
            : new Date(),
          tags: currentMeta.tags,
          source: currentMeta.source,
          relevance: currentMeta.relevance ?? 1.0,
        };
        memory.entries.push(entry);
      }
      currentId = null;
      currentContent = [];
      currentMeta = {};
    };

    for (const line of lines) {
      // Type heading (## Facts, ## Preferences, etc.)
      const typeMatch = line.match(/^## (.+)$/);
      if (typeMatch) {
        saveCurrentEntry();
        currentType = this.headingToType(typeMatch[1]);
        continue;
      }

      // Entry ID (### [abc123])
      const idMatch = line.match(/^### \[([^\]]+)\]$/);
      if (idMatch) {
        saveCurrentEntry();
        currentId = idMatch[1];
        continue;
      }

      // Metadata comment (<!-- {...} -->)
      const metaMatch = line.match(/^<!-- ({.+}) -->$/);
      if (metaMatch) {
        try {
          currentMeta = JSON.parse(metaMatch[1]);
        } catch {
          // Ignore parse errors
        }
        continue;
      }

      // Skip header lines
      if (line.startsWith('# Memory:') || line.startsWith('> ') || line === '---') {
        continue;
      }

      // Content line
      if (currentId) {
        currentContent.push(line);
      }
    }

    // Save last entry
    saveCurrentEntry();

    // Update metadata
    memory.metadata.lastModifiedAt = new Date();

    return memory;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private createEmptyMemory(roleId: string): RoleMemory {
    return {
      roleId,
      entries: [],
      metadata: {
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        totalEntriesAdded: 0,
        version: '1.0',
      },
    };
  }

  private generateId(): string {
    return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private typeToHeading(type: MemoryEntry['type']): string {
    const map: Record<MemoryEntry['type'], string> = {
      fact: 'Facts',
      preference: 'Preferences',
      context: 'Context',
      episode: 'Episodes',
      learned: 'Learned Patterns',
    };
    return map[type] || 'Other';
  }

  private headingToType(heading: string): MemoryEntry['type'] {
    const map: Record<string, MemoryEntry['type']> = {
      Facts: 'fact',
      Preferences: 'preference',
      Context: 'context',
      Episodes: 'episode',
      'Learned Patterns': 'learned',
    };
    return map[heading] || 'context';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new RoleMemoryStore instance
 */
export function createRoleMemoryStore(memoryDir?: string, logger?: Logger): RoleMemoryStore {
  return new RoleMemoryStore(memoryDir, logger);
}
