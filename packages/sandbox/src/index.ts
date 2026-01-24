// ============================================================================
// @mycelium/sandbox - Secure Code Execution with OS-level Isolation
// ============================================================================

export const SANDBOX_VERSION = '1.0.0';

// Types
export type {
  SandboxPlatform,
  SandboxProfile,
  PathPermission,
  NetworkConfig,
  ProcessConfig,
  SandboxConfig,
  SandboxResult,
  SandboxViolation,
  SandboxRequest,
  SkillSandboxConfig,
} from './types.js';

export { SANDBOX_PROFILES } from './types.js';

// Executor base class
export { SandboxExecutor, UnsandboxedExecutor } from './executor.js';

// Platform-specific executors
export { LinuxSandboxExecutor } from './linux-executor.js';
export { DarwinSandboxExecutor } from './darwin-executor.js';

// Manager
export { SandboxManager, createSandboxManager } from './sandbox-manager.js';
