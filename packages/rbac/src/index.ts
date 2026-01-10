// ============================================================================
// AEGIS RBAC - Role-Based Access Control
// Skill-driven role and tool permission management
// ============================================================================

// Re-export types from shared
export type {
  Role,
  ToolPermissions,
  RoleMetadata,
  RemoteInstruction,
  ToolInfo,
  ListRolesOptions,
  ListRolesResult,
  SkillManifest,
  DynamicRole,
  RoleManifest,
  MemoryPolicy,
  SkillGrants,
  SkillMetadata,
  BaseSkillDefinition,
  // Capability types
  CapabilityScope,
  CapabilityDeclaration,
  CapabilityContextConstraints,
  CapabilityTokenPayload,
  CapabilityToken,
  CapabilityVerificationResult,
  CapabilityAttenuationRequest,
  CapabilitySkillDefinition
} from '@aegis/shared';

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

// Capability Manager
export {
  CapabilityManager,
  createCapabilityManager,
  type CapabilityManagerConfig
} from './capability-manager.js';
