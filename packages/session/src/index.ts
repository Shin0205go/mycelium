// ============================================================================
// @mycelium/session - Session Management for Mycelium
// Save, Resume, Compress, and Fork Conversations
// ============================================================================

export const SESSION_VERSION = '1.0.0';

// Types
export type {
  Session,
  SessionMessage,
  SessionToolCall,
  SessionMetadata,
  SessionSummary,
  SessionListOptions,
  CompressionStrategy,
  CompressionOptions,
  ExportFormat,
  ExportOptions,
} from './types.js';

// SessionStore
export { SessionStore, createSessionStore } from './session-store.js';
