/**
 * Tests for Configuration Management Module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  ConfigManager,
  createConfigManager,
  MyceliumConfig,
  DEFAULT_CONFIG,
  CONFIG_FILES,
} from '../src/lib/config.js';

describe('ConfigManager', () => {
  let tempDir: string;
  let manager: ConfigManager;

  beforeEach(async () => {
    // Create a temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mycelium-config-test-'));
    manager = new ConfigManager();
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should load default configuration when no files exist', async () => {
      const config = await manager.load(tempDir);
      
      expect(config).toBeDefined();
      expect(config.preferences?.defaultModel).toBe(DEFAULT_CONFIG.preferences?.defaultModel);
      expect(config.preferences?.defaultRole).toBe(DEFAULT_CONFIG.preferences?.defaultRole);
    });

    it('should load project configuration from JSON file', async () => {
      const projectConfig: MyceliumConfig = {
        preferences: {
          defaultModel: 'test-model',
          defaultRole: 'test-role',
        },
      };

      await fs.writeFile(
        path.join(tempDir, CONFIG_FILES.PROJECT),
        JSON.stringify(projectConfig, null, 2)
      );

      const config = await manager.load(tempDir);
      
      expect(config.preferences?.defaultModel).toBe('test-model');
      expect(config.preferences?.defaultRole).toBe('test-role');
    });

    it('should merge user and project configurations', async () => {
      // Create user config in home directory (mocked)
      const userConfigPath = path.join(tempDir, '.myceliumrc.json');
      const userConfig: MyceliumConfig = {
        preferences: {
          defaultModel: 'user-model',
          verbose: true,
        },
      };

      await fs.writeFile(userConfigPath, JSON.stringify(userConfig, null, 2));

      // Create project config
      const projectConfig: MyceliumConfig = {
        preferences: {
          defaultRole: 'project-role',
        },
      };

      await fs.writeFile(
        path.join(tempDir, CONFIG_FILES.PROJECT),
        JSON.stringify(projectConfig, null, 2)
      );

      const config = await manager.load(tempDir);
      
      // Project config should override user config for defaultRole
      expect(config.preferences?.defaultRole).toBe('project-role');
      // User config should still apply for verbose
      expect(config.preferences?.verbose).toBe(true);
    });

    it('should find configuration in parent directories', async () => {
      const subDir = path.join(tempDir, 'sub', 'dir');
      await fs.mkdir(subDir, { recursive: true });

      const projectConfig: MyceliumConfig = {
        preferences: {
          defaultModel: 'parent-model',
        },
      };

      await fs.writeFile(
        path.join(tempDir, CONFIG_FILES.PROJECT),
        JSON.stringify(projectConfig, null, 2)
      );

      const config = await manager.load(subDir);
      
      expect(config.preferences?.defaultModel).toBe('parent-model');
    });
  });

  describe('get and getValue', () => {
    beforeEach(async () => {
      const projectConfig: MyceliumConfig = {
        preferences: {
          defaultModel: 'test-model',
          outputFormat: 'json',
        },
        paths: {
          skillsDir: 'skills',
        },
      };

      await fs.writeFile(
        path.join(tempDir, CONFIG_FILES.PROJECT),
        JSON.stringify(projectConfig, null, 2)
      );

      await manager.load(tempDir);
    });

    it('should get entire configuration', () => {
      const config = manager.get();
      expect(config).toBeDefined();
      expect(config?.preferences?.defaultModel).toBe('test-model');
    });

    it('should get specific value using dot notation', () => {
      const model = manager.getValue<string>('preferences.defaultModel');
      expect(model).toBe('test-model');

      const format = manager.getValue<string>('preferences.outputFormat');
      expect(format).toBe('json');

      const skillsDir = manager.getValue<string>('paths.skillsDir');
      expect(skillsDir).toBe('skills');
    });

    it('should return undefined for non-existent keys', () => {
      const value = manager.getValue('non.existent.key');
      expect(value).toBeUndefined();
    });
  });

  describe('setValue', () => {
    it('should set a new configuration value', async () => {
      await manager.load(tempDir);
      await manager.setValue('preferences.defaultModel', 'new-model');

      const model = manager.getValue<string>('preferences.defaultModel');
      expect(model).toBe('new-model');
    });

    it('should persist changes to project config file', async () => {
      await manager.load(tempDir);
      await manager.setValue('preferences.defaultModel', 'persisted-model');

      // Reload from file
      const newManager = new ConfigManager();
      await newManager.load(tempDir);

      const model = newManager.getValue<string>('preferences.defaultModel');
      expect(model).toBe('persisted-model');
    });

    it('should create nested objects as needed', async () => {
      await manager.load(tempDir);
      await manager.setValue('custom.nested.value', 'test');

      const value = manager.getValue<string>('custom.nested.value');
      expect(value).toBe('test');
    });
  });

  describe('validate', () => {
    it('should validate correct configuration', () => {
      const config: MyceliumConfig = {
        mcpServers: {
          test: {
            command: 'node',
            args: ['test.js'],
          },
        },
        preferences: {
          outputFormat: 'json',
        },
        api: {
          timeout: 30000,
          maxRetries: 3,
        },
      };

      const result = manager.validate(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid MCP server configuration', () => {
      const config: MyceliumConfig = {
        mcpServers: {
          invalid: {
            command: '',
            args: [],
          },
        },
      };

      const result = manager.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect invalid output format', () => {
      const config: MyceliumConfig = {
        preferences: {
          outputFormat: 'invalid' as any,
        },
      };

      const result = manager.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('outputFormat'))).toBe(true);
    });

    it('should detect invalid API timeout', () => {
      const config: MyceliumConfig = {
        api: {
          timeout: 4000000, // Too high
        },
      };

      const result = manager.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('timeout'))).toBe(true);
    });

    it('should detect invalid maxRetries', () => {
      const config: MyceliumConfig = {
        api: {
          maxRetries: 20, // Too high
        },
      };

      const result = manager.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('maxRetries'))).toBe(true);
    });
  });

  describe('MCP server management', () => {
    beforeEach(async () => {
      const projectConfig: MyceliumConfig = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
            comment: 'Test server',
          },
          'disabled-server': {
            command: 'node',
            args: ['disabled.js'],
            disabled: true,
          },
        },
      };

      await fs.writeFile(
        path.join(tempDir, CONFIG_FILES.PROJECT),
        JSON.stringify(projectConfig, null, 2)
      );

      await manager.load(tempDir);
    });

    it('should get MCP server configuration', () => {
      const server = manager.getMCPServer('test-server');
      expect(server).toBeDefined();
      expect(server?.command).toBe('node');
      expect(server?.args).toEqual(['test.js']);
    });

    it('should list only enabled MCP servers', () => {
      const servers = manager.listMCPServers();
      expect(servers).toHaveLength(1);
      expect(servers[0][0]).toBe('test-server');
    });

    it('should enable and disable MCP servers', async () => {
      await manager.setMCPServerEnabled('test-server', false);
      let servers = manager.listMCPServers();
      expect(servers).toHaveLength(0);

      await manager.setMCPServerEnabled('test-server', true);
      servers = manager.listMCPServers();
      expect(servers).toHaveLength(1);
    });

    it('should throw error for non-existent server', async () => {
      await expect(
        manager.setMCPServerEnabled('non-existent', true)
      ).rejects.toThrow();
    });
  });

  describe('initProject', () => {
    it('should create a new project configuration', async () => {
      const configPath = await manager.initProject(tempDir);
      
      expect(configPath).toBe(path.join(tempDir, CONFIG_FILES.PROJECT));
      
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config.mcpServers).toBeDefined();
      expect(config.roles?.defaultRole).toBe('default');
    });

    it('should accept initial configuration', async () => {
      const initialConfig: Partial<MyceliumConfig> = {
        preferences: {
          defaultModel: 'custom-model',
        },
      };

      const configPath = await manager.initProject(tempDir, initialConfig);
      
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      expect(config.preferences?.defaultModel).toBe('custom-model');
    });
  });

  describe('export', () => {
    beforeEach(async () => {
      const projectConfig: MyceliumConfig = {
        preferences: {
          defaultModel: 'test-model',
        },
      };

      await fs.writeFile(
        path.join(tempDir, CONFIG_FILES.PROJECT),
        JSON.stringify(projectConfig, null, 2)
      );

      await manager.load(tempDir);
    });

    it('should export configuration as JSON', async () => {
      const json = await manager.export('json');
      const parsed = JSON.parse(json);
      
      expect(parsed.preferences?.defaultModel).toBe('test-model');
    });

    it('should export configuration as YAML', async () => {
      const yaml = await manager.export('yaml');
      
      expect(yaml).toContain('preferences:');
      expect(yaml).toContain('defaultModel: test-model');
    });
  });

  describe('getSources', () => {
    it('should return configuration source information', async () => {
      await fs.writeFile(
        path.join(tempDir, CONFIG_FILES.PROJECT),
        JSON.stringify({ preferences: {} }, null, 2)
      );

      await manager.load(tempDir);
      
      const sources = manager.getSources();
      
      expect(sources.project).toContain(CONFIG_FILES.PROJECT);
      expect(sources.hasProject).toBe(true);
    });

    it('should indicate when no project config exists', async () => {
      await manager.load(tempDir);
      
      const sources = manager.getSources();
      
      expect(sources.project).toBeNull();
      expect(sources.hasProject).toBe(false);
    });
  });
});

describe('createConfigManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mycelium-config-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create and load a configuration manager', async () => {
    const manager = await createConfigManager(tempDir);
    
    expect(manager).toBeInstanceOf(ConfigManager);
    expect(manager.get()).toBeDefined();
  });
});

describe('Configuration merging', () => {
  let tempDir: string;
  let manager: ConfigManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mycelium-config-test-'));
    manager = new ConfigManager();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should deep merge nested objects', async () => {
    const projectConfig: MyceliumConfig = {
      preferences: {
        defaultModel: 'project-model',
        verbose: true,
      },
      paths: {
        skillsDir: 'project-skills',
      },
    };

    await fs.writeFile(
      path.join(tempDir, CONFIG_FILES.PROJECT),
      JSON.stringify(projectConfig, null, 2)
    );

    await manager.load(tempDir);
    const config = manager.get();
    
    // Should have project overrides
    expect(config?.preferences?.defaultModel).toBe('project-model');
    expect(config?.preferences?.verbose).toBe(true);
    
    // Should still have defaults for unspecified values
    expect(config?.preferences?.outputFormat).toBe(DEFAULT_CONFIG.preferences?.outputFormat);
    expect(config?.paths?.sessionsDir).toBe(DEFAULT_CONFIG.paths?.sessionsDir);
  });

  it('should handle arrays correctly in merge', async () => {
    const projectConfig: MyceliumConfig = {
      mcpServers: {
        server1: {
          command: 'node',
          args: ['arg1', 'arg2'],
        },
      },
    };

    await fs.writeFile(
      path.join(tempDir, CONFIG_FILES.PROJECT),
      JSON.stringify(projectConfig, null, 2)
    );

    await manager.load(tempDir);
    const server = manager.getMCPServer('server1');
    
    expect(server?.args).toEqual(['arg1', 'arg2']);
    expect(Array.isArray(server?.args)).toBe(true);
  });
});
