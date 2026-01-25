// ============================================================================
// Mycelium Orchestrator - Type Definitions
// ============================================================================

import type { BaseSkillDefinition, Logger } from '@mycelium/shared';

/**
 * Worker configuration
 */
export interface WorkerConfig {
  /** Worker identifier */
  id: string;

  /** Skill ID that defines this worker's capabilities */
  skillId: string;

  /** Role ID derived from skill */
  roleId: string;

  /** Model to use for this worker */
  model?: string;

  /** Maximum turns before stopping */
  maxTurns?: number;

  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Worker state
 */
export interface WorkerState {
  /** Worker ID */
  id: string;

  /** Current status */
  status: 'idle' | 'running' | 'completed' | 'failed';

  /** Skill this worker is using */
  skillId: string;

  /** Role this worker is using */
  roleId: string;

  /** Available tools for this worker */
  availableTools: string[];

  /** Current task if running */
  currentTask?: WorkerTask;

  /** Last result if completed */
  lastResult?: WorkerResult;

  /** Error if failed */
  error?: string;

  /** Created timestamp */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivityAt: Date;
}

/**
 * Task to be executed by a worker
 */
export interface WorkerTask {
  /** Task ID */
  id: string;

  /** Task prompt/instruction */
  prompt: string;

  /** Context to pass to the worker */
  context?: Record<string, unknown>;

  /** Priority (higher = more urgent) */
  priority?: number;

  /** Created timestamp */
  createdAt: Date;
}

/**
 * Result from a worker task
 */
export interface WorkerResult {
  /** Task ID */
  taskId: string;

  /** Worker ID that executed the task */
  workerId: string;

  /** Whether the task succeeded */
  success: boolean;

  /** Result content */
  content: string;

  /** Tools that were called */
  toolCalls?: ToolCallRecord[];

  /** Error message if failed */
  error?: string;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Completed timestamp */
  completedAt: Date;
}

/**
 * Record of a tool call made by a worker
 */
export interface ToolCallRecord {
  /** Tool name */
  name: string;

  /** Arguments passed */
  args: Record<string, unknown>;

  /** Result */
  result?: unknown;

  /** Error if failed */
  error?: string;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  /** Logger instance */
  logger: Logger;

  /** Default model for workers */
  defaultModel?: string;

  /** Maximum concurrent workers */
  maxConcurrentWorkers?: number;

  /** Default timeout for workers */
  defaultTimeout?: number;

  /** Skills manifest (loaded from MCP server) */
  skills?: BaseSkillDefinition[];
}

/**
 * Orchestrator state
 */
export interface OrchestratorState {
  /** Active workers */
  workers: Map<string, WorkerState>;

  /** Pending tasks queue */
  pendingTasks: WorkerTask[];

  /** Completed results */
  completedResults: WorkerResult[];

  /** Available skills */
  availableSkills: BaseSkillDefinition[];

  /** Is running */
  isRunning: boolean;
}

/**
 * Options for spawning a worker
 */
export interface SpawnWorkerOptions {
  /** Skill ID to use */
  skillId: string;

  /** Optional worker ID (auto-generated if not provided) */
  workerId?: string;

  /** Model override */
  model?: string;

  /** Max turns override */
  maxTurns?: number;

  /** Timeout override */
  timeout?: number;
}

/**
 * Options for executing a task
 */
export interface ExecuteTaskOptions {
  /** Worker ID to use (spawns new if not exists) */
  workerId?: string;

  /** Skill ID (required if workerId not provided) */
  skillId?: string;

  /** Task prompt */
  prompt: string;

  /** Additional context */
  context?: Record<string, unknown>;

  /** Wait for completion */
  wait?: boolean;

  /** Timeout override */
  timeout?: number;
}

/**
 * Event types emitted by the orchestrator
 */
export type OrchestratorEvent =
  | { type: 'worker:spawned'; worker: WorkerState }
  | { type: 'worker:started'; workerId: string; task: WorkerTask }
  | { type: 'worker:completed'; workerId: string; result: WorkerResult }
  | { type: 'worker:failed'; workerId: string; error: string }
  | { type: 'worker:terminated'; workerId: string }
  | { type: 'task:queued'; task: WorkerTask }
  | { type: 'task:assigned'; taskId: string; workerId: string };
