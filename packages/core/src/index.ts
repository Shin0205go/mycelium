// ============================================================================
// Mycelium Core - Integration Layer
// Brings together all Mycelium components
// ============================================================================

// Re-export from sub-packages
// Note: @mycelium/rbac already re-exports types from @mycelium/shared
// So we only export from rbac to avoid duplicate exports
export * from '@mycelium/rbac';
export * from '@mycelium/a2a';

// Re-export Logger type from shared (not re-exported by rbac)
export type { Logger } from '@mycelium/shared';

// TODO: Migrate MyceliumRouterCore (rename to MyceliumCore)
// For now, re-export placeholder

export const CORE_VERSION = '1.0.0';

// Will export:
// - MyceliumCore (formerly MyceliumRouterCore)
// - RoleMemoryStore
