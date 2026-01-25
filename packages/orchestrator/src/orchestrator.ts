// ============================================================================
// Mycelium Orchestrator - Worker Agent Management
// ============================================================================

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { BaseSkillDefinition, Logger } from '@mycelium/shared';
import type {
  OrchestratorConfig,
  OrchestratorState,
  WorkerConfig,
  WorkerState,
  WorkerTask,
  WorkerResult,
  SpawnWorkerOptions,
  ExecuteTaskOptions,
  OrchestratorEvent,
  ToolCallRecord,
} from './types.js';

/**
 * Orchestrator manages worker agents with skill-based tool restrictions.
 *
 * Key principles:
 * - Workers are skill-restricted (only use tools from their assigned skill)
 * - Workers don't have access to set_role (they stay in their assigned role)
 * - Orchestrator coordinates multiple workers for complex tasks
 */
export class Orchestrator extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: OrchestratorConfig;
  private readonly state: OrchestratorState;
  private readonly skillMap: Map<string, BaseSkillDefinition>;

  constructor(config: OrchestratorConfig) {
    super();
    this.logger = config.logger;
    this.config = {
      defaultModel: 'claude-sonnet-4-20250514',
      maxConcurrentWorkers: 5,
      defaultTimeout: 300000, // 5 minutes
      ...config,
    };

    this.state = {
      workers: new Map(),
      pendingTasks: [],
      completedResults: [],
      availableSkills: config.skills || [],
      isRunning: false,
    };

    this.skillMap = new Map();
    for (const skill of this.state.availableSkills) {
      this.skillMap.set(skill.id, skill);
    }

    this.logger.debug('Orchestrator created', {
      maxConcurrentWorkers: this.config.maxConcurrentWorkers,
      availableSkills: this.state.availableSkills.length,
    });
  }

  /**
   * Load skills from manifest
   */
  loadSkills(skills: BaseSkillDefinition[]): void {
    this.state.availableSkills = skills;
    this.skillMap.clear();
    for (const skill of skills) {
      this.skillMap.set(skill.id, skill);
    }
    this.logger.info('Skills loaded', { count: skills.length });
  }

  /**
   * Get available skills
   */
  getAvailableSkills(): BaseSkillDefinition[] {
    return [...this.state.availableSkills];
  }

  /**
   * Get skill by ID
   */
  getSkill(skillId: string): BaseSkillDefinition | undefined {
    return this.skillMap.get(skillId);
  }

  /**
   * Spawn a new worker with a specific skill
   */
  spawnWorker(options: SpawnWorkerOptions): WorkerState {
    const skill = this.skillMap.get(options.skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${options.skillId}`);
    }

    // Derive role from skill
    const roleId = skill.allowedRoles[0];
    if (!roleId || roleId === '*') {
      throw new Error(`Skill ${options.skillId} has no valid role assignment`);
    }

    const workerId = options.workerId || `worker-${uuidv4().slice(0, 8)}`;

    // Check if worker already exists
    if (this.state.workers.has(workerId)) {
      throw new Error(`Worker already exists: ${workerId}`);
    }

    // Get available tools from skill
    const availableTools = this.getToolsForSkill(skill);

    const workerState: WorkerState = {
      id: workerId,
      status: 'idle',
      skillId: options.skillId,
      roleId,
      availableTools,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.state.workers.set(workerId, workerState);

    this.emit('event', { type: 'worker:spawned', worker: workerState } as OrchestratorEvent);
    this.logger.info('Worker spawned', {
      workerId,
      skillId: options.skillId,
      roleId,
      tools: availableTools.length,
    });

    return workerState;
  }

  /**
   * Get tools available for a skill
   */
  private getToolsForSkill(skill: BaseSkillDefinition): string[] {
    // Tools are defined in skill.allowedTools
    // These are the only tools the worker can use
    return [...skill.allowedTools];
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): WorkerState | undefined {
    return this.state.workers.get(workerId);
  }

  /**
   * Get all workers
   */
  getAllWorkers(): WorkerState[] {
    return [...this.state.workers.values()];
  }

  /**
   * Get workers by skill
   */
  getWorkersBySkill(skillId: string): WorkerState[] {
    return this.getAllWorkers().filter(w => w.skillId === skillId);
  }

  /**
   * Get idle workers
   */
  getIdleWorkers(): WorkerState[] {
    return this.getAllWorkers().filter(w => w.status === 'idle');
  }

  /**
   * Execute a task with a worker
   */
  async executeTask(options: ExecuteTaskOptions): Promise<WorkerResult> {
    const { prompt, context, timeout } = options;

    // Get or spawn worker
    let worker: WorkerState;
    if (options.workerId) {
      const existingWorker = this.state.workers.get(options.workerId);
      if (!existingWorker) {
        throw new Error(`Worker not found: ${options.workerId}`);
      }
      worker = existingWorker;
    } else if (options.skillId) {
      // Try to find an idle worker with the same skill
      const idleWorker = this.getWorkersBySkill(options.skillId).find(w => w.status === 'idle');
      if (idleWorker) {
        worker = idleWorker;
      } else {
        // Spawn a new worker
        worker = this.spawnWorker({ skillId: options.skillId });
      }
    } else {
      throw new Error('Either workerId or skillId must be provided');
    }

    // Check if worker is available
    if (worker.status === 'running') {
      throw new Error(`Worker ${worker.id} is already running a task`);
    }

    // Create task
    const task: WorkerTask = {
      id: uuidv4(),
      prompt,
      context,
      createdAt: new Date(),
    };

    // Update worker state
    worker.status = 'running';
    worker.currentTask = task;
    worker.lastActivityAt = new Date();

    this.emit('event', { type: 'worker:started', workerId: worker.id, task } as OrchestratorEvent);
    this.logger.info('Task started', {
      taskId: task.id,
      workerId: worker.id,
      skillId: worker.skillId,
    });

    const startTime = Date.now();

    try {
      // Execute the task
      const result = await this.runWorkerTask(worker, task, timeout || this.config.defaultTimeout!);

      // Update worker state
      worker.status = 'completed';
      worker.lastResult = result;
      worker.currentTask = undefined;
      worker.lastActivityAt = new Date();

      this.state.completedResults.push(result);

      this.emit('event', { type: 'worker:completed', workerId: worker.id, result } as OrchestratorEvent);
      this.logger.info('Task completed', {
        taskId: task.id,
        workerId: worker.id,
        success: result.success,
        executionTime: result.executionTime,
      });

      // Reset to idle for reuse
      worker.status = 'idle';

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      worker.status = 'failed';
      worker.error = errorMessage;
      worker.currentTask = undefined;
      worker.lastActivityAt = new Date();

      const failedResult: WorkerResult = {
        taskId: task.id,
        workerId: worker.id,
        success: false,
        content: '',
        error: errorMessage,
        executionTime: Date.now() - startTime,
        completedAt: new Date(),
      };

      this.state.completedResults.push(failedResult);

      this.emit('event', { type: 'worker:failed', workerId: worker.id, error: errorMessage } as OrchestratorEvent);
      this.logger.error('Task failed', {
        taskId: task.id,
        workerId: worker.id,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Run a worker task (to be implemented with actual agent execution)
   */
  private async runWorkerTask(
    worker: WorkerState,
    task: WorkerTask,
    _timeout: number
  ): Promise<WorkerResult> {
    // This is a placeholder implementation
    // In the real implementation, this would:
    // 1. Create a Claude Agent SDK session
    // 2. Configure the agent with the worker's skill/role
    // 3. Filter available tools to only those in worker.availableTools
    // 4. Execute the task prompt
    // 5. Collect tool calls and results

    const toolCalls: ToolCallRecord[] = [];
    const startTime = Date.now();

    // Placeholder: simulate task execution
    // Real implementation would use Claude Agent SDK here
    this.logger.debug('Running worker task', {
      workerId: worker.id,
      taskId: task.id,
      availableTools: worker.availableTools,
    });

    // For now, return a placeholder result
    // This will be replaced with actual agent execution
    return {
      taskId: task.id,
      workerId: worker.id,
      success: true,
      content: `[Placeholder] Task executed by worker ${worker.id} with skill ${worker.skillId}`,
      toolCalls,
      executionTime: Date.now() - startTime,
      completedAt: new Date(),
    };
  }

  /**
   * Terminate a worker
   */
  terminateWorker(workerId: string): boolean {
    const worker = this.state.workers.get(workerId);
    if (!worker) {
      return false;
    }

    this.state.workers.delete(workerId);
    this.emit('event', { type: 'worker:terminated', workerId } as OrchestratorEvent);
    this.logger.info('Worker terminated', { workerId });

    return true;
  }

  /**
   * Terminate all workers
   */
  terminateAllWorkers(): void {
    for (const workerId of this.state.workers.keys()) {
      this.terminateWorker(workerId);
    }
  }

  /**
   * Get orchestrator state summary
   */
  getState(): {
    workerCount: number;
    idleWorkers: number;
    runningWorkers: number;
    pendingTasks: number;
    completedTasks: number;
    availableSkills: number;
  } {
    const workers = this.getAllWorkers();
    return {
      workerCount: workers.length,
      idleWorkers: workers.filter(w => w.status === 'idle').length,
      runningWorkers: workers.filter(w => w.status === 'running').length,
      pendingTasks: this.state.pendingTasks.length,
      completedTasks: this.state.completedResults.length,
      availableSkills: this.state.availableSkills.length,
    };
  }

  /**
   * Get completed results
   */
  getCompletedResults(limit?: number): WorkerResult[] {
    const results = [...this.state.completedResults];
    if (limit) {
      return results.slice(-limit);
    }
    return results;
  }

  /**
   * Clear completed results
   */
  clearCompletedResults(): void {
    this.state.completedResults = [];
  }
}

/**
 * Factory function to create an Orchestrator instance
 */
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return new Orchestrator(config);
}
