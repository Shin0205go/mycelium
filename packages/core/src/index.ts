// ============================================================================
// AEGIS Core - Integration Layer
// Brings together all AEGIS components
// ============================================================================

// Re-export from sub-packages
export * from '@aegis/shared';
export * from '@aegis/rbac';
export * from '@aegis/a2a';
export * from '@aegis/audit';

// Export enterprise MCP modules
export * from './sampling/index.js';
export * from './tsi/index.js';
export * from './observability/index.js';
export * from './virtual-server/index.js';
export * from './router/routing-strategies.js';

export const CORE_VERSION = '1.0.0';

// Will export:
// - AegisCore (formerly AegisRouterCore)
// - RoleMemoryStore
