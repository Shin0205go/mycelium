// ============================================================================
// MYCELIUM Router Module
// Exports for role-based routing and tool management
// ============================================================================

// Core router
export { MyceliumRouterCore, createMyceliumRouterCore } from './mycelium-router-core.js';

// Extracted components
export { ServerManager, createServerManager } from './server-manager.js';
export { MemoryHandler, createMemoryHandler } from './memory-handler.js';
export { ToolRegistry, createToolRegistry, ROUTER_TOOLS } from './tool-registry.js';

// RBAC components (from local ./rbac)
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
