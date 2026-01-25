/**
 * Orchestrator Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Orchestrator, createOrchestrator } from '../src/orchestrator.js';
import type { BaseSkillDefinition, Logger } from '@mycelium/shared';

// Test logger
const testLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Test skills
const testSkills: BaseSkillDefinition[] = [
  {
    id: 'frontend-dev',
    displayName: 'Frontend Development',
    description: 'Frontend development tools',
    allowedRoles: ['developer'],
    allowedTools: ['filesystem__read_file', 'filesystem__write_file'],
  },
  {
    id: 'data-analysis',
    displayName: 'Data Analysis',
    description: 'Data analysis tools',
    allowedRoles: ['analyst'],
    allowedTools: ['postgres__query', 'filesystem__read_file'],
  },
  {
    id: 'code-review',
    displayName: 'Code Review',
    description: 'Code review tools',
    allowedRoles: ['reviewer', 'senior-developer'],
    allowedTools: ['filesystem__read_file', 'git__diff', 'git__log'],
  },
];

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new Orchestrator({
      logger: testLogger,
      skills: testSkills,
    });
  });

  describe('constructor', () => {
    it('should create orchestrator with config', () => {
      expect(orchestrator).toBeInstanceOf(Orchestrator);
    });

    it('should create orchestrator via factory function', () => {
      const orch = createOrchestrator({
        logger: testLogger,
        skills: testSkills,
      });
      expect(orch).toBeInstanceOf(Orchestrator);
    });

    it('should initialize with empty workers', () => {
      expect(orchestrator.getAllWorkers()).toHaveLength(0);
    });

    it('should load skills from config', () => {
      expect(orchestrator.getAvailableSkills()).toHaveLength(3);
    });
  });

  describe('loadSkills', () => {
    it('should load skills into orchestrator', () => {
      const newSkills: BaseSkillDefinition[] = [
        {
          id: 'test-skill',
          displayName: 'Test Skill',
          description: 'Test',
          allowedRoles: ['tester'],
          allowedTools: ['test__tool'],
        },
      ];

      orchestrator.loadSkills(newSkills);
      expect(orchestrator.getAvailableSkills()).toHaveLength(1);
      expect(orchestrator.getSkill('test-skill')).toBeDefined();
    });

    it('should replace existing skills', () => {
      orchestrator.loadSkills([]);
      expect(orchestrator.getAvailableSkills()).toHaveLength(0);
    });
  });

  describe('getSkill', () => {
    it('should return skill by ID', () => {
      const skill = orchestrator.getSkill('frontend-dev');
      expect(skill).toBeDefined();
      expect(skill?.displayName).toBe('Frontend Development');
    });

    it('should return undefined for unknown skill', () => {
      expect(orchestrator.getSkill('unknown')).toBeUndefined();
    });
  });

  describe('spawnWorker', () => {
    it('should spawn worker with skill', () => {
      const worker = orchestrator.spawnWorker({ skillId: 'frontend-dev' });

      expect(worker).toBeDefined();
      expect(worker.skillId).toBe('frontend-dev');
      expect(worker.roleId).toBe('developer');
      expect(worker.status).toBe('idle');
    });

    it('should assign tools from skill', () => {
      const worker = orchestrator.spawnWorker({ skillId: 'frontend-dev' });

      expect(worker.availableTools).toContain('filesystem__read_file');
      expect(worker.availableTools).toContain('filesystem__write_file');
      expect(worker.availableTools).toHaveLength(2);
    });

    it('should use first allowedRole from skill', () => {
      const worker = orchestrator.spawnWorker({ skillId: 'code-review' });
      expect(worker.roleId).toBe('reviewer');
    });

    it('should throw for unknown skill', () => {
      expect(() => {
        orchestrator.spawnWorker({ skillId: 'unknown-skill' });
      }).toThrow('Skill not found: unknown-skill');
    });

    it('should use custom worker ID if provided', () => {
      const worker = orchestrator.spawnWorker({
        skillId: 'frontend-dev',
        workerId: 'custom-worker-id',
      });

      expect(worker.id).toBe('custom-worker-id');
    });

    it('should throw if worker ID already exists', () => {
      orchestrator.spawnWorker({
        skillId: 'frontend-dev',
        workerId: 'worker-1',
      });

      expect(() => {
        orchestrator.spawnWorker({
          skillId: 'data-analysis',
          workerId: 'worker-1',
        });
      }).toThrow('Worker already exists: worker-1');
    });

    it('should emit worker:spawned event', () => {
      const handler = vi.fn();
      orchestrator.on('event', handler);

      orchestrator.spawnWorker({ skillId: 'frontend-dev' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'worker:spawned',
        })
      );
    });
  });

  describe('getWorker', () => {
    it('should return worker by ID', () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });

      const worker = orchestrator.getWorker('w1');
      expect(worker).toBeDefined();
      expect(worker?.id).toBe('w1');
    });

    it('should return undefined for unknown worker', () => {
      expect(orchestrator.getWorker('unknown')).toBeUndefined();
    });
  });

  describe('getAllWorkers', () => {
    it('should return all workers', () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });
      orchestrator.spawnWorker({ skillId: 'data-analysis', workerId: 'w2' });

      const workers = orchestrator.getAllWorkers();
      expect(workers).toHaveLength(2);
    });
  });

  describe('getWorkersBySkill', () => {
    it('should return workers with specific skill', () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w2' });
      orchestrator.spawnWorker({ skillId: 'data-analysis', workerId: 'w3' });

      const workers = orchestrator.getWorkersBySkill('frontend-dev');
      expect(workers).toHaveLength(2);
      expect(workers.every(w => w.skillId === 'frontend-dev')).toBe(true);
    });
  });

  describe('getIdleWorkers', () => {
    it('should return only idle workers', () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });
      orchestrator.spawnWorker({ skillId: 'data-analysis', workerId: 'w2' });

      const idleWorkers = orchestrator.getIdleWorkers();
      expect(idleWorkers).toHaveLength(2);
      expect(idleWorkers.every(w => w.status === 'idle')).toBe(true);
    });
  });

  describe('executeTask', () => {
    it('should execute task with existing worker', async () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });

      const result = await orchestrator.executeTask({
        workerId: 'w1',
        prompt: 'Test task',
      });

      expect(result).toBeDefined();
      expect(result.workerId).toBe('w1');
      expect(result.success).toBe(true);
    });

    it('should spawn new worker if skillId provided', async () => {
      const result = await orchestrator.executeTask({
        skillId: 'frontend-dev',
        prompt: 'Test task',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(orchestrator.getAllWorkers()).toHaveLength(1);
    });

    it('should reuse idle worker with same skill', async () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });

      await orchestrator.executeTask({
        skillId: 'frontend-dev',
        prompt: 'Test task',
      });

      // Should have reused w1, not spawned a new worker
      expect(orchestrator.getAllWorkers()).toHaveLength(1);
    });

    it('should throw if no workerId or skillId provided', async () => {
      await expect(
        orchestrator.executeTask({ prompt: 'Test task' })
      ).rejects.toThrow('Either workerId or skillId must be provided');
    });

    it('should throw for unknown worker ID', async () => {
      await expect(
        orchestrator.executeTask({ workerId: 'unknown', prompt: 'Test' })
      ).rejects.toThrow('Worker not found: unknown');
    });

    it('should emit task events', async () => {
      const handler = vi.fn();
      orchestrator.on('event', handler);

      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });
      await orchestrator.executeTask({ workerId: 'w1', prompt: 'Test' });

      const eventTypes = handler.mock.calls.map(c => c[0].type);
      expect(eventTypes).toContain('worker:spawned');
      expect(eventTypes).toContain('worker:started');
      expect(eventTypes).toContain('worker:completed');
    });

    it('should track completed results', async () => {
      await orchestrator.executeTask({
        skillId: 'frontend-dev',
        prompt: 'Test task',
      });

      const results = orchestrator.getCompletedResults();
      expect(results).toHaveLength(1);
    });
  });

  describe('terminateWorker', () => {
    it('should terminate worker by ID', () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });

      const result = orchestrator.terminateWorker('w1');

      expect(result).toBe(true);
      expect(orchestrator.getWorker('w1')).toBeUndefined();
    });

    it('should return false for unknown worker', () => {
      expect(orchestrator.terminateWorker('unknown')).toBe(false);
    });

    it('should emit worker:terminated event', () => {
      const handler = vi.fn();
      orchestrator.on('event', handler);

      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });
      orchestrator.terminateWorker('w1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'worker:terminated',
          workerId: 'w1',
        })
      );
    });
  });

  describe('terminateAllWorkers', () => {
    it('should terminate all workers', () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });
      orchestrator.spawnWorker({ skillId: 'data-analysis', workerId: 'w2' });

      orchestrator.terminateAllWorkers();

      expect(orchestrator.getAllWorkers()).toHaveLength(0);
    });
  });

  describe('getState', () => {
    it('should return orchestrator state summary', async () => {
      orchestrator.spawnWorker({ skillId: 'frontend-dev', workerId: 'w1' });
      await orchestrator.executeTask({ workerId: 'w1', prompt: 'Test' });

      const state = orchestrator.getState();

      expect(state.workerCount).toBe(1);
      expect(state.idleWorkers).toBe(1);
      expect(state.completedTasks).toBe(1);
      expect(state.availableSkills).toBe(3);
    });
  });

  describe('getCompletedResults', () => {
    it('should return completed results', async () => {
      await orchestrator.executeTask({ skillId: 'frontend-dev', prompt: 'Task 1' });
      await orchestrator.executeTask({ skillId: 'frontend-dev', prompt: 'Task 2' });

      const results = orchestrator.getCompletedResults();
      expect(results).toHaveLength(2);
    });

    it('should limit results if specified', async () => {
      await orchestrator.executeTask({ skillId: 'frontend-dev', prompt: 'Task 1' });
      await orchestrator.executeTask({ skillId: 'frontend-dev', prompt: 'Task 2' });
      await orchestrator.executeTask({ skillId: 'frontend-dev', prompt: 'Task 3' });

      const results = orchestrator.getCompletedResults(2);
      expect(results).toHaveLength(2);
    });
  });

  describe('clearCompletedResults', () => {
    it('should clear completed results', async () => {
      await orchestrator.executeTask({ skillId: 'frontend-dev', prompt: 'Test' });

      orchestrator.clearCompletedResults();

      expect(orchestrator.getCompletedResults()).toHaveLength(0);
    });
  });
});

describe('Orchestrator - Skill-based Tool Restrictions', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator({
      logger: testLogger,
      skills: testSkills,
    });
  });

  it('should restrict worker tools to skill allowedTools', () => {
    const frontendWorker = orchestrator.spawnWorker({ skillId: 'frontend-dev' });
    const dataWorker = orchestrator.spawnWorker({ skillId: 'data-analysis' });

    // Frontend worker should only have filesystem tools
    expect(frontendWorker.availableTools).toContain('filesystem__read_file');
    expect(frontendWorker.availableTools).toContain('filesystem__write_file');
    expect(frontendWorker.availableTools).not.toContain('postgres__query');

    // Data worker should have postgres and filesystem read
    expect(dataWorker.availableTools).toContain('postgres__query');
    expect(dataWorker.availableTools).toContain('filesystem__read_file');
    expect(dataWorker.availableTools).not.toContain('filesystem__write_file');
  });

  it('should not include set_role in worker tools', () => {
    const worker = orchestrator.spawnWorker({ skillId: 'frontend-dev' });

    // Workers should NEVER have set_role
    expect(worker.availableTools).not.toContain('set_role');
    expect(worker.availableTools).not.toContain('mycelium-router__set_role');
  });
});
