// ============================================================================
// Mycelium Sandbox Types
// OS-level isolation for secure code execution
// ============================================================================

/**
 * Supported platforms for sandboxing
 */
export type SandboxPlatform = 'linux' | 'darwin' | 'win32';

/**
 * Sandbox profile presets
 */
export type SandboxProfile = 'strict' | 'standard' | 'permissive';

/**
 * File system permission for a path
 */
export interface PathPermission {
  /** Path (absolute or relative to working directory) */
  path: string;

  /** Read access */
  read: boolean;

  /** Write access */
  write: boolean;

  /** Execute access (for directories: list contents) */
  execute?: boolean;
}

/**
 * Network restrictions
 */
export interface NetworkConfig {
  /** Allow outbound network connections */
  allowOutbound: boolean;

  /** Allowed destination hosts (if allowOutbound is true) */
  allowedHosts?: string[];

  /** Allowed destination ports (if allowOutbound is true) */
  allowedPorts?: number[];

  /** Allow localhost connections */
  allowLocalhost?: boolean;

  /** Allow DNS resolution */
  allowDns?: boolean;
}

/**
 * Process restrictions
 */
export interface ProcessConfig {
  /** Maximum memory in MB */
  maxMemoryMB: number;

  /** Execution timeout in seconds */
  timeoutSeconds: number;

  /** Allow forking child processes */
  allowFork: boolean;

  /** Allow executing other programs */
  allowExec: boolean;

  /** Maximum number of open file descriptors */
  maxOpenFiles?: number;

  /** Maximum number of child processes */
  maxProcesses?: number;
}

/**
 * Full sandbox configuration
 */
export interface SandboxConfig {
  /** Target platform (auto-detected if not specified) */
  platform?: SandboxPlatform;

  /** Working directory for the sandboxed process */
  workingDirectory: string;

  /** File system permissions */
  filesystem: {
    /** Paths with read access */
    readPaths: string[];

    /** Paths with write access */
    writePaths: string[];

    /** Paths with execute access */
    execPaths?: string[];

    /** Deny access to these paths (overrides allows) */
    denyPaths?: string[];
  };

  /** Network configuration */
  network: NetworkConfig;

  /** Process configuration */
  process: ProcessConfig;

  /** Environment variables to pass to the sandboxed process */
  environment?: Record<string, string>;

  /** Environment variables to block (security) */
  blockedEnvVars?: string[];
}

/**
 * Sandbox execution result
 */
export interface SandboxResult {
  /** Whether execution completed successfully */
  success: boolean;

  /** Exit code of the process */
  exitCode: number;

  /** Standard output */
  stdout: string;

  /** Standard error */
  stderr: string;

  /** Execution time in milliseconds */
  durationMs: number;

  /** Whether the process was killed due to timeout */
  timedOut: boolean;

  /** Whether the process was killed due to memory limit */
  memoryExceeded: boolean;

  /** Sandbox violations detected (if any) */
  violations?: SandboxViolation[];
}

/**
 * A sandbox policy violation
 */
export interface SandboxViolation {
  /** Type of violation */
  type: 'filesystem' | 'network' | 'process' | 'syscall';

  /** Description of the violation */
  description: string;

  /** Syscall that was blocked (if applicable) */
  syscall?: string;

  /** Path that was accessed (if applicable) */
  path?: string;

  /** Host that was accessed (if applicable) */
  host?: string;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Sandbox execution request
 */
export interface SandboxRequest {
  /** Command to execute */
  command: string;

  /** Command arguments */
  args?: string[];

  /** Standard input */
  stdin?: string;

  /** Sandbox configuration */
  config: SandboxConfig;
}

/**
 * Profile presets for common use cases
 */
export const SANDBOX_PROFILES: Record<SandboxProfile, Partial<SandboxConfig>> = {
  /** Strict: Minimal permissions, no network, limited filesystem */
  strict: {
    filesystem: {
      readPaths: [],
      writePaths: [],
      execPaths: [],
      denyPaths: ['/etc/passwd', '/etc/shadow', '~/.ssh', '~/.gnupg'],
    },
    network: {
      allowOutbound: false,
      allowLocalhost: false,
      allowDns: false,
    },
    process: {
      maxMemoryMB: 256,
      timeoutSeconds: 30,
      allowFork: false,
      allowExec: false,
      maxOpenFiles: 64,
      maxProcesses: 1,
    },
  },

  /** Standard: Balanced security with reasonable defaults */
  standard: {
    filesystem: {
      readPaths: ['/usr', '/lib', '/lib64', '/bin', '/opt'],
      writePaths: [],
      execPaths: ['/usr/bin', '/bin'],
      denyPaths: ['/etc/passwd', '/etc/shadow', '~/.ssh', '~/.gnupg'],
    },
    network: {
      allowOutbound: false,
      allowLocalhost: true,
      allowDns: true,
    },
    process: {
      maxMemoryMB: 512,
      timeoutSeconds: 60,
      allowFork: true,
      allowExec: true,
      maxOpenFiles: 256,
      maxProcesses: 10,
    },
  },

  /** Permissive: More relaxed for trusted code */
  permissive: {
    filesystem: {
      readPaths: ['/'],
      writePaths: [],
      execPaths: ['/usr/bin', '/bin', '/usr/local/bin'],
      denyPaths: ['~/.ssh', '~/.gnupg', '/etc/shadow'],
    },
    network: {
      allowOutbound: true,
      allowLocalhost: true,
      allowDns: true,
    },
    process: {
      maxMemoryMB: 1024,
      timeoutSeconds: 300,
      allowFork: true,
      allowExec: true,
      maxOpenFiles: 1024,
      maxProcesses: 50,
    },
  },
};

/**
 * Skill sandbox configuration (for SKILL.yaml)
 */
export interface SkillSandboxConfig {
  /** Enable sandbox for this skill */
  enabled: boolean;

  /** Use a preset profile */
  profile?: SandboxProfile;

  /** Custom configuration (merged with profile) */
  custom?: Partial<SandboxConfig>;
}
