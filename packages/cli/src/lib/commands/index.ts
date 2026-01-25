/**
 * Command Registry - Exports all built-in commands
 */

// Types
export type { CommandContext, CommandHandler, CommandDefinition } from './types.js';

// Role commands
export { rolesCommand, statusCommand, skillsCommand, switchRole } from './role-commands.js';

// Tool commands
export { toolsCommand, executeSkillCommand, executeToolCommand } from './tool-commands.js';

// Model commands
export { modelCommand, helpCommand, AVAILABLE_MODELS } from './model-commands.js';
