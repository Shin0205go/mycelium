// ============================================================================
// MYCELIUM Router Module
// Exports for role-based routing and tool management
// ============================================================================

// Core router
export { MyceliumRouterCore, createMyceliumRouterCore } from './mycelium-router-core.js';

// RBAC components (from local ./rbac, not @mycelium/rbac)
export {
  RoleManager,
  createRoleManager,
  ToolVisibilityManager,
  createToolVisibilityManager,
  RoleMemoryStore,
  createRoleMemoryStore,
  type MemoryEntry,
  type RoleMemory,
  type MemorySearchOptions,
  type SaveMemoryOptions
} from '../rbac/index.js';

// Remote prompt fetching
export {
  RemotePromptFetcher,
  createRemotePromptFetcher,
  type PromptRouter,
  type FetchPromptResult
} from './remote-prompt-fetcher.js';

// Router adapter for proxy integration
export { RouterAdapter, createRouterAdapter } from './router-adapter.js';

// Audit logging - from @mycelium/audit
export {
  AuditLogger,
  createAuditLogger,
  type AuditLogEntry,
  type AuditQueryOptions,
  type AuditStats
} from '@mycelium/audit';

// Rate limiting - from @mycelium/audit
export {
  RateLimiter,
  createRateLimiter,
  type RoleQuota,
  type RateLimitResult,
  type RateLimitEvent
} from '@mycelium/audit';

// Types are exported from ../types/index.js to avoid duplicate exports
