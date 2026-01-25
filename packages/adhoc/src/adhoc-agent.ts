// ============================================================================
// Mycelium Adhoc Agent - Unrestricted Agent for Edge Cases
// ============================================================================

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { Logger } from '@mycelium/shared';
import type {
  AdhocConfig,
  AdhocState,
  AdhocTask,
  AdhocResult,
  AdhocToolCall,
  ApprovalRequest,
  ApprovalResponse,
  ExecuteOptions,
  AdhocEvent,
} from './types.js';
import { DANGEROUS_TOOL_CATEGORIES } from './types.js';

/**
 * AdhocAgent handles unrestricted tasks that don't fit skill-based workers.
 *
 * Key principles:
 * - Unrestricted tool access (not skill-limited)
 * - For edge cases: bash execution, file editing, one-off tasks
 * - Parallel to Orchestrator (not hierarchical)
 * - Optional approval workflow for dangerous operations
 */
export class AdhocAgent extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: AdhocConfig;
  private state: AdhocState;
  private approvalCallback?: (request: ApprovalRequest) => Promise<ApprovalResponse>;

  constructor(config: AdhocConfig) {
    super();
    this.logger = config.logger;
    this.config = {
      model: 'claude-sonnet-4-20250514',
      maxTurns: 50,
      timeout: 600000, // 10 minutes
      requireApproval: true,
      ...config,
    };

    this.state = {
      id: `adhoc-${uuidv4().slice(0, 8)}`,
      status: 'idle',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      tasksExecuted: 0,
      toolCallsMade: 0,
    };

    this.logger.debug('AdhocAgent created', {
      id: this.state.id,
      requireApproval: this.config.requireApproval,
    });
  }

  /**
   * Get agent ID
   */
  getId(): string {
    return this.state.id;
  }

  /**
   * Get current state
   */
  getState(): AdhocState {
    return { ...this.state };
  }

  /**
   * Set approval callback for handling dangerous operations
   */
  setApprovalCallback(callback: (request: ApprovalRequest) => Promise<ApprovalResponse>): void {
    this.approvalCallback = callback;
  }

  /**
   * Check if a tool requires approval
   */
  requiresApproval(toolName: string): { required: boolean; reason: string; riskLevel: ApprovalRequest['riskLevel'] } {
    if (!this.config.requireApproval) {
      return { required: false, reason: '', riskLevel: 'low' };
    }

    // Check denied patterns first
    if (this.config.deniedToolPatterns) {
      for (const pattern of this.config.deniedToolPatterns) {
        if (this.matchesPattern(toolName, pattern)) {
          return {
            required: true,
            reason: `Tool matches denied pattern: ${pattern}`,
            riskLevel: 'critical',
          };
        }
      }
    }

    // Check dangerous categories
    for (const [category, tools] of Object.entries(DANGEROUS_TOOL_CATEGORIES)) {
      if (tools.some(t => toolName.includes(t) || toolName.endsWith(t.split('__')[1]))) {
        return {
          required: true,
          reason: `Tool belongs to dangerous category: ${category}`,
          riskLevel: this.getRiskLevel(category),
        };
      }
    }

    // Check if tool matches allowed patterns (if specified)
    if (this.config.allowedToolPatterns && this.config.allowedToolPatterns.length > 0) {
      const isAllowed = this.config.allowedToolPatterns.some(p => this.matchesPattern(toolName, p));
      if (!isAllowed) {
        return {
          required: true,
          reason: 'Tool not in allowed patterns',
          riskLevel: 'medium',
        };
      }
    }

    return { required: false, reason: '', riskLevel: 'low' };
  }

  /**
   * Match tool name against pattern
   */
  private matchesPattern(toolName: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return toolName.startsWith(pattern.slice(0, -1));
    }
    return toolName === pattern;
  }

  /**
   * Get risk level for a category
   */
  private getRiskLevel(category: string): ApprovalRequest['riskLevel'] {
    switch (category) {
      case 'SHELL_EXEC':
        return 'critical';
      case 'FILE_WRITE':
        return 'high';
      case 'DATABASE':
        return 'high';
      case 'NETWORK':
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Request approval for a tool call
   */
  async requestApproval(toolName: string, toolArgs: Record<string, unknown>): Promise<ApprovalResponse> {
    const approvalInfo = this.requiresApproval(toolName);

    const request: ApprovalRequest = {
      id: uuidv4(),
      toolName,
      toolArgs,
      reason: approvalInfo.reason,
      riskLevel: approvalInfo.riskLevel,
      createdAt: new Date(),
    };

    this.state.status = 'awaiting_approval';
    this.state.pendingApproval = request;

    this.emit('event', { type: 'approval:required', request } as AdhocEvent);
    this.logger.warn('Approval required', {
      requestId: request.id,
      toolName,
      riskLevel: request.riskLevel,
    });

    // If no callback set, auto-deny
    if (!this.approvalCallback) {
      this.logger.warn('No approval callback set, auto-denying');
      return {
        requestId: request.id,
        approved: false,
        reason: 'No approval callback configured',
        respondedAt: new Date(),
      };
    }

    try {
      const response = await this.approvalCallback(request);
      this.state.pendingApproval = undefined;
      this.state.status = 'running';

      this.emit('event', { type: 'approval:responded', response } as AdhocEvent);
      this.logger.info('Approval response received', {
        requestId: request.id,
        approved: response.approved,
      });

      return response;
    } catch (error) {
      this.state.pendingApproval = undefined;
      this.state.status = 'running';

      return {
        requestId: request.id,
        approved: false,
        reason: `Approval callback error: ${error}`,
        respondedAt: new Date(),
      };
    }
  }

  /**
   * Execute a task
   */
  async execute(options: ExecuteOptions): Promise<AdhocResult> {
    const { prompt, context, timeout } = options;

    if (this.state.status === 'running') {
      throw new Error('Agent is already running a task');
    }

    const task: AdhocTask = {
      id: uuidv4(),
      prompt,
      context,
      createdAt: new Date(),
    };

    this.state.status = 'running';
    this.state.currentTask = task;
    this.state.lastActivityAt = new Date();

    this.emit('event', { type: 'task:started', task } as AdhocEvent);
    this.logger.info('Task started', { taskId: task.id });

    const startTime = Date.now();
    const toolCalls: AdhocToolCall[] = [];

    try {
      // Execute the task
      const result = await this.runTask(task, toolCalls, timeout || this.config.timeout!);

      this.state.status = 'completed';
      this.state.lastResult = result;
      this.state.currentTask = undefined;
      this.state.tasksExecuted++;
      this.state.toolCallsMade += toolCalls.length;
      this.state.lastActivityAt = new Date();

      this.emit('event', { type: 'task:completed', result } as AdhocEvent);
      this.logger.info('Task completed', {
        taskId: task.id,
        success: result.success,
        toolCalls: toolCalls.length,
      });

      // Reset to idle
      this.state.status = 'idle';

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const failedResult: AdhocResult = {
        taskId: task.id,
        success: false,
        content: '',
        toolCalls,
        error: errorMessage,
        executionTime: Date.now() - startTime,
        completedAt: new Date(),
      };

      this.state.status = 'failed';
      this.state.error = errorMessage;
      this.state.lastResult = failedResult;
      this.state.currentTask = undefined;
      this.state.lastActivityAt = new Date();

      this.emit('event', { type: 'task:failed', error: errorMessage } as AdhocEvent);
      this.logger.error('Task failed', { taskId: task.id, error: errorMessage });

      throw error;
    }
  }

  /**
   * Run task (placeholder - will be implemented with actual agent execution)
   */
  private async runTask(
    task: AdhocTask,
    toolCalls: AdhocToolCall[],
    _timeout: number
  ): Promise<AdhocResult> {
    // This is a placeholder implementation
    // In the real implementation, this would:
    // 1. Create a Claude Agent SDK session
    // 2. Configure with unrestricted tool access
    // 3. Execute the task prompt
    // 4. For each tool call:
    //    - Check if approval is required
    //    - Request approval if needed
    //    - Execute or skip based on approval
    // 5. Collect all tool calls and results

    const startTime = Date.now();

    this.logger.debug('Running adhoc task', {
      taskId: task.id,
      requireApproval: this.config.requireApproval,
    });

    // Placeholder: simulate task execution
    // Real implementation would use Claude Agent SDK here
    return {
      taskId: task.id,
      success: true,
      content: `[Placeholder] Adhoc task executed: ${task.prompt.slice(0, 50)}...`,
      toolCalls,
      executionTime: Date.now() - startTime,
      completedAt: new Date(),
    };
  }

  /**
   * Simulate a tool call (for testing approval flow)
   */
  async simulateToolCall(toolName: string, toolArgs: Record<string, unknown>): Promise<AdhocToolCall> {
    const approvalInfo = this.requiresApproval(toolName);

    const toolCall: AdhocToolCall = {
      name: toolName,
      args: toolArgs,
      requiredApproval: approvalInfo.required,
      timestamp: new Date(),
    };

    if (approvalInfo.required) {
      const response = await this.requestApproval(toolName, toolArgs);
      toolCall.approvalGranted = response.approved;

      if (!response.approved) {
        toolCall.error = `Approval denied: ${response.reason}`;
      }
    }

    this.emit('event', { type: 'tool:called', toolCall } as AdhocEvent);
    this.state.toolCallsMade++;

    return toolCall;
  }

  /**
   * Reset agent state
   */
  reset(): void {
    this.state = {
      ...this.state,
      status: 'idle',
      currentTask: undefined,
      lastResult: undefined,
      pendingApproval: undefined,
      error: undefined,
      lastActivityAt: new Date(),
    };
    this.logger.debug('Agent reset', { id: this.state.id });
  }

  /**
   * Get execution history summary
   */
  getHistorySummary(): {
    tasksExecuted: number;
    toolCallsMade: number;
    uptime: number;
  } {
    return {
      tasksExecuted: this.state.tasksExecuted,
      toolCallsMade: this.state.toolCallsMade,
      uptime: Date.now() - this.state.createdAt.getTime(),
    };
  }
}

/**
 * Factory function to create an AdhocAgent instance
 */
export function createAdhocAgent(config: AdhocConfig): AdhocAgent {
  return new AdhocAgent(config);
}
