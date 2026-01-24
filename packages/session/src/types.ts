// ============================================================================
// Mycelium Session Types
// ============================================================================

import type { ThinkingSignature } from '@mycelium/shared';

/**
 * A tool call made during the session
 */
export interface SessionToolCall {
  /** Tool name (with server prefix) */
  name: string;

  /** Tool arguments */
  arguments: Record<string, unknown>;

  /** Tool result (if available) */
  result?: unknown;

  /** Whether the call was successful */
  success?: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * A single message in the session
 */
export interface SessionMessage {
  /** Unique message ID */
  id: string;

  /** Message role */
  role: 'user' | 'assistant' | 'system';

  /** Message content */
  content: string;

  /** Message timestamp */
  timestamp: Date;

  /** Tool calls made in this message (assistant only) */
  toolCalls?: SessionToolCall[];

  /** Thinking signature (assistant only, for transparency) */
  thinkingSignature?: ThinkingSignature;

  /** Whether this message was compressed/summarized */
  isCompressed?: boolean;

  /** Original message count if compressed */
  originalCount?: number;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  /** When the session was created */
  createdAt: Date;

  /** When the session was last modified */
  lastModifiedAt: Date;

  /** Model used in this session */
  model?: string;

  /** Tags for organization */
  tags?: string[];

  /** Parent session ID (if forked) */
  parentSessionId?: string;

  /** Fork point message index */
  forkFromMessageIndex?: number;

  /** Whether the session is compressed */
  compressed?: boolean;

  /** Original message count before compression */
  originalMessageCount?: number;

  /** Token count estimate */
  estimatedTokens?: number;

  /** Version for migrations */
  version: string;
}

/**
 * A complete session
 */
export interface Session {
  /** Unique session ID */
  id: string;

  /** Optional session name */
  name?: string;

  /** Role ID active during this session */
  roleId: string;

  /** Session messages */
  messages: SessionMessage[];

  /** Session metadata */
  metadata: SessionMetadata;
}

/**
 * Session summary for listing
 */
export interface SessionSummary {
  /** Session ID */
  id: string;

  /** Session name */
  name?: string;

  /** Role ID */
  roleId: string;

  /** Number of messages */
  messageCount: number;

  /** Creation date */
  createdAt: Date;

  /** Last modified date */
  lastModifiedAt: Date;

  /** Tags */
  tags?: string[];

  /** First user message (preview) */
  preview?: string;

  /** Whether compressed */
  compressed?: boolean;

  /** Estimated tokens */
  estimatedTokens?: number;
}

/**
 * Options for listing sessions
 */
export interface SessionListOptions {
  /** Filter by role ID */
  roleId?: string;

  /** Filter by tags (any match) */
  tags?: string[];

  /** Maximum number of results */
  limit?: number;

  /** Skip first N results */
  offset?: number;

  /** Sort by field */
  sortBy?: 'createdAt' | 'lastModifiedAt' | 'messageCount';

  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Compression strategy
 */
export type CompressionStrategy = 'summarize' | 'truncate' | 'sliding-window';

/**
 * Options for session compression
 */
export interface CompressionOptions {
  /** Compression strategy */
  strategy: CompressionStrategy;

  /** Target token count (approximate) */
  targetTokens?: number;

  /** Number of recent messages to keep uncompressed */
  keepRecentMessages?: number;

  /** Summary generator function (for 'summarize' strategy) */
  summarizer?: (messages: SessionMessage[]) => Promise<string>;
}

/**
 * Export format for sessions
 */
export type ExportFormat = 'markdown' | 'json' | 'html';

/**
 * Options for session export
 */
export interface ExportOptions {
  /** Export format */
  format: ExportFormat;

  /** Include tool calls */
  includeToolCalls?: boolean;

  /** Include thinking signatures */
  includeThinking?: boolean;

  /** Include metadata */
  includeMetadata?: boolean;
}
