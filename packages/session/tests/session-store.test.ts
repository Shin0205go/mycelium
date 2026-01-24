// ============================================================================
// SessionStore Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { SessionStore, createSessionStore } from '../src/session-store.js';
import type { Session, SessionMessage } from '../src/types.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('SessionStore', () => {
  let store: SessionStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `session-test-${Date.now()}`);
    store = createSessionStore(testDir);
    await store.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ============================================================================
  // Basic CRUD
  // ============================================================================

  describe('create', () => {
    it('should create a new session with ID and role', async () => {
      const session = await store.create('developer');

      expect(session.id).toMatch(/^ses_/);
      expect(session.roleId).toBe('developer');
      expect(session.messages).toEqual([]);
      expect(session.metadata.version).toBe('1.0');
    });

    it('should create session with name and tags', async () => {
      const session = await store.create('admin', 'My Session', ['project-x', 'important']);

      expect(session.name).toBe('My Session');
      expect(session.metadata.tags).toEqual(['project-x', 'important']);
    });

    it('should persist session to disk', async () => {
      const session = await store.create('tester', 'Test Session');
      const files = await fs.readdir(testDir);

      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/\.session\.md$/);
    });
  });

  describe('load', () => {
    it('should load existing session', async () => {
      const created = await store.create('developer', 'Dev Session');

      // Clear cache to force disk read
      const freshStore = createSessionStore(testDir);
      const loaded = await freshStore.load(created.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(created.id);
      expect(loaded!.name).toBe('Dev Session');
      expect(loaded!.roleId).toBe('developer');
    });

    it('should return null for non-existent session', async () => {
      const loaded = await store.load('non-existent-id');
      expect(loaded).toBeNull();
    });

    it('should cache loaded sessions', async () => {
      const session = await store.create('developer');

      const loaded1 = await store.load(session.id);
      const loaded2 = await store.load(session.id);

      expect(loaded1).toBe(loaded2); // Same reference
    });
  });

  describe('delete', () => {
    it('should delete existing session', async () => {
      const session = await store.create('developer');
      const result = await store.delete(session.id);

      expect(result).toBe(true);

      const loaded = await store.load(session.id);
      expect(loaded).toBeNull();
    });

    it('should return false for non-existent session', async () => {
      const result = await store.delete('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all sessions', async () => {
      await store.create('developer', 'Session 1');
      await store.create('tester', 'Session 2');
      await store.create('admin', 'Session 3');

      const list = await store.list();

      expect(list.length).toBe(3);
    });

    it('should filter by roleId', async () => {
      await store.create('developer', 'Dev 1');
      await store.create('developer', 'Dev 2');
      await store.create('tester', 'Test 1');

      const list = await store.list({ roleId: 'developer' });

      expect(list.length).toBe(2);
      expect(list.every((s) => s.roleId === 'developer')).toBe(true);
    });

    it('should filter by tags', async () => {
      await store.create('developer', 'Session 1', ['urgent']);
      await store.create('developer', 'Session 2', ['normal']);
      await store.create('developer', 'Session 3', ['urgent', 'important']);

      const list = await store.list({ tags: ['urgent'] });

      expect(list.length).toBe(2);
    });

    it('should sort by lastModifiedAt descending by default', async () => {
      const s1 = await store.create('developer', 'First');
      await new Promise((r) => setTimeout(r, 10));
      const s2 = await store.create('developer', 'Second');
      await new Promise((r) => setTimeout(r, 10));
      const s3 = await store.create('developer', 'Third');

      const list = await store.list();

      expect(list[0].id).toBe(s3.id);
      expect(list[1].id).toBe(s2.id);
      expect(list[2].id).toBe(s1.id);
    });

    it('should apply limit and offset', async () => {
      await store.create('developer', 'Session 1');
      await store.create('developer', 'Session 2');
      await store.create('developer', 'Session 3');

      const list = await store.list({ limit: 2, offset: 1 });

      expect(list.length).toBe(2);
    });
  });

  // ============================================================================
  // Message Management
  // ============================================================================

  describe('addMessage', () => {
    it('should add message to session', async () => {
      const session = await store.create('developer');

      const message = await store.addMessage(session.id, {
        role: 'user',
        content: 'Hello, assistant!',
      });

      expect(message.id).toMatch(/^msg_/);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, assistant!');
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it('should persist messages', async () => {
      const session = await store.create('developer');

      await store.addMessage(session.id, {
        role: 'user',
        content: 'First message',
      });

      await store.addMessage(session.id, {
        role: 'assistant',
        content: 'Second message',
      });

      // Reload from disk
      const freshStore = createSessionStore(testDir);
      const loaded = await freshStore.load(session.id);

      expect(loaded!.messages.length).toBe(2);
      expect(loaded!.messages[0].content).toBe('First message');
      expect(loaded!.messages[1].content).toBe('Second message');
    });

    it('should store tool calls', async () => {
      const session = await store.create('developer');

      await store.addMessage(session.id, {
        role: 'assistant',
        content: 'I will read the file.',
        toolCalls: [
          {
            name: 'filesystem__read_file',
            arguments: { path: '/test.txt' },
            result: 'file contents',
            success: true,
          },
        ],
      });

      const loaded = await store.load(session.id);
      expect(loaded!.messages[0].toolCalls).toHaveLength(1);
      expect(loaded!.messages[0].toolCalls![0].name).toBe('filesystem__read_file');
    });

    it('should throw for non-existent session', async () => {
      await expect(
        store.addMessage('non-existent', { role: 'user', content: 'test' })
      ).rejects.toThrow('Session not found');
    });
  });

  describe('getMessages', () => {
    it('should get all messages', async () => {
      const session = await store.create('developer');

      await store.addMessage(session.id, { role: 'user', content: 'Message 1' });
      await store.addMessage(session.id, { role: 'assistant', content: 'Message 2' });
      await store.addMessage(session.id, { role: 'user', content: 'Message 3' });

      const messages = await store.getMessages(session.id);

      expect(messages.length).toBe(3);
    });

    it('should support limit and offset', async () => {
      const session = await store.create('developer');

      for (let i = 0; i < 10; i++) {
        await store.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const messages = await store.getMessages(session.id, { limit: 3, offset: 2 });

      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe('Message 2');
    });
  });

  // ============================================================================
  // Session Operations
  // ============================================================================

  describe('fork', () => {
    it('should fork session with all messages', async () => {
      const original = await store.create('developer', 'Original');

      await store.addMessage(original.id, { role: 'user', content: 'Message 1' });
      await store.addMessage(original.id, { role: 'assistant', content: 'Message 2' });
      await store.addMessage(original.id, { role: 'user', content: 'Message 3' });

      const forked = await store.fork(original.id);

      expect(forked.id).not.toBe(original.id);
      expect(forked.name).toBe('Fork of Original');
      expect(forked.messages.length).toBe(3);
      expect(forked.metadata.parentSessionId).toBe(original.id);
      expect(forked.metadata.tags).toContain('forked');
    });

    it('should fork from specific message index', async () => {
      const original = await store.create('developer');

      await store.addMessage(original.id, { role: 'user', content: 'Message 1' });
      await store.addMessage(original.id, { role: 'assistant', content: 'Message 2' });
      await store.addMessage(original.id, { role: 'user', content: 'Message 3' });

      const forked = await store.fork(original.id, 2, 'Forked at 2');

      expect(forked.messages.length).toBe(2);
      expect(forked.metadata.forkFromMessageIndex).toBe(2);
    });

    it('should generate new message IDs', async () => {
      const original = await store.create('developer');
      await store.addMessage(original.id, { role: 'user', content: 'Test' });

      const forked = await store.fork(original.id);

      expect(forked.messages[0].id).not.toBe(original.messages[0]?.id);
    });
  });

  describe('rename', () => {
    it('should rename session', async () => {
      const session = await store.create('developer', 'Old Name');

      const renamed = await store.rename(session.id, 'New Name');

      expect(renamed.name).toBe('New Name');

      const loaded = await store.load(session.id);
      expect(loaded!.name).toBe('New Name');
    });
  });

  describe('addTags', () => {
    it('should add tags to session', async () => {
      const session = await store.create('developer', 'Test', ['existing']);

      const updated = await store.addTags(session.id, ['new-tag', 'another']);

      expect(updated.metadata.tags).toContain('existing');
      expect(updated.metadata.tags).toContain('new-tag');
      expect(updated.metadata.tags).toContain('another');
    });

    it('should not duplicate tags', async () => {
      const session = await store.create('developer', 'Test', ['tag1']);

      const updated = await store.addTags(session.id, ['tag1', 'tag2']);

      expect(updated.metadata.tags?.filter((t) => t === 'tag1').length).toBe(1);
    });
  });

  // ============================================================================
  // Compression
  // ============================================================================

  describe('compress', () => {
    it('should truncate old messages', async () => {
      const session = await store.create('developer');

      for (let i = 0; i < 20; i++) {
        await store.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const compressed = await store.compress(session.id, {
        strategy: 'truncate',
        keepRecentMessages: 5,
      });

      expect(compressed.messages.length).toBe(6); // 1 truncation message + 5 kept
      expect(compressed.messages[0].isCompressed).toBe(true);
      expect(compressed.messages[0].role).toBe('system');
      expect(compressed.metadata.compressed).toBe(true);
      expect(compressed.metadata.originalMessageCount).toBe(20);
    });

    it('should summarize old messages', async () => {
      const session = await store.create('developer');

      for (let i = 0; i < 15; i++) {
        await store.addMessage(session.id, {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        });
      }

      const compressed = await store.compress(session.id, {
        strategy: 'summarize',
        keepRecentMessages: 5,
      });

      expect(compressed.messages.length).toBe(6); // 1 summary + 5 kept
      expect(compressed.messages[0].content).toContain('Compressed Summary');
    });

    it('should use sliding window', async () => {
      const session = await store.create('developer');

      for (let i = 0; i < 20; i++) {
        await store.addMessage(session.id, { role: 'user', content: 'A'.repeat(100) });
      }

      const compressed = await store.compress(session.id, {
        strategy: 'sliding-window',
        targetTokens: 200,
        keepRecentMessages: 3,
      });

      // Should have fewer messages due to token budget
      expect(compressed.messages.length).toBeLessThan(20);
    });

    it('should skip compression for small sessions', async () => {
      const session = await store.create('developer');

      await store.addMessage(session.id, { role: 'user', content: 'Hello' });
      await store.addMessage(session.id, { role: 'assistant', content: 'Hi!' });

      const compressed = await store.compress(session.id, {
        strategy: 'truncate',
        keepRecentMessages: 10,
      });

      expect(compressed.messages.length).toBe(2);
      expect(compressed.metadata.compressed).toBeFalsy();
    });

    it('should use custom summarizer', async () => {
      const session = await store.create('developer');

      for (let i = 0; i < 15; i++) {
        await store.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const compressed = await store.compress(session.id, {
        strategy: 'summarize',
        keepRecentMessages: 5,
        summarizer: async (messages) => {
          return `Custom summary of ${messages.length} messages`;
        },
      });

      expect(compressed.messages[0].content).toContain('Custom summary of 10 messages');
    });
  });

  // ============================================================================
  // Export
  // ============================================================================

  describe('export', () => {
    let session: Session;

    beforeEach(async () => {
      session = await store.create('developer', 'Export Test');
      await store.addMessage(session.id, { role: 'user', content: 'Hello!' });
      await store.addMessage(session.id, { role: 'assistant', content: 'Hi there!' });
    });

    it('should export to markdown', async () => {
      const md = await store.export(session.id, { format: 'markdown' });

      expect(md).toContain('# Session: Export Test');
      expect(md).toContain('**User**');
      expect(md).toContain('Hello!');
      expect(md).toContain('**Assistant**');
    });

    it('should export to JSON', async () => {
      const jsonStr = await store.export(session.id, {
        format: 'json',
        includeMetadata: true,
      });

      const parsed = JSON.parse(jsonStr);

      expect(parsed.id).toBe(session.id);
      expect(parsed.messages.length).toBe(2);
      expect(parsed.metadata).toBeDefined();
    });

    it('should export to HTML', async () => {
      const html = await store.export(session.id, { format: 'html' });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Session: Export Test</title>');
      expect(html).toContain('class="message user"');
    });

    it('should include tool calls when requested', async () => {
      await store.addMessage(session.id, {
        role: 'assistant',
        content: 'Reading file...',
        toolCalls: [{ name: 'read_file', arguments: { path: '/test' }, success: true }],
      });

      const md = await store.export(session.id, {
        format: 'markdown',
        includeToolCalls: true,
      });

      expect(md).toContain('Tool Calls');
      expect(md).toContain('read_file');
    });
  });

  // ============================================================================
  // Markdown Serialization
  // ============================================================================

  describe('markdown serialization', () => {
    it('should round-trip session through markdown', async () => {
      const original = await store.create('developer', 'Round Trip Test', ['tag1', 'tag2']);

      await store.addMessage(original.id, {
        role: 'user',
        content: 'Multi-line\nmessage\nhere',
      });

      await store.addMessage(original.id, {
        role: 'assistant',
        content: 'Response with special chars: <>&"',
        toolCalls: [
          {
            name: 'test_tool',
            arguments: { key: 'value' },
            success: true,
          },
        ],
      });

      // Clear cache and reload
      const freshStore = createSessionStore(testDir);
      const loaded = await freshStore.load(original.id);

      expect(loaded!.name).toBe('Round Trip Test');
      expect(loaded!.roleId).toBe('developer');
      expect(loaded!.metadata.tags).toEqual(['tag1', 'tag2']);
      expect(loaded!.messages.length).toBe(2);
      expect(loaded!.messages[0].content).toBe('Multi-line\nmessage\nhere');
      expect(loaded!.messages[1].toolCalls).toHaveLength(1);
    });

    it('should handle sessions with thinking signatures', async () => {
      const session = await store.create('developer');

      await store.addMessage(session.id, {
        role: 'assistant',
        content: 'I thought about this.',
        thinkingSignature: {
          thinking: 'This is my reasoning process...',
          type: 'extended_thinking',
          capturedAt: new Date(),
        },
      });

      const freshStore = createSessionStore(testDir);
      const loaded = await freshStore.load(session.id);

      expect(loaded!.messages[0].thinkingSignature).toBeDefined();
      expect(loaded!.messages[0].thinkingSignature!.thinking).toBe(
        'This is my reasoning process...'
      );
    });
  });

  // ============================================================================
  // Concurrency
  // ============================================================================

  describe('concurrency', () => {
    it('should handle concurrent saves', async () => {
      const session = await store.create('developer');

      // Add messages concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.addMessage(session.id, { role: 'user', content: `Message ${i}` })
      );

      await Promise.all(promises);

      const loaded = await store.load(session.id);
      expect(loaded!.messages.length).toBe(10);
    });
  });
});
