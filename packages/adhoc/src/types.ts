// ============================================================================
// Mycelium Adhoc Agent - Type Definitions
// ============================================================================

import type { Logger } from '@mycelium/shared';

/**
 * Adhoc agent configuration
 */
export interface AdhocConfig {
  /** Logger instance */
  logger: Logger;

  /** Model to use */
  model?: string;

  /** Maximum turns before stopping */
  maxTurns?: number;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Whether to require approval for dangerous operations */
  requireApproval?: boolean;

  /** Allowed tool patterns (if restricted mode) */
  allowedToolPatterns?: string[];

  /** Denied tool patterns */
  deniedToolPatterns?: string[];

  /** Working directory for file operations */
  workingDirectory?: string;
}

/**
 * Adhoc agent state
 */
export interface AdhocState {
  /** Agent ID */
  id: string;

  /** Current status */
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_approval';

  /** Current task if running */
  currentTask?: AdhocTask;

  /** Last result if completed */
  lastResult?: AdhocResult;

  /** Pending approval if awaiting */
  pendingApproval?: ApprovalRequest;

  /** Error if failed */
  error?: string;

  /** Created timestamp */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivityAt: Date;

  /** Total tasks executed */
  tasksExecuted: number;

  /** Total tool calls made */
  toolCallsMade: number;
}

/**
 * Task for adhoc agent
 */
export interface AdhocTask {
  /** Task ID */
  id: string;

  /** Task prompt/instruction */
  prompt: string;

  /** Context to pass */
  context?: Record<string, unknown>;

  /** Created timestamp */
  createdAt: Date;
}

/**
 * Result from adhoc task
 */
export interface AdhocResult {
  /** Task ID */
  taskId: string;

  /** Whether the task succeeded */
  success: boolean;

  /** Result content */
  content: string;

  /** Tools that were called */
  toolCalls?: AdhocToolCall[];

  /** Error message if failed */
  error?: string;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Completed timestamp */
  completedAt: Date;
}

/**
 * Record of a tool call made by adhoc agent
 */
export interface AdhocToolCall {
  /** Tool name */
  name: string;

  /** Arguments passed */
  args: Record<string, unknown>;

  /** Result */
  result?: unknown;

  /** Whether approval was required */
  requiredApproval: boolean;

  /** Whether approval was granted */
  approvalGranted?: boolean;

  /** Error if failed */
  error?: string;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Approval request for dangerous operations
 */
export interface ApprovalRequest {
  /** Request ID */
  id: string;

  /** Tool being called */
  toolName: string;

  /** Tool arguments */
  toolArgs: Record<string, unknown>;

  /** Reason for requiring approval */
  reason: string;

  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Created timestamp */
  createdAt: Date;
}

/**
 * Approval response
 */
export interface ApprovalResponse {
  /** Request ID */
  requestId: string;

  /** Whether approved */
  approved: boolean;

  /** Reason for decision */
  reason?: string;

  /** Responded timestamp */
  respondedAt: Date;
}

/**
 * Dangerous tool categories that may require approval
 */
export const DANGEROUS_TOOL_CATEGORIES = {
  /** File system write/delete operations */
  FILE_WRITE: ['filesystem__write_file', 'filesystem__delete_file', 'filesystem__move_file'],
  /** Shell/bash execution */
  SHELL_EXEC: ['shell__exec', 'bash__run', 'sandbox__exec'],
  /** Network operations */
  NETWORK: ['http__request', 'fetch__url'],
  /** Database modifications */
  DATABASE: ['postgres__execute', 'database__write'],
} as const;

/**
 * Options for executing a task
 */
export interface ExecuteOptions {
  /** Task prompt */
  prompt: string;

  /** Additional context */
  context?: Record<string, unknown>;

  /** Override approval requirement */
  requireApproval?: boolean;

  /** Timeout override */
  timeout?: number;

  /** Max turns override */
  maxTurns?: number;
}

/**
 * Event types emitted by adhoc agent
 */
export type AdhocEvent =
  | { type: 'task:started'; task: AdhocTask }
  | { type: 'task:completed'; result: AdhocResult }
  | { type: 'task:failed'; error: string }
  | { type: 'tool:called'; toolCall: AdhocToolCall }
  | { type: 'approval:required'; request: ApprovalRequest }
  | { type: 'approval:responded'; response: ApprovalResponse };
