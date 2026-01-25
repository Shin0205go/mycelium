// ============================================================================
// MYCELIUM RBAC - Role-Based Access Control
// Skill-driven role and tool permission management
// ============================================================================

// Types are re-exported from @mycelium/shared via ../index.ts
// Do not re-export here to avoid duplicate exports

// Role Manager
export {
  RoleManager,
  createRoleManager,
  type RoleMemoryPermission
} from './role-manager.js';

// Tool Visibility Manager
export {
  ToolVisibilityManager,
  createToolVisibilityManager,
  type ToolVisibilityOptions
} from './tool-visibility-manager.js';

// Role Memory Store
export {
  RoleMemoryStore,
  createRoleMemoryStore,
  type MemoryEntry,
  type RoleMemory,
  type MemorySearchOptions,
  type SaveMemoryOptions
} from './role-memory.js';
