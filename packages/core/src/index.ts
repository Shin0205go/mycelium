// ============================================================================
// AEGIS Core - Integration Layer
// Brings together all AEGIS components
// ============================================================================

// Re-export from sub-packages
export * from '@aegis/shared';
export * from '@aegis/rbac';
export * from '@aegis/a2a';
export * from '@aegis/audit';

// TODO: Migrate AegisRouterCore (rename to AegisCore)
// For now, re-export placeholder

export const CORE_VERSION = '1.0.0';

// Will export:
// - AegisCore (formerly AegisRouterCore)
// - RoleMemoryStore
