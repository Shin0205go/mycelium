// ============================================================================
// AEGIS Router Module
// Exports for role-based routing and tool management
// ============================================================================

// Core router
export { AegisRouterCore, createAegisRouterCore } from './aegis-router-core.js';

// Re-export from @aegis/rbac
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

// Re-export from @aegis/a2a
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

// Audit logging - re-export from @aegis/audit
export {
  AuditLogger,
  createAuditLogger,
  type AuditLogEntry,
  type AuditQueryOptions,
  type AuditStats
} from '@mycelium/audit';

// Rate limiting - re-export from @aegis/audit
export {
  RateLimiter,
  createRateLimiter,
  type RoleQuota,
  type RateLimitResult,
  type RateLimitEvent
} from '@mycelium/audit';

// Types are exported from ../types/index.js to avoid duplicate exports
