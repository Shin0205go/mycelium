// ============================================================================
// AEGIS A2A - Agent-to-Agent Identity Resolution
// Zero-Trust identity resolution based on A2A Agent Card skills
// ============================================================================

// Types
export type {
  A2AAgentSkill,
  AgentIdentity,
  SkillMatchRule,
  SkillIdentityConfig,
  SkillDefinition,
  IdentityConfig,
  IdentityResolution,
  IdentityStats
} from './types.js';

// Identity Resolver
export {
  IdentityResolver,
  createIdentityResolver
} from './identity-resolver.js';
