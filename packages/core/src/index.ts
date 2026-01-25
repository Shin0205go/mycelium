// ============================================================================
// MYCELIUM Core - Router + Skill-based RBAC
// ============================================================================

// Re-export from shared (base types)
export * from '@mycelium/shared';

// RBAC (now part of core)
export * from './rbac/index.js';

// Router
export * from './router/index.js';

// MCP utilities
export * from './mcp/index.js';

// Types (router-specific types only, shared types come from @mycelium/shared)
export * from './types/index.js';

// Utils - export specific items to avoid Logger class/interface conflict
export { Logger, logger } from './utils/logger.js';

// Identity resolver (merged from @mycelium/a2a)
export {
  IdentityResolver,
  createIdentityResolver,
  type SkillDefinition,
  type AgentIdentity,
  type IdentityResolution
} from './rbac/identity-resolver.js';

export const CORE_VERSION = '1.0.0';
