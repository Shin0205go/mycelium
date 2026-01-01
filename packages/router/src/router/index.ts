// ============================================================================
// AEGIS Router Module
// Exports for role-based routing and tool management
// ============================================================================

// Core router
export { AegisRouterCore, createAegisRouterCore } from './aegis-router-core.js';

// Role management
export { RoleManager, createRoleManager } from './role-manager.js';

// Tool visibility management
export { ToolVisibilityManager, createToolVisibilityManager } from './tool-visibility-manager.js';

// Remote prompt fetching
export {
  RemotePromptFetcher,
  createRemotePromptFetcher,
  type PromptRouter,
  type FetchPromptResult
} from './remote-prompt-fetcher.js';

// Router adapter for proxy integration
export { RouterAdapter, createRouterAdapter } from './router-adapter.js';

// Audit logging
export {
  AuditLogger,
  createAuditLogger,
  type AuditLogEntry,
  type AuditQueryOptions,
  type AuditStats
} from './audit-logger.js';

// Rate limiting
export {
  RateLimiter,
  createRateLimiter,
  type RoleQuota,
  type RateLimitResult,
  type RateLimitEvent
} from './rate-limiter.js';

// Role memory
export {
  RoleMemoryStore,
  createRoleMemoryStore,
  type MemoryEntry,
  type RoleMemory,
  type MemorySearchOptions,
  type SaveMemoryOptions
} from './role-memory.js';

// Types are exported from ../types/index.js to avoid duplicate exports
