/**
 * Role Memory Tests
 *
 * Tests covering role-based memory isolation:
 * 1. Memory CRUD operations
 * 2. Role isolation (memories don't leak between roles)
 * 3. Memory persistence (Markdown format)
 * 4. Search and recall functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RoleMemoryStore } from '../src/role-memory.js';
import type { Logger } from '@mycelium/shared';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock logger for tests
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('RoleMemoryStore', () => {
  let memoryStore: RoleMemoryStore;
  let testMemoryDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testMemoryDir = join(tmpdir(), `aegis-memory-test-${Date.now()}`);
    memoryStore = new RoleMemoryStore(testMemoryDir, testLogger);
    await memoryStore.initialize();
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testMemoryDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic CRUD Operations', () => {
    it('should save and recall a memory entry', async () => {
      const entry = await memoryStore.addEntry('frontend', 'User prefers React', {
        type: 'preference',
        tags: ['framework'],
      });

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe('preference');
      expect(entry.content).toBe('User prefers React');

      const results = await memoryStore.search('frontend', { query: 'React' });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('User prefers React');
    });

    it('should store multiple memory entries', async () => {
      await memoryStore.addEntry('frontend', 'Memory 1', { type: 'fact' });
      await memoryStore.addEntry('frontend', 'Memory 2', { type: 'context' });
      await memoryStore.addEntry('frontend', 'Memory 3', { type: 'preference' });

      const stats = await memoryStore.getStats('frontend');
      expect(stats.totalEntries).toBe(3);
      expect(stats.byType['fact']).toBe(1);
      expect(stats.byType['context']).toBe(1);
      expect(stats.byType['preference']).toBe(1);
    });

    it('should delete a memory entry', async () => {
      const entry = await memoryStore.addEntry('frontend', 'To be deleted', {
        type: 'context',
      });

      const deleted = await memoryStore.deleteEntry('frontend', entry.id);
      expect(deleted).toBe(true);

      const stats = await memoryStore.getStats('frontend');
      expect(stats.totalEntries).toBe(0);
    });

    it('should clear all memories for a role', async () => {
      await memoryStore.addEntry('frontend', 'Memory 1', { type: 'fact' });
      await memoryStore.addEntry('frontend', 'Memory 2', { type: 'fact' });

      await memoryStore.clear('frontend');

      const stats = await memoryStore.getStats('frontend');
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('Role Isolation (Critical Security Test)', () => {
    it('should NOT share memories between different roles', async () => {
      // Frontend role saves a memory
      await memoryStore.addEntry('frontend', 'Frontend secret: API key is XYZ', {
        type: 'fact',
        tags: ['secret'],
      });

      // Backend role saves a different memory
      await memoryStore.addEntry('backend', 'Backend secret: DB password is ABC', {
        type: 'fact',
        tags: ['secret'],
      });

      // Frontend should only see its own memory
      const frontendResults = await memoryStore.search('frontend', { query: 'secret' });
      expect(frontendResults).toHaveLength(1);
      expect(frontendResults[0].content).toContain('Frontend secret');
      expect(frontendResults[0].content).not.toContain('Backend secret');

      // Backend should only see its own memory
      const backendResults = await memoryStore.search('backend', { query: 'secret' });
      expect(backendResults).toHaveLength(1);
      expect(backendResults[0].content).toContain('Backend secret');
      expect(backendResults[0].content).not.toContain('Frontend secret');
    });

    it('should have completely separate memory stores per role', async () => {
      // Add memories to multiple roles
      await memoryStore.addEntry('role-a', 'Role A memory 1', { type: 'fact' });
      await memoryStore.addEntry('role-a', 'Role A memory 2', { type: 'fact' });
      await memoryStore.addEntry('role-b', 'Role B memory 1', { type: 'fact' });
      await memoryStore.addEntry('role-c', 'Role C memory 1', { type: 'fact' });
      await memoryStore.addEntry('role-c', 'Role C memory 2', { type: 'fact' });
      await memoryStore.addEntry('role-c', 'Role C memory 3', { type: 'fact' });

      // Each role should have isolated counts
      const statsA = await memoryStore.getStats('role-a');
      const statsB = await memoryStore.getStats('role-b');
      const statsC = await memoryStore.getStats('role-c');

      expect(statsA.totalEntries).toBe(2);
      expect(statsB.totalEntries).toBe(1);
      expect(statsC.totalEntries).toBe(3);
    });

    it('should not return memories from other roles even with wildcard search', async () => {
      await memoryStore.addEntry('admin', 'Admin credentials', { type: 'fact' });
      await memoryStore.addEntry('guest', 'Guest preferences', { type: 'preference' });

      // Search with no query (should return all for that role only)
      const guestResults = await memoryStore.search('guest', {});
      expect(guestResults).toHaveLength(1);
      expect(guestResults[0].content).toBe('Guest preferences');

      // Verify admin's memories are not leaked
      const hasAdminData = guestResults.some((r) => r.content.includes('Admin'));
      expect(hasAdminData).toBe(false);
    });

    it('should store memories in separate files per role', async () => {
      await memoryStore.addEntry('role-x', 'X data', { type: 'fact' });
      await memoryStore.addEntry('role-y', 'Y data', { type: 'fact' });

      // Check that separate files exist
      const files = await fs.readdir(testMemoryDir);
      expect(files).toContain('role-x.memory.md');
      expect(files).toContain('role-y.memory.md');

      // Verify file contents are isolated
      const xContent = await fs.readFile(join(testMemoryDir, 'role-x.memory.md'), 'utf-8');
      const yContent = await fs.readFile(join(testMemoryDir, 'role-y.memory.md'), 'utf-8');

      expect(xContent).toContain('X data');
      expect(xContent).not.toContain('Y data');
      expect(yContent).toContain('Y data');
      expect(yContent).not.toContain('X data');
    });

    it('should not allow accessing another role\'s memory by manipulating role ID', async () => {
      await memoryStore.addEntry('admin', 'Super secret admin data', { type: 'fact' });

      // Try to access with path traversal attempt (should be sanitized)
      const memory = await memoryStore.load('../admin');
      expect(memory.entries).toHaveLength(0);

      // Original admin memory should still be intact
      const adminMemory = await memoryStore.load('admin');
      expect(adminMemory.entries).toHaveLength(1);
    });
  });

  describe('Search and Recall', () => {
    it('should search by content', async () => {
      await memoryStore.addEntry('dev', 'React is a UI library', { type: 'fact' });
      await memoryStore.addEntry('dev', 'Vue is also a UI framework', { type: 'fact' });
      await memoryStore.addEntry('dev', 'Node.js is a runtime', { type: 'fact' });

      const results = await memoryStore.search('dev', { query: 'UI' });
      expect(results).toHaveLength(2);
    });

    it('should filter by type', async () => {
      await memoryStore.addEntry('dev', 'Fact 1', { type: 'fact' });
      await memoryStore.addEntry('dev', 'Preference 1', { type: 'preference' });
      await memoryStore.addEntry('dev', 'Context 1', { type: 'context' });

      const facts = await memoryStore.search('dev', { type: 'fact' });
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe('fact');
    });

    it('should filter by tags', async () => {
      await memoryStore.addEntry('dev', 'Memory with tag', { type: 'fact', tags: ['important'] });
      await memoryStore.addEntry('dev', 'Memory without tag', { type: 'fact' });

      const tagged = await memoryStore.search('dev', { tags: ['important'] });
      expect(tagged).toHaveLength(1);
      expect(tagged[0].content).toBe('Memory with tag');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await memoryStore.addEntry('dev', `Memory ${i}`, { type: 'fact' });
      }

      const limited = await memoryStore.search('dev', { limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it('should recall memories by context', async () => {
      await memoryStore.addEntry('dev', 'User likes TypeScript for type safety', { type: 'preference' });
      await memoryStore.addEntry('dev', 'Project uses ESLint', { type: 'fact' });

      const results = await memoryStore.recall('dev', 'TypeScript', 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('TypeScript');
    });
  });

  describe('Persistence', () => {
    it('should persist memories to Markdown files', async () => {
      await memoryStore.addEntry('test-role', 'Persistent memory', {
        type: 'fact',
        tags: ['persist'],
      });

      const filePath = join(testMemoryDir, 'test-role.memory.md');
      const content = await fs.readFile(filePath, 'utf-8');

      expect(content).toContain('# Memory: test-role');
      expect(content).toContain('Persistent memory');
      expect(content).toContain('## Facts');
    });

    it('should reload memories from disk', async () => {
      // Add memory
      await memoryStore.addEntry('reload-test', 'Should survive reload', {
        type: 'preference',
      });

      // Create a new memory store instance (simulating restart)
      const newStore = new RoleMemoryStore(testMemoryDir, testLogger);
      await newStore.initialize();

      // Should load the previously saved memory
      const results = await newStore.search('reload-test', { query: 'survive' });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Should survive reload');
    });

    it('should list all roles with memory', async () => {
      await memoryStore.addEntry('role-1', 'Data 1', { type: 'fact' });
      await memoryStore.addEntry('role-2', 'Data 2', { type: 'fact' });
      await memoryStore.addEntry('role-3', 'Data 3', { type: 'fact' });

      const roles = await memoryStore.listRolesWithMemory();
      expect(roles).toContain('role-1');
      expect(roles).toContain('role-2');
      expect(roles).toContain('role-3');
    });
  });

  describe('Memory Types', () => {
    it('should support all memory types', async () => {
      const types: Array<'fact' | 'preference' | 'context' | 'episode' | 'learned'> = [
        'fact',
        'preference',
        'context',
        'episode',
        'learned',
      ];

      for (const type of types) {
        await memoryStore.addEntry('types-test', `${type} memory`, { type });
      }

      const stats = await memoryStore.getStats('types-test');
      expect(stats.totalEntries).toBe(5);
      for (const type of types) {
        expect(stats.byType[type]).toBe(1);
      }
    });
  });

  describe('Admin Super Role Access', () => {
    it('should recognize admin as super role', () => {
      expect(memoryStore.isSuperRole('admin')).toBe(true);
      expect(memoryStore.isSuperRole('frontend')).toBe(false);
      expect(memoryStore.isSuperRole('guest')).toBe(false);
    });

    it('should allow admin to search across all roles with searchAll', async () => {
      // Create memories in different roles
      await memoryStore.addEntry('frontend', 'Frontend secret', { type: 'fact' });
      await memoryStore.addEntry('backend', 'Backend secret', { type: 'fact' });
      await memoryStore.addEntry('data-analyst', 'Data secret', { type: 'fact' });

      // Admin can search all
      const allResults = await memoryStore.searchAll({ query: 'secret' });

      expect(allResults).toHaveLength(3);
      expect(allResults.map(r => r.sourceRole)).toContain('frontend');
      expect(allResults.map(r => r.sourceRole)).toContain('backend');
      expect(allResults.map(r => r.sourceRole)).toContain('data-analyst');
    });

    it('should allow admin to get stats for all roles', async () => {
      // Create memories in different roles
      await memoryStore.addEntry('role-a', 'A1', { type: 'fact' });
      await memoryStore.addEntry('role-a', 'A2', { type: 'preference' });
      await memoryStore.addEntry('role-b', 'B1', { type: 'fact' });

      // Admin can get all stats
      const allStats = await memoryStore.getAllStats();

      expect(Object.keys(allStats)).toContain('role-a');
      expect(Object.keys(allStats)).toContain('role-b');
      expect(allStats['role-a'].totalEntries).toBe(2);
      expect(allStats['role-b'].totalEntries).toBe(1);
    });

    it('should include sourceRole in searchAll results', async () => {
      await memoryStore.addEntry('dev', 'Developer note', { type: 'context' });
      await memoryStore.addEntry('ops', 'Operations note', { type: 'context' });

      const results = await memoryStore.searchAll({});

      for (const result of results) {
        expect(result.sourceRole).toBeDefined();
        expect(['dev', 'ops']).toContain(result.sourceRole);
      }
    });

    it('should respect limit in searchAll', async () => {
      // Create many memories
      for (let i = 0; i < 5; i++) {
        await memoryStore.addEntry('role-x', `X${i}`, { type: 'fact' });
        await memoryStore.addEntry('role-y', `Y${i}`, { type: 'fact' });
      }

      const limited = await memoryStore.searchAll({ limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty role memory gracefully', async () => {
      const stats = await memoryStore.getStats('nonexistent-role');
      expect(stats.totalEntries).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it('should handle special characters in content', async () => {
      const specialContent = 'Memory with special chars: <script>alert("xss")</script> & "quotes" \'apostrophe\'';
      await memoryStore.addEntry('special', specialContent, { type: 'fact' });

      const results = await memoryStore.search('special', {});
      expect(results[0].content).toBe(specialContent);
    });

    it('should handle very long content', async () => {
      const longContent = 'A'.repeat(10000);
      await memoryStore.addEntry('long', longContent, { type: 'context' });

      const results = await memoryStore.search('long', {});
      expect(results[0].content).toBe(longContent);
    });

    it('should handle concurrent access to same role', async () => {
      // Simulate concurrent writes
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(memoryStore.addEntry('concurrent', `Memory ${i}`, { type: 'fact' }));
      }
      await Promise.all(promises);

      const stats = await memoryStore.getStats('concurrent');
      expect(stats.totalEntries).toBe(10);
    });
  });
});
