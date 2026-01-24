// ============================================================================
// MYCELIUM Router Module
// Exports for role-based routing and tool management
// ============================================================================

// Core router
export { MyceliumRouterCore, createMyceliumRouterCore } from './mycelium-router-core.js';

// Re-export from @mycelium/rbac
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
} from '@mycelium/rbac';

// Re-export from @mycelium/a2a
export {
  IdentityResolver,
  createIdentityResolver
} from '@mycelium/a2a';

// Remote prompt fetching
export {
  RemotePromptFetcher,
  createRemotePromptFetcher,
  type PromptRouter,
  type FetchPromptResult
} from './remote-prompt-fetcher.js';

// Router adapter for proxy integration
export { RouterAdapter, createRouterAdapter } from './router-adapter.js';

// Audit logging - re-export from @mycelium/audit
export {
  AuditLogger,
  createAuditLogger,
  type AuditLogEntry,
  type AuditQueryOptions,
  type AuditStats
} from '@mycelium/audit';

// Rate limiting - re-export from @mycelium/audit
export {
  RateLimiter,
  createRateLimiter,
  type RoleQuota,
  type RateLimitResult,
  type RateLimitEvent
} from '@mycelium/audit';

// Types are exported from ../types/index.js to avoid duplicate exports
