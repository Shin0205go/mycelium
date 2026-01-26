/**
 * Environment Variable Loader for MYCELIUM
 * 
 * Loads and validates environment variables with type safety.
 * Provides centralized access to all environment configuration.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env file if it exists
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

/**
 * Environment variable configuration
 */
export interface EnvConfig {
  // API Configuration
  anthropicApiKey?: string;
  anthropicApiEndpoint?: string;
  apiTimeout?: number;
  apiMaxRetries?: number;

  // Model Configuration
  defaultModel?: string;

  // Paths Configuration
  skillsDir?: string;
  policiesDir?: string;
  sessionsDir?: string;
  logsDir?: string;
  contextDir?: string;

  // RBAC Configuration
  defaultRole?: string;
  rbacEnabled?: boolean;

  // CLI Preferences
  verbose?: boolean;
  outputFormat?: 'json' | 'table' | 'plain';
  colorOutput?: boolean;

  // Session Management
  autoSaveSession?: boolean;
  sessionSaveInterval?: number;

  // MCP Server Enablement
  mcpServers?: {
    skills?: boolean;
    session?: boolean;
    sandbox?: boolean;
    filesystem?: boolean;
    playwright?: boolean;
  };

  // Development/Debug
  debug?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  logMcpMessages?: boolean;
}

/**
 * Parse a boolean environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse an integer environment variable
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse an enum environment variable
 */
function parseEnum<T extends string>(
  value: string | undefined,
  validValues: T[],
  defaultValue: T
): T {
  if (value === undefined) return defaultValue;
  if (validValues.includes(value as T)) return value as T;
  return defaultValue;
}

/**
 * Load environment configuration
 */
export function loadEnvConfig(): EnvConfig {
  return {
    // API Configuration
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicApiEndpoint: process.env.ANTHROPIC_API_ENDPOINT,
    apiTimeout: parseInteger(process.env.MYCELIUM_API_TIMEOUT, 300000),
    apiMaxRetries: parseInteger(process.env.MYCELIUM_API_MAX_RETRIES, 3),

    // Model Configuration
    defaultModel: process.env.MYCELIUM_DEFAULT_MODEL,

    // Paths Configuration
    skillsDir: process.env.MYCELIUM_SKILLS_DIR,
    policiesDir: process.env.MYCELIUM_POLICIES_DIR,
    sessionsDir: process.env.MYCELIUM_SESSIONS_DIR,
    logsDir: process.env.MYCELIUM_LOGS_DIR,
    contextDir: process.env.MYCELIUM_CONTEXT_DIR,

    // RBAC Configuration
    defaultRole: process.env.MYCELIUM_DEFAULT_ROLE,
    rbacEnabled: process.env.MYCELIUM_RBAC_ENABLED !== undefined
      ? parseBoolean(process.env.MYCELIUM_RBAC_ENABLED, true)
      : undefined,

    // CLI Preferences
    verbose: process.env.MYCELIUM_VERBOSE !== undefined
      ? parseBoolean(process.env.MYCELIUM_VERBOSE, false)
      : undefined,
    outputFormat: process.env.MYCELIUM_OUTPUT_FORMAT
      ? parseEnum<'json' | 'table' | 'plain'>(
          process.env.MYCELIUM_OUTPUT_FORMAT,
          ['json', 'table', 'plain'],
          'table'
        )
      : undefined,
    colorOutput: process.env.MYCELIUM_COLOR_OUTPUT !== undefined
      ? parseBoolean(process.env.MYCELIUM_COLOR_OUTPUT, true)
      : undefined,

    // Session Management
    autoSaveSession: process.env.MYCELIUM_AUTO_SAVE_SESSION !== undefined
      ? parseBoolean(process.env.MYCELIUM_AUTO_SAVE_SESSION, true)
      : undefined,
    sessionSaveInterval: process.env.MYCELIUM_SESSION_SAVE_INTERVAL
      ? parseInteger(process.env.MYCELIUM_SESSION_SAVE_INTERVAL, 5)
      : undefined,

    // MCP Server Enablement
    mcpServers: {
      skills: process.env.MYCELIUM_MCP_SKILLS_ENABLED !== undefined
        ? parseBoolean(process.env.MYCELIUM_MCP_SKILLS_ENABLED, true)
        : undefined,
      session: process.env.MYCELIUM_MCP_SESSION_ENABLED !== undefined
        ? parseBoolean(process.env.MYCELIUM_MCP_SESSION_ENABLED, true)
        : undefined,
      sandbox: process.env.MYCELIUM_MCP_SANDBOX_ENABLED !== undefined
        ? parseBoolean(process.env.MYCELIUM_MCP_SANDBOX_ENABLED, true)
        : undefined,
      filesystem: process.env.MYCELIUM_MCP_FILESYSTEM_ENABLED !== undefined
        ? parseBoolean(process.env.MYCELIUM_MCP_FILESYSTEM_ENABLED, true)
        : undefined,
      playwright: process.env.MYCELIUM_MCP_PLAYWRIGHT_ENABLED !== undefined
        ? parseBoolean(process.env.MYCELIUM_MCP_PLAYWRIGHT_ENABLED, false)
        : undefined,
    },

    // Development/Debug
    debug: process.env.MYCELIUM_DEBUG !== undefined
      ? parseBoolean(process.env.MYCELIUM_DEBUG, false)
      : undefined,
    logLevel: process.env.MYCELIUM_LOG_LEVEL
      ? parseEnum<'error' | 'warn' | 'info' | 'debug'>(
          process.env.MYCELIUM_LOG_LEVEL,
          ['error', 'warn', 'info', 'debug'],
          'info'
        )
      : undefined,
    logMcpMessages: process.env.MYCELIUM_LOG_MCP_MESSAGES !== undefined
      ? parseBoolean(process.env.MYCELIUM_LOG_MCP_MESSAGES, false)
      : undefined,
  };
}

/**
 * Validate required environment variables
 */
export function validateEnvConfig(config: EnvConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // API key is required for agent operations
  if (!config.anthropicApiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  // Validate numeric ranges
  if (config.apiTimeout !== undefined && (config.apiTimeout < 0 || config.apiTimeout > 3600000)) {
    errors.push('MYCELIUM_API_TIMEOUT must be between 0 and 3600000ms');
  }

  if (config.apiMaxRetries !== undefined && (config.apiMaxRetries < 0 || config.apiMaxRetries > 10)) {
    errors.push('MYCELIUM_API_MAX_RETRIES must be between 0 and 10');
  }

  if (config.sessionSaveInterval !== undefined && config.sessionSaveInterval < 1) {
    errors.push('MYCELIUM_SESSION_SAVE_INTERVAL must be at least 1 minute');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Cached environment configuration
 */
let cachedEnvConfig: EnvConfig | null = null;

/**
 * Get cached environment configuration
 */
export function getEnvConfig(): EnvConfig {
  if (!cachedEnvConfig) {
    cachedEnvConfig = loadEnvConfig();
  }
  return cachedEnvConfig;
}

/**
 * Reload environment configuration (useful for testing)
 */
export function reloadEnvConfig(): EnvConfig {
  cachedEnvConfig = loadEnvConfig();
  return cachedEnvConfig;
}
