// ============================================================================
// MYCELIUM Router Module
// Exports for role-based routing and tool management
// ============================================================================

// Core router
export { MyceliumCore, createMyceliumCore } from './mycelium-core.js';

// Backwards compatibility aliases
export { MyceliumCore as MyceliumRouterCore } from './mycelium-core.js';
export { createMyceliumCore as createMyceliumRouterCore } from './mycelium-core.js';

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

// Types are exported from ../types/index.js to avoid duplicate exports
