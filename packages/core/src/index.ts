// ============================================================================
// AEGIS Core - Integration Layer
// Brings together all AEGIS components
// ============================================================================

// Re-export from sub-packages
export * from '@mycelium/shared';
export * from '@mycelium/rbac';
export * from '@mycelium/a2a';
export * from '@mycelium/audit';

// TODO: Migrate AegisRouterCore (rename to AegisCore)
// For now, re-export placeholder

export const CORE_VERSION = '1.0.0';

// Will export:
// - AegisCore (formerly AegisRouterCore)
// - RoleMemoryStore
