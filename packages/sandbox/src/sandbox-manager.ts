// ============================================================================
// Mycelium Sandbox Manager
// Orchestrates sandbox execution across platforms
// ============================================================================

import type { Logger } from '@mycelium/shared';
import type {
  SandboxConfig,
  SandboxResult,
  SandboxRequest,
  SandboxProfile,
  SandboxPlatform,
  SkillSandboxConfig,
} from './types.js';
import { SANDBOX_PROFILES } from './types.js';
import { SandboxExecutor, UnsandboxedExecutor } from './executor.js';
import { LinuxSandboxExecutor } from './linux-executor.js';
import { DarwinSandboxExecutor } from './darwin-executor.js';

/**
 * Sandbox Manager - Central orchestrator for sandboxed execution
 */
export class SandboxManager {
  private logger: Logger;
  private executor: SandboxExecutor | null = null;
  private defaultConfig: Partial<SandboxConfig>;

  constructor(logger?: Logger, defaultConfig?: Partial<SandboxConfig>) {
    this.logger = logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.defaultConfig = defaultConfig || {};
  }

  /**
   * Initialize the sandbox manager
   * Detects platform and selects appropriate executor
   */
  async initialize(): Promise<void> {
    const platform = process.platform;

    this.logger.info(`Initializing sandbox for platform: ${platform}`);

    // Try platform-specific executor first
    if (platform === 'linux') {
      const executor = new LinuxSandboxExecutor(this.getDefaultConfig());
      if (await executor.isAvailable()) {
        this.executor = executor;
        this.logger.info('Linux sandbox executor initialized');
        return;
      }
    }

    if (platform === 'darwin') {
      const executor = new DarwinSandboxExecutor(this.getDefaultConfig());
      if (await executor.isAvailable()) {
        this.executor = executor;
        this.logger.info('macOS sandbox executor initialized');
        return;
      }
    }

    // Fallback to unsandboxed executor
    this.logger.warn('No sandbox available, using unsandboxed executor');
    this.executor = new UnsandboxedExecutor(this.getDefaultConfig());
  }

  /**
   * Check if sandbox is available on this system
   */
  isAvailable(): boolean {
    return this.executor !== null && !(this.executor instanceof UnsandboxedExecutor);
  }

  /**
   * Get the current platform
   */
  getPlatform(): SandboxPlatform {
    return this.executor?.getPlatform() || (process.platform as SandboxPlatform);
  }

  /**
   * Execute a command in a sandbox
   */
  async execute(
    command: string,
    args: string[] = [],
    config?: Partial<SandboxConfig>,
    stdin?: string
  ): Promise<SandboxResult> {
    if (!this.executor) {
      await this.initialize();
    }

    const fullConfig = this.mergeConfig(config);

    this.logger.debug('Executing in sandbox', {
      command,
      args,
      workingDirectory: fullConfig.workingDirectory,
    });

    const request: SandboxRequest = {
      command,
      args,
      stdin,
      config: fullConfig,
    };

    const result = await this.executor!.execute(request);

    if (!result.success) {
      this.logger.warn('Sandbox execution failed', {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        violations: result.violations,
      });
    }

    return result;
  }

  /**
   * Execute with a preset profile
   */
  async executeWithProfile(
    command: string,
    args: string[] = [],
    profile: SandboxProfile,
    overrides?: Partial<SandboxConfig>,
    stdin?: string
  ): Promise<SandboxResult> {
    const profileConfig = SANDBOX_PROFILES[profile];
    const config = { ...profileConfig, ...overrides };

    return this.execute(command, args, config, stdin);
  }

  /**
   * Execute using skill sandbox configuration
   */
  async executeWithSkillConfig(
    command: string,
    args: string[] = [],
    skillConfig: SkillSandboxConfig,
    workingDirectory: string,
    stdin?: string
  ): Promise<SandboxResult> {
    if (!skillConfig.enabled) {
      // Run without sandbox
      this.logger.debug('Skill sandbox disabled, running without sandbox');
      const unsandboxed = new UnsandboxedExecutor(this.getDefaultConfig());
      return unsandboxed.execute({
        command,
        args,
        stdin,
        config: { ...this.getDefaultConfig(), workingDirectory },
      });
    }

    let config: Partial<SandboxConfig> = { workingDirectory };

    // Apply profile if specified
    if (skillConfig.profile) {
      config = { ...SANDBOX_PROFILES[skillConfig.profile], ...config };
    }

    // Apply custom overrides
    if (skillConfig.custom) {
      config = this.deepMerge(config, skillConfig.custom);
    }

    return this.execute(command, args, config, stdin);
  }

  /**
   * Get sandbox capabilities for the current platform
   */
  getCapabilities(): {
    platform: SandboxPlatform;
    available: boolean;
    features: {
      filesystem: boolean;
      network: boolean;
      process: boolean;
      memory: boolean;
    };
    tool: string;
  } {
    const platform = this.getPlatform();
    const available = this.isAvailable();

    return {
      platform,
      available,
      features: {
        filesystem: available,
        network: available,
        process: available,
        memory: available,
      },
      tool: this.executor?.constructor.name || 'none',
    };
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): SandboxConfig {
    return {
      workingDirectory: process.cwd(),
      filesystem: {
        readPaths: [],
        writePaths: [],
        execPaths: [],
        denyPaths: [],
      },
      network: {
        allowOutbound: false,
        allowLocalhost: false,
        allowDns: false,
      },
      process: {
        maxMemoryMB: 512,
        timeoutSeconds: 60,
        allowFork: true,
        allowExec: true,
        maxOpenFiles: 256,
        maxProcesses: 10,
      },
      ...this.defaultConfig,
    };
  }

  /**
   * Merge partial config with defaults
   */
  private mergeConfig(partial?: Partial<SandboxConfig>): SandboxConfig {
    const defaults = this.getDefaultConfig();

    if (!partial) {
      return defaults;
    }

    return this.deepMerge(defaults, partial) as SandboxConfig;
  }

  /**
   * Deep merge two objects
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue !== undefined &&
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(targetValue, sourceValue);
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue;
      }
    }

    return result;
  }
}

/**
 * Factory function to create a SandboxManager
 */
export function createSandboxManager(
  logger?: Logger,
  defaultConfig?: Partial<SandboxConfig>
): SandboxManager {
  return new SandboxManager(logger, defaultConfig);
}
