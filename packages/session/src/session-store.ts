// ============================================================================
// Mycelium Session Store - Save, Resume, and Compress Conversations
// Inspired by Claude Code /compact and Gemini CLI /chat features
// ============================================================================

import { promises as fs } from 'fs';
import path from 'path';
import type { Logger } from '@mycelium/shared';
import type {
  Session,
  SessionMessage,
  SessionSummary,
  SessionMetadata,
  SessionListOptions,
  CompressionOptions,
  ExportOptions,
  ExportFormat,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const SESSION_VERSION = '1.0';
const DEFAULT_KEEP_RECENT = 10;
const TOKENS_PER_CHAR = 0.25; // Rough estimate

// ============================================================================
// SessionStore Implementation
// ============================================================================

/**
 * Session Store - Manages persistent conversation sessions
 *
 * Design principles:
 * 1. Transparent: Stored as human-readable Markdown files
 * 2. Portable: Sessions can be shared and imported
 * 3. Role-aware: Sessions are associated with roles
 * 4. Compressible: Long sessions can be compressed to save context
 */
export class SessionStore {
  private sessionDir: string;
  private cache: Map<string, Session> = new Map();
  private logger: Logger;
  private locks: Map<string, Promise<void>> = new Map();

  constructor(sessionDir: string = './sessions', logger?: Logger) {
    this.sessionDir = sessionDir;
    this.logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the session store
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      this.logger.info(`Session store initialized at ${this.sessionDir}`);
    } catch (error) {
      this.logger.error('Failed to initialize session store', { error });
      throw error;
    }
  }

  // ============================================================================
  // Session CRUD
  // ============================================================================

  /**
   * Create a new session
   */
  async create(roleId: string, name?: string, tags?: string[]): Promise<Session> {
    const session: Session = {
      id: this.generateId(),
      name,
      roleId,
      messages: [],
      metadata: {
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        tags,
        version: SESSION_VERSION,
      },
    };

    await this.save(session);

    this.logger.info(`Created new session`, {
      sessionId: session.id,
      roleId,
      name,
    });

    return session;
  }

  /**
   * Load a session by ID
   */
  async load(sessionId: string): Promise<Session | null> {
    // Check cache first
    const cached = this.cache.get(sessionId);
    if (cached) {
      return cached;
    }

    const sessionPath = this.getSessionPath(sessionId);

    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      const session = this.parseMarkdown(content);
      this.cache.set(sessionId, session);
      return session;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save a session
   */
  async save(session: Session): Promise<void> {
    return this.withLock(session.id, async () => {
      session.metadata.lastModifiedAt = new Date();
      session.metadata.estimatedTokens = this.estimateTokens(session);

      const sessionPath = this.getSessionPath(session.id);
      const content = this.toMarkdown(session);

      await fs.writeFile(sessionPath, content, 'utf-8');
      this.cache.set(session.id, session);

      this.logger.debug(`Saved session ${session.id}`, {
        messageCount: session.messages.length,
      });
    });
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(sessionId);

    try {
      await fs.unlink(sessionPath);
      this.cache.delete(sessionId);
      this.logger.info(`Deleted session ${sessionId}`);
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * List sessions with optional filtering
   */
  async list(options: SessionListOptions = {}): Promise<SessionSummary[]> {
    const files = await this.listSessionFiles();
    const summaries: SessionSummary[] = [];

    for (const file of files) {
      const sessionId = file.replace('.session.md', '');
      const session = await this.load(sessionId);

      if (!session) continue;

      // Apply filters
      if (options.roleId && session.roleId !== options.roleId) continue;
      if (
        options.tags &&
        options.tags.length > 0 &&
        !options.tags.some((t) => session.metadata.tags?.includes(t))
      ) {
        continue;
      }

      // Get first user message as preview
      const firstUserMessage = session.messages.find((m) => m.role === 'user');
      const preview = firstUserMessage?.content.slice(0, 100);

      summaries.push({
        id: session.id,
        name: session.name,
        roleId: session.roleId,
        messageCount: session.messages.length,
        createdAt: session.metadata.createdAt,
        lastModifiedAt: session.metadata.lastModifiedAt,
        tags: session.metadata.tags,
        preview: preview ? (preview.length === 100 ? preview + '...' : preview) : undefined,
        compressed: session.metadata.compressed,
        estimatedTokens: session.metadata.estimatedTokens,
      });
    }

    // Sort
    const sortBy = options.sortBy || 'lastModifiedAt';
    const sortOrder = options.sortOrder || 'desc';

    summaries.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'messageCount') {
        comparison = a.messageCount - b.messageCount;
      } else {
        const aDate = sortBy === 'createdAt' ? a.createdAt : a.lastModifiedAt;
        const bDate = sortBy === 'createdAt' ? b.createdAt : b.lastModifiedAt;
        comparison = aDate.getTime() - bDate.getTime();
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit;

    if (limit) {
      return summaries.slice(offset, offset + limit);
    }

    return summaries.slice(offset);
  }

  // ============================================================================
  // Message Management
  // ============================================================================

  /**
   * Add a message to a session
   */
  async addMessage(
    sessionId: string,
    message: Omit<SessionMessage, 'id' | 'timestamp'>
  ): Promise<SessionMessage> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const fullMessage: SessionMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date(),
    };

    session.messages.push(fullMessage);
    await this.save(session);

    return fullMessage;
  }

  /**
   * Get messages from a session
   */
  async getMessages(
    sessionId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<SessionMessage[]> {
    const session = await this.load(sessionId);
    if (!session) {
      return [];
    }

    const { limit, offset = 0 } = options;
    const messages = session.messages.slice(offset);

    return limit ? messages.slice(0, limit) : messages;
  }

  // ============================================================================
  // Session Operations
  // ============================================================================

  /**
   * Fork a session from a specific message
   */
  async fork(
    sessionId: string,
    fromMessageIndex?: number,
    newName?: string
  ): Promise<Session> {
    const original = await this.load(sessionId);
    if (!original) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const forkIndex = fromMessageIndex ?? original.messages.length;
    const messagesToCopy = original.messages.slice(0, forkIndex);

    const forked: Session = {
      id: this.generateId(),
      name: newName || `Fork of ${original.name || original.id}`,
      roleId: original.roleId,
      messages: messagesToCopy.map((m) => ({
        ...m,
        id: this.generateMessageId(),
      })),
      metadata: {
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        model: original.metadata.model,
        tags: original.metadata.tags ? [...original.metadata.tags, 'forked'] : ['forked'],
        parentSessionId: original.id,
        forkFromMessageIndex: forkIndex,
        version: SESSION_VERSION,
      },
    };

    await this.save(forked);

    this.logger.info(`Forked session`, {
      originalId: sessionId,
      forkedId: forked.id,
      fromIndex: forkIndex,
    });

    return forked;
  }

  /**
   * Rename a session
   */
  async rename(sessionId: string, newName: string): Promise<Session> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.name = newName;
    await this.save(session);

    return session;
  }

  /**
   * Add tags to a session
   */
  async addTags(sessionId: string, tags: string[]): Promise<Session> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const existingTags = new Set(session.metadata.tags || []);
    for (const tag of tags) {
      existingTags.add(tag);
    }
    session.metadata.tags = Array.from(existingTags);

    await this.save(session);
    return session;
  }

  // ============================================================================
  // Compression
  // ============================================================================

  /**
   * Compress a session to reduce context size
   */
  async compress(sessionId: string, options: CompressionOptions): Promise<Session> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const originalCount = session.messages.length;
    const keepRecent = options.keepRecentMessages ?? DEFAULT_KEEP_RECENT;

    // Don't compress if already small enough
    if (originalCount <= keepRecent) {
      this.logger.info(`Session ${sessionId} is already small enough, skipping compression`);
      return session;
    }

    let compressedMessages: SessionMessage[];

    switch (options.strategy) {
      case 'summarize':
        compressedMessages = await this.compressBySummarize(
          session.messages,
          keepRecent,
          options.summarizer
        );
        break;

      case 'truncate':
        compressedMessages = this.compressByTruncate(session.messages, keepRecent);
        break;

      case 'sliding-window':
        compressedMessages = this.compressBySlidingWindow(
          session.messages,
          options.targetTokens || 4000,
          keepRecent
        );
        break;

      default:
        throw new Error(`Unknown compression strategy: ${options.strategy}`);
    }

    session.messages = compressedMessages;
    session.metadata.compressed = true;
    session.metadata.originalMessageCount = originalCount;

    await this.save(session);

    this.logger.info(`Compressed session ${sessionId}`, {
      strategy: options.strategy,
      originalCount,
      newCount: compressedMessages.length,
    });

    return session;
  }

  private async compressBySummarize(
    messages: SessionMessage[],
    keepRecent: number,
    summarizer?: (messages: SessionMessage[]) => Promise<string>
  ): Promise<SessionMessage[]> {
    const toCompress = messages.slice(0, -keepRecent);
    const toKeep = messages.slice(-keepRecent);

    if (toCompress.length === 0) {
      return messages;
    }

    // Generate summary
    let summary: string;
    if (summarizer) {
      summary = await summarizer(toCompress);
    } else {
      // Default: simple concatenation of key points
      summary = this.generateDefaultSummary(toCompress);
    }

    // Create summary message
    const summaryMessage: SessionMessage = {
      id: this.generateMessageId(),
      role: 'system',
      content: `[Compressed Summary of ${toCompress.length} messages]\n\n${summary}`,
      timestamp: new Date(),
      isCompressed: true,
      originalCount: toCompress.length,
    };

    return [summaryMessage, ...toKeep];
  }

  private compressByTruncate(
    messages: SessionMessage[],
    keepRecent: number
  ): SessionMessage[] {
    const toKeep = messages.slice(-keepRecent);

    // Add a system message indicating truncation
    const truncationMessage: SessionMessage = {
      id: this.generateMessageId(),
      role: 'system',
      content: `[Earlier conversation truncated. ${messages.length - keepRecent} messages removed.]`,
      timestamp: new Date(),
      isCompressed: true,
      originalCount: messages.length - keepRecent,
    };

    return [truncationMessage, ...toKeep];
  }

  private compressBySlidingWindow(
    messages: SessionMessage[],
    targetTokens: number,
    keepRecent: number
  ): SessionMessage[] {
    // Always keep recent messages
    const mustKeep = messages.slice(-keepRecent);
    const mustKeepTokens = this.estimateMessageTokens(mustKeep);

    const remainingBudget = targetTokens - mustKeepTokens;
    if (remainingBudget <= 0) {
      // Not enough budget, just keep recent
      return mustKeep;
    }

    // Add older messages until budget is exhausted
    const older = messages.slice(0, -keepRecent);
    const included: SessionMessage[] = [];
    let usedTokens = 0;

    // Start from most recent of older messages
    for (let i = older.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateMessageTokens([older[i]]);
      if (usedTokens + msgTokens <= remainingBudget) {
        included.unshift(older[i]);
        usedTokens += msgTokens;
      } else {
        break;
      }
    }

    const removedCount = older.length - included.length;
    if (removedCount > 0) {
      const truncationMessage: SessionMessage = {
        id: this.generateMessageId(),
        role: 'system',
        content: `[${removedCount} older messages not shown to fit context window]`,
        timestamp: new Date(),
        isCompressed: true,
        originalCount: removedCount,
      };
      return [truncationMessage, ...included, ...mustKeep];
    }

    return [...included, ...mustKeep];
  }

  private generateDefaultSummary(messages: SessionMessage[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    const topics: string[] = [];

    // Extract key topics from user messages
    for (const msg of userMessages.slice(0, 5)) {
      const firstLine = msg.content.split('\n')[0].slice(0, 100);
      topics.push(`- User: ${firstLine}`);
    }

    // Count tool calls
    let totalToolCalls = 0;
    for (const msg of assistantMessages) {
      totalToolCalls += msg.toolCalls?.length || 0;
    }

    return [
      `**Conversation Summary**`,
      ``,
      `- Total messages: ${messages.length}`,
      `- User messages: ${userMessages.length}`,
      `- Assistant messages: ${assistantMessages.length}`,
      `- Tool calls made: ${totalToolCalls}`,
      ``,
      `**Topics discussed:**`,
      ...topics,
    ].join('\n');
  }

  // ============================================================================
  // Export
  // ============================================================================

  /**
   * Export a session to a specific format
   */
  async export(sessionId: string, options: ExportOptions): Promise<string> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    switch (options.format) {
      case 'markdown':
        return this.exportToMarkdown(session, options);
      case 'json':
        return this.exportToJson(session, options);
      case 'html':
        return this.exportToHtml(session, options);
      default:
        throw new Error(`Unknown export format: ${options.format}`);
    }
  }

  private exportToMarkdown(session: Session, options: ExportOptions): string {
    const lines: string[] = [];

    lines.push(`# Session: ${session.name || session.id}`);
    lines.push('');

    if (options.includeMetadata) {
      lines.push(`> Role: ${session.roleId}`);
      lines.push(`> Created: ${session.metadata.createdAt.toISOString()}`);
      lines.push(`> Messages: ${session.messages.length}`);
      if (session.metadata.tags?.length) {
        lines.push(`> Tags: ${session.metadata.tags.join(', ')}`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    for (const msg of session.messages) {
      const roleLabel = msg.role === 'user' ? '**User**' : msg.role === 'assistant' ? '**Assistant**' : '*System*';
      lines.push(`### ${roleLabel}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      if (options.includeToolCalls && msg.toolCalls?.length) {
        lines.push('<details>');
        lines.push('<summary>Tool Calls</summary>');
        lines.push('');
        for (const tc of msg.toolCalls) {
          lines.push(`- \`${tc.name}\`: ${tc.success ? 'Success' : 'Failed'}`);
        }
        lines.push('</details>');
        lines.push('');
      }

      if (options.includeThinking && msg.thinkingSignature) {
        lines.push('<details>');
        lines.push('<summary>Thinking</summary>');
        lines.push('');
        lines.push(msg.thinkingSignature.thinking);
        lines.push('</details>');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private exportToJson(session: Session, options: ExportOptions): string {
    const exported: Record<string, unknown> = {
      id: session.id,
      name: session.name,
      roleId: session.roleId,
      messages: session.messages.map((m) => {
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.content,
          timestamp: m.timestamp.toISOString(),
        };

        if (options.includeToolCalls && m.toolCalls) {
          msg.toolCalls = m.toolCalls;
        }

        if (options.includeThinking && m.thinkingSignature) {
          msg.thinking = m.thinkingSignature.thinking;
        }

        return msg;
      }),
    };

    if (options.includeMetadata) {
      exported.metadata = {
        createdAt: session.metadata.createdAt.toISOString(),
        lastModifiedAt: session.metadata.lastModifiedAt.toISOString(),
        tags: session.metadata.tags,
        model: session.metadata.model,
        compressed: session.metadata.compressed,
        estimatedTokens: session.metadata.estimatedTokens,
      };
    }

    return JSON.stringify(exported, null, 2);
  }

  private exportToHtml(session: Session, options: ExportOptions): string {
    const messages = session.messages
      .map((m) => {
        const roleClass = m.role;
        const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
        return `
        <div class="message ${roleClass}">
          <div class="role">${roleLabel}</div>
          <div class="content">${this.escapeHtml(m.content)}</div>
        </div>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Session: ${this.escapeHtml(session.name || session.id)}</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 20px; }
    .message { margin: 20px 0; padding: 15px; border-radius: 8px; }
    .user { background: #e3f2fd; }
    .assistant { background: #f3e5f5; }
    .system { background: #fff3e0; font-style: italic; }
    .role { font-weight: bold; margin-bottom: 8px; }
    .content { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Session: ${this.escapeHtml(session.name || session.id)}</h1>
  <p>Role: ${session.roleId} | Messages: ${session.messages.length}</p>
  <hr>
  ${messages}
</body>
</html>`;
  }

  // ============================================================================
  // Markdown Serialization
  // ============================================================================

  private getSessionPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.sessionDir, `${safeId}.session.md`);
  }

  private toMarkdown(session: Session): string {
    const lines: string[] = [];

    // YAML frontmatter
    lines.push('---');
    lines.push(`id: ${session.id}`);
    if (session.name) {
      lines.push(`name: "${session.name.replace(/"/g, '\\"')}"`);
    }
    lines.push(`roleId: ${session.roleId}`);
    lines.push(`createdAt: ${session.metadata.createdAt.toISOString()}`);
    lines.push(`lastModifiedAt: ${session.metadata.lastModifiedAt.toISOString()}`);
    if (session.metadata.model) {
      lines.push(`model: ${session.metadata.model}`);
    }
    if (session.metadata.tags?.length) {
      lines.push(`tags: [${session.metadata.tags.join(', ')}]`);
    }
    if (session.metadata.parentSessionId) {
      lines.push(`parentSessionId: ${session.metadata.parentSessionId}`);
    }
    if (session.metadata.compressed) {
      lines.push(`compressed: true`);
      lines.push(`originalMessageCount: ${session.metadata.originalMessageCount}`);
    }
    if (session.metadata.estimatedTokens) {
      lines.push(`estimatedTokens: ${session.metadata.estimatedTokens}`);
    }
    lines.push(`version: ${session.metadata.version}`);
    lines.push('---');
    lines.push('');

    // Title
    lines.push(`# Session: ${session.name || session.id}`);
    lines.push('');

    // Messages
    for (const msg of session.messages) {
      lines.push(`## [${msg.id}] ${this.roleToLabel(msg.role)}`);
      lines.push(`<!-- timestamp: ${msg.timestamp.toISOString()} -->`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      // Tool calls
      if (msg.toolCalls?.length) {
        lines.push('```json:tool_calls');
        lines.push(JSON.stringify(msg.toolCalls, null, 2));
        lines.push('```');
        lines.push('');
      }

      // Thinking signature
      if (msg.thinkingSignature) {
        lines.push('```thinking');
        lines.push(msg.thinkingSignature.thinking);
        lines.push('```');
        lines.push('');
      }

      // Compression metadata
      if (msg.isCompressed) {
        lines.push(`<!-- compressed: true, originalCount: ${msg.originalCount} -->`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private parseMarkdown(content: string): Session {
    const lines = content.split('\n');

    // Parse YAML frontmatter
    let inFrontmatter = false;
    let frontmatterEnd = 0;
    const frontmatterLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
        } else {
          frontmatterEnd = i;
          break;
        }
      } else if (inFrontmatter) {
        frontmatterLines.push(lines[i]);
      }
    }

    const metadata = this.parseFrontmatter(frontmatterLines);

    // Parse messages
    const messages: SessionMessage[] = [];
    let currentMessage: Partial<SessionMessage> | null = null;
    let contentLines: string[] = [];
    let inToolCalls = false;
    let inThinking = false;
    let toolCallsJson = '';
    let thinkingContent = '';

    const saveCurrentMessage = () => {
      if (currentMessage?.id) {
        messages.push({
          id: currentMessage.id,
          role: currentMessage.role || 'user',
          content: contentLines.join('\n').trim(),
          timestamp: currentMessage.timestamp || new Date(),
          toolCalls: currentMessage.toolCalls,
          thinkingSignature: currentMessage.thinkingSignature,
          isCompressed: currentMessage.isCompressed,
          originalCount: currentMessage.originalCount,
        });
      }
      currentMessage = null;
      contentLines = [];
    };

    for (let i = frontmatterEnd + 1; i < lines.length; i++) {
      const line = lines[i];

      // Message header
      const headerMatch = line.match(/^## \[([^\]]+)\] (.+)$/);
      if (headerMatch) {
        saveCurrentMessage();
        currentMessage = {
          id: headerMatch[1],
          role: this.labelToRole(headerMatch[2]),
        };
        continue;
      }

      // Timestamp comment
      const timestampMatch = line.match(/<!-- timestamp: (.+) -->/);
      if (timestampMatch && currentMessage) {
        currentMessage.timestamp = new Date(timestampMatch[1]);
        continue;
      }

      // Compressed comment
      const compressedMatch = line.match(/<!-- compressed: true, originalCount: (\d+) -->/);
      if (compressedMatch && currentMessage) {
        currentMessage.isCompressed = true;
        currentMessage.originalCount = parseInt(compressedMatch[1], 10);
        continue;
      }

      // Tool calls block
      if (line === '```json:tool_calls') {
        inToolCalls = true;
        toolCallsJson = '';
        continue;
      }
      if (inToolCalls && line === '```') {
        inToolCalls = false;
        if (currentMessage) {
          try {
            currentMessage.toolCalls = JSON.parse(toolCallsJson);
          } catch {
            // Ignore parse errors
          }
        }
        continue;
      }
      if (inToolCalls) {
        toolCallsJson += line + '\n';
        continue;
      }

      // Thinking block
      if (line === '```thinking') {
        inThinking = true;
        thinkingContent = '';
        continue;
      }
      if (inThinking && line === '```') {
        inThinking = false;
        if (currentMessage) {
          currentMessage.thinkingSignature = {
            thinking: thinkingContent.trim(),
            type: 'extended_thinking',
            capturedAt: new Date(),
          };
        }
        continue;
      }
      if (inThinking) {
        thinkingContent += line + '\n';
        continue;
      }

      // Skip title
      if (line.startsWith('# Session:')) {
        continue;
      }

      // Content line
      if (currentMessage) {
        contentLines.push(line);
      }
    }

    saveCurrentMessage();

    return {
      id: (metadata.id as string) || this.generateId(),
      name: metadata.name as string | undefined,
      roleId: (metadata.roleId as string) || 'default',
      messages,
      metadata: {
        createdAt: metadata.createdAt ? new Date(metadata.createdAt as string) : new Date(),
        lastModifiedAt: metadata.lastModifiedAt ? new Date(metadata.lastModifiedAt as string) : new Date(),
        model: metadata.model as string | undefined,
        tags: metadata.tags as string[] | undefined,
        parentSessionId: metadata.parentSessionId as string | undefined,
        compressed: metadata.compressed as boolean | undefined,
        originalMessageCount: metadata.originalMessageCount as number | undefined,
        estimatedTokens: metadata.estimatedTokens as number | undefined,
        version: (metadata.version as string) || SESSION_VERSION,
      },
    };
  }

  private parseFrontmatter(lines: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, rawValue] = match;
        let value: unknown = rawValue;

        // Parse arrays
        if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
          value = rawValue
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim());
        }
        // Parse booleans
        else if (rawValue === 'true') {
          value = true;
        } else if (rawValue === 'false') {
          value = false;
        }
        // Parse numbers
        else if (/^\d+$/.test(rawValue)) {
          value = parseInt(rawValue, 10);
        }
        // Parse quoted strings
        else if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
          value = rawValue.slice(1, -1).replace(/\\"/g, '"');
        }

        result[key] = value;
      }
    }

    return result;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private async listSessionFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.sessionDir);
      return files.filter((f) => f.endsWith('.session.md'));
    } catch {
      return [];
    }
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(id);
    if (existing) {
      await existing;
    }

    let resolve: () => void;
    const lock = new Promise<void>((r) => {
      resolve = r;
    });
    this.locks.set(id, lock);

    try {
      return await fn();
    } finally {
      resolve!();
      this.locks.delete(id);
    }
  }

  private generateId(): string {
    return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private generateMessageId(): string {
    return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  private estimateTokens(session: Session): number {
    return this.estimateMessageTokens(session.messages);
  }

  private estimateMessageTokens(messages: SessionMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
      if (msg.toolCalls) {
        totalChars += JSON.stringify(msg.toolCalls).length;
      }
    }
    return Math.ceil(totalChars * TOKENS_PER_CHAR);
  }

  private roleToLabel(role: string): string {
    switch (role) {
      case 'user':
        return 'User';
      case 'assistant':
        return 'Assistant';
      case 'system':
        return 'System';
      default:
        return role;
    }
  }

  private labelToRole(label: string): 'user' | 'assistant' | 'system' {
    switch (label.toLowerCase()) {
      case 'user':
        return 'user';
      case 'assistant':
        return 'assistant';
      case 'system':
        return 'system';
      default:
        return 'user';
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new SessionStore instance
 */
export function createSessionStore(sessionDir?: string, logger?: Logger): SessionStore {
  return new SessionStore(sessionDir, logger);
}
