/**
 * Configuration Management Module for MYCELIUM CLI
 * 
 * Handles reading, writing, validating, and managing configuration files.
 * Supports both project-level and user-level configurations with merging.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  comment?: string;
  disabled?: boolean;
}

/**
 * Role configuration
 */
export interface RoleConfig {
  defaultRole?: string;
  roles?: Record<string, {
    description?: string;
    skills?: string[];
    policies?: string[];
  }>;
}

/**
 * CLI preferences
 */
export interface CLIPreferences {
  /** Default model to use */
  defaultModel?: string;
  
  /** Default role to use */
  defaultRole?: string;
  
  /** Enable verbose logging */
  verbose?: boolean;
  
  /** Default output format (json, table, plain) */
  outputFormat?: 'json' | 'table' | 'plain';
  
  /** Color output preference */
  colorOutput?: boolean;
  
  /** Auto-save sessions */
  autoSaveSession?: boolean;
  
  /** Session save interval in minutes */
  sessionSaveInterval?: number;
}

/**
 * Paths configuration
 */
export interface PathsConfig {
  /** Path to skills directory */
  skillsDir?: string;
  
  /** Path to policies directory */
  policiesDir?: string;
  
  /** Path to sessions directory */
  sessionsDir?: string;
  
  /** Path to logs directory */
  logsDir?: string;
  
  /** Path to context files directory */
  contextDir?: string;
}

/**
 * API configuration
 */
export interface APIConfig {
  /** Anthropic API key (should be in env, but can be in config) */
  apiKey?: string;
  
  /** API endpoint override */
  endpoint?: string;
  
  /** Request timeout in milliseconds */
  timeout?: number;
  
  /** Max retries for failed requests */
  maxRetries?: number;
}

/**
 * Complete MYCELIUM configuration
 */
export interface MyceliumConfig {
  /** MCP server configurations */
  mcpServers?: Record<string, MCPServerConfig>;
  
  /** Disabled MCP servers */
  _disabled?: Record<string, MCPServerConfig>;
  
  /** Role configurations */
  roles?: RoleConfig;
  
  /** CLI preferences */
  preferences?: CLIPreferences;
  
  /** Path configurations */
  paths?: PathsConfig;
  
  /** API configurations */
  api?: APIConfig;
  
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration file names
 */
export const CONFIG_FILES = {
  PROJECT: 'config.json',
  USER: '.myceliumrc.json',
  PROJECT_YAML: 'config.yaml',
  USER_YAML: '.myceliumrc.yaml',
} as const;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: MyceliumConfig = {
  preferences: {
    defaultModel: 'claude-3-5-sonnet-20241022',
    defaultRole: 'default',
    verbose: false,
    outputFormat: 'table',
    colorOutput: true,
    autoSaveSession: true,
    sessionSaveInterval: 5,
  },
  paths: {
    skillsDir: 'packages/skills/skills',
    policiesDir: 'packages/core/policies',
    sessionsDir: 'sessions',
    logsDir: 'logs',
    contextDir: '.',
  },
  api: {
    timeout: 300000,
    maxRetries: 3,
  },
  roles: {
    defaultRole: 'default',
  },
};

/**
 * Configuration manager class
 */
export class ConfigManager {
  private projectConfig: MyceliumConfig | null = null;
  private userConfig: MyceliumConfig | null = null;
  private mergedConfig: MyceliumConfig | null = null;
  private projectConfigPath: string | null = null;
  private userConfigPath: string;
  private currentProjectDir: string | null = null;

  constructor() {
    this.userConfigPath = path.join(os.homedir(), CONFIG_FILES.USER);
  }

  /**
   * Load configuration from project and user locations
   * 
   * @param projectDir - Project directory to search for config
   * @returns Merged configuration
   */
  async load(projectDir?: string): Promise<MyceliumConfig> {
    const baseDir = projectDir || process.cwd();
    this.currentProjectDir = baseDir;

    // Load project config
    this.projectConfigPath = await this.findProjectConfig(baseDir);
    if (this.projectConfigPath) {
      this.projectConfig = await this.readConfigFile(this.projectConfigPath);
    }

    // Load user config - check both home directory and project directory (for testing)
    const projectUserConfig = path.join(baseDir, CONFIG_FILES.USER);
    if (await this.fileExists(projectUserConfig)) {
      this.userConfig = await this.readConfigFile(projectUserConfig);
    } else if (await this.fileExists(this.userConfigPath)) {
      this.userConfig = await this.readConfigFile(this.userConfigPath);
    }

    // Merge configurations: defaults < user < project
    this.mergedConfig = this.mergeConfigs(
      DEFAULT_CONFIG,
      this.userConfig || {},
      this.projectConfig || {}
    );

    return this.mergedConfig;
  }

  /**
   * Get the current merged configuration
   * 
   * @returns Current configuration or null if not loaded
   */
  get(): MyceliumConfig | null {
    return this.mergedConfig;
  }

  /**
   * Get a specific configuration value
   * 
   * @param key - Dot-notation key (e.g., 'preferences.defaultModel')
   * @returns Configuration value or undefined
   */
  getValue<T = unknown>(key: string): T | undefined {
    if (!this.mergedConfig) {
      return undefined;
    }

    const keys = key.split('.');
    let value: any = this.mergedConfig;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value as T;
  }

  /**
   * Set a configuration value in project config
   * 
   * @param key - Dot-notation key
   * @param value - Value to set
   */
  async setValue(key: string, value: unknown): Promise<void> {
    if (!this.projectConfigPath) {
      // Create new project config
      const baseDir = this.currentProjectDir || process.cwd();
      this.projectConfigPath = path.join(baseDir, CONFIG_FILES.PROJECT);
      this.projectConfig = {};
    }

    if (!this.projectConfig) {
      this.projectConfig = {};
    }

    const keys = key.split('.');
    let current: any = this.projectConfig;

    // Navigate to the parent object
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object' || Array.isArray(current[k])) {
        current[k] = {};
      }
      current = current[k];
    }

    // Set the value
    current[keys[keys.length - 1]] = value;

    // Save to file
    await this.saveProjectConfig();

    // Reload merged config
    await this.load(this.currentProjectDir || undefined);
  }

  /**
   * Save project configuration to file
   */
  async saveProjectConfig(): Promise<void> {
    if (!this.projectConfigPath || !this.projectConfig) {
      throw new Error('No project configuration to save');
    }

    await this.writeConfigFile(this.projectConfigPath, this.projectConfig);
  }

  /**
   * Save user configuration to file
   */
  async saveUserConfig(config: MyceliumConfig): Promise<void> {
    this.userConfig = config;
    await this.writeConfigFile(this.userConfigPath, config);
  }

  /**
   * Initialize a new project configuration
   * 
   * @param projectDir - Directory to create config in
   * @param config - Initial configuration (optional)
   * @returns Path to created config file
   */
  async initProject(
    projectDir: string,
    config?: Partial<MyceliumConfig>
  ): Promise<string> {
    const configPath = path.join(projectDir, CONFIG_FILES.PROJECT);
    
    const initialConfig: MyceliumConfig = this.mergeConfigs(
      {
        mcpServers: {},
        roles: {
          defaultRole: 'default',
        },
      },
      config || {}
    );

    await this.writeConfigFile(configPath, initialConfig);
    return configPath;
  }

  /**
   * Validate configuration structure
   * 
   * @param config - Configuration to validate
   * @returns Validation result
   */
  validate(config: MyceliumConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate MCP servers
    if (config.mcpServers) {
      for (const [name, server] of Object.entries(config.mcpServers)) {
        if (!server.command) {
          errors.push(`MCP server '${name}' missing required 'command' field`);
        }
        if (!Array.isArray(server.args)) {
          errors.push(`MCP server '${name}' 'args' must be an array`);
        }
      }
    }

    // Validate preferences
    if (config.preferences) {
      const { outputFormat } = config.preferences;
      if (outputFormat && !['json', 'table', 'plain'].includes(outputFormat)) {
        errors.push(`Invalid outputFormat: ${outputFormat}`);
      }
    }

    // Validate API config
    if (config.api) {
      const { timeout, maxRetries } = config.api;
      if (timeout !== undefined && (timeout < 0 || timeout > 3600000)) {
        errors.push('API timeout must be between 0 and 3600000ms');
      }
      if (maxRetries !== undefined && (maxRetries < 0 || maxRetries > 10)) {
        errors.push('API maxRetries must be between 0 and 10');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get MCP server configuration
   * 
   * @param serverName - Name of the server
   * @returns Server configuration or undefined
   */
  getMCPServer(serverName: string): MCPServerConfig | undefined {
    return this.mergedConfig?.mcpServers?.[serverName];
  }

  /**
   * List all enabled MCP servers
   * 
   * @returns Array of server names and configs
   */
  listMCPServers(): Array<[string, MCPServerConfig]> {
    if (!this.mergedConfig?.mcpServers) {
      return [];
    }

    return Object.entries(this.mergedConfig.mcpServers).filter(
      ([_, config]) => !config.disabled
    );
  }

  /**
   * Enable or disable an MCP server
   * 
   * @param serverName - Name of the server
   * @param enabled - Whether to enable or disable
   */
  async setMCPServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    // Check if server exists in project config OR merged config
    const serverInMerged = this.mergedConfig?.mcpServers?.[serverName];
    const serverInProject = this.projectConfig?.mcpServers?.[serverName];
    
    if (!serverInMerged && !serverInProject) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    await this.setValue(`mcpServers.${serverName}.disabled`, !enabled);
  }

  /**
   * Find project configuration file
   * 
   * @param startDir - Directory to start searching from
   * @returns Path to config file or null
   */
  private async findProjectConfig(startDir: string): Promise<string | null> {
    let currentDir = path.resolve(startDir);
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      // Check for JSON config
      const jsonPath = path.join(currentDir, CONFIG_FILES.PROJECT);
      if (await this.fileExists(jsonPath)) {
        return jsonPath;
      }

      // Check for YAML config
      const yamlPath = path.join(currentDir, CONFIG_FILES.PROJECT_YAML);
      if (await this.fileExists(yamlPath)) {
        return yamlPath;
      }

      // Check for package.json with mycelium config
      const packagePath = path.join(currentDir, 'package.json');
      if (await this.fileExists(packagePath)) {
        const pkg = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
        if (pkg.mycelium) {
          return packagePath;
        }
      }

      // Move up one directory
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }

    return null;
  }

  /**
   * Read and parse configuration file
   * 
   * @param filePath - Path to config file
   * @returns Parsed configuration
   */
  private async readConfigFile(filePath: string): Promise<MyceliumConfig> {
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Handle package.json with mycelium config
    if (filePath.endsWith('package.json')) {
      const pkg = JSON.parse(content);
      return pkg.mycelium || {};
    }

    // Handle YAML files
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      const yaml = await import('yaml');
      return yaml.parse(content) as MyceliumConfig;
    }

    // Handle JSON files
    return JSON.parse(content) as MyceliumConfig;
  }

  /**
   * Write configuration to file
   * 
   * @param filePath - Path to write to
   * @param config - Configuration to write
   */
  private async writeConfigFile(
    filePath: string,
    config: MyceliumConfig
  ): Promise<void> {
    // Handle YAML files
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      const yaml = await import('yaml');
      await fs.writeFile(filePath, yaml.stringify(config), 'utf-8');
      return;
    }

    // Handle JSON files
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Check if a file exists
   * 
   * @param filePath - Path to check
   * @returns true if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deep merge multiple configuration objects
   * 
   * @param configs - Configurations to merge (later configs override earlier ones)
   * @returns Merged configuration
   */
  private mergeConfigs(...configs: Partial<MyceliumConfig>[]): MyceliumConfig {
    const result: MyceliumConfig = {};

    for (const config of configs) {
      this.deepMerge(result, config);
    }

    return result;
  }

  /**
   * Deep merge two objects
   * 
   * @param target - Target object to merge into
   * @param source - Source object to merge from
   */
  private deepMerge(target: any, source: any): void {
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        if (Array.isArray(source[key])) {
          target[key] = [...source[key]];
        } else if (source[key] === null) {
          target[key] = source[key];
        } else {
          this.deepMerge(target[key], source[key]);
        }
      } else {
        target[key] = source[key];
      }
    }
  }

  /**
   * Export configuration to a specific format
   * 
   * @param format - Export format (json or yaml)
   * @returns Formatted configuration string
   */
  async export(format: 'json' | 'yaml' = 'json'): Promise<string> {
    if (!this.mergedConfig) {
      throw new Error('No configuration loaded');
    }

    if (format === 'yaml') {
      const yaml = await import('yaml');
      return yaml.stringify(this.mergedConfig);
    }

    return JSON.stringify(this.mergedConfig, null, 2);
  }

  /**
   * Get configuration source information
   * 
   * @returns Information about where config values come from
   */
  getSources(): {
    project: string | null;
    user: string;
    hasProject: boolean;
    hasUser: boolean;
  } {
    return {
      project: this.projectConfigPath,
      user: this.userConfigPath,
      hasProject: this.projectConfig !== null,
      hasUser: this.userConfig !== null,
    };
  }
}

/**
 * Create and load a new configuration manager
 * 
 * @param projectDir - Optional project directory
 * @returns Initialized configuration manager
 */
export async function createConfigManager(
  projectDir?: string
): Promise<ConfigManager> {
  const manager = new ConfigManager();
  await manager.load(projectDir);
  return manager;
}
