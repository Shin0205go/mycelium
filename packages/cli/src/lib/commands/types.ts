/**
 * Command Handler Types
 */

import type { MCPClient, AgentManifest, SkillCommandInfo, ToolCommandInfo } from '../mcp-client.js';
import type * as readline from 'readline';

/**
 * Command context passed to command handlers
 */
export interface CommandContext {
  mcp: MCPClient;
  currentRole: string;
  currentModel: string;
  manifest: AgentManifest | null;
  rl: readline.Interface | null;
  skillCommands: Map<string, SkillCommandInfo>;
  toolCommands: Map<string, ToolCommandInfo>;
  authSource: string;
  useApiKey: boolean;

  // Callbacks for state updates
  setCurrentRole: (role: string) => void;
  setCurrentModel: (model: string) => void;
  setManifest: (manifest: AgentManifest | null) => void;
}

/**
 * Command handler function signature
 */
export type CommandHandler = (
  ctx: CommandContext,
  args: string[]
) => Promise<void>;

/**
 * Command definition
 */
export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  handler: CommandHandler;
}
