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
  BaseSkillDefinition
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
