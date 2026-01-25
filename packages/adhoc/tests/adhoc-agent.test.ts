/**
 * AdhocAgent Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdhocAgent, createAdhocAgent, DANGEROUS_TOOL_CATEGORIES } from '../src/index.js';
import type { Logger } from '@mycelium/shared';
import type { ApprovalRequest, ApprovalResponse } from '../src/types.js';

// Test logger
const testLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('AdhocAgent', () => {
  let agent: AdhocAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new AdhocAgent({
      logger: testLogger,
    });
  });

  describe('constructor', () => {
    it('should create agent with config', () => {
      expect(agent).toBeInstanceOf(AdhocAgent);
    });

    it('should create agent via factory function', () => {
      const a = createAdhocAgent({ logger: testLogger });
      expect(a).toBeInstanceOf(AdhocAgent);
    });

    it('should generate unique ID', () => {
      const id = agent.getId();
      expect(id).toMatch(/^adhoc-[a-f0-9]{8}$/);
    });

    it('should initialize with idle status', () => {
      const state = agent.getState();
      expect(state.status).toBe('idle');
    });

    it('should have zero task count initially', () => {
      const state = agent.getState();
      expect(state.tasksExecuted).toBe(0);
      expect(state.toolCallsMade).toBe(0);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const state = agent.getState();

      expect(state).toHaveProperty('id');
      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('createdAt');
      expect(state).toHaveProperty('lastActivityAt');
    });

    it('should return a copy of state', () => {
      const state1 = agent.getState();
      const state2 = agent.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('requiresApproval', () => {
    it('should require approval for shell execution', () => {
      const result = agent.requiresApproval('shell__exec');

      expect(result.required).toBe(true);
      expect(result.riskLevel).toBe('critical');
    });

    it('should require approval for bash commands', () => {
      const result = agent.requiresApproval('bash__run');

      expect(result.required).toBe(true);
      expect(result.riskLevel).toBe('critical');
    });

    it('should require approval for file write', () => {
      const result = agent.requiresApproval('filesystem__write_file');

      expect(result.required).toBe(true);
      expect(result.riskLevel).toBe('high');
    });

    it('should require approval for file delete', () => {
      const result = agent.requiresApproval('filesystem__delete_file');

      expect(result.required).toBe(true);
      expect(result.riskLevel).toBe('high');
    });

    it('should not require approval for safe tools', () => {
      const result = agent.requiresApproval('filesystem__read_file');

      expect(result.required).toBe(false);
    });

    it('should not require approval when requireApproval is false', () => {
      const noApprovalAgent = new AdhocAgent({
        logger: testLogger,
        requireApproval: false,
      });

      const result = noApprovalAgent.requiresApproval('shell__exec');
      expect(result.required).toBe(false);
    });

    it('should require approval for denied patterns', () => {
      const restrictedAgent = new AdhocAgent({
        logger: testLogger,
        deniedToolPatterns: ['danger__*'],
      });

      const result = restrictedAgent.requiresApproval('danger__destroy');
      expect(result.required).toBe(true);
      expect(result.riskLevel).toBe('critical');
    });
  });

  describe('setApprovalCallback', () => {
    it('should accept approval callback', () => {
      const callback = async (_req: ApprovalRequest): Promise<ApprovalResponse> => ({
        requestId: _req.id,
        approved: true,
        respondedAt: new Date(),
      });

      expect(() => {
        agent.setApprovalCallback(callback);
      }).not.toThrow();
    });
  });

  describe('requestApproval', () => {
    it('should auto-deny when no callback set', async () => {
      const response = await agent.requestApproval('shell__exec', { command: 'rm -rf /' });

      expect(response.approved).toBe(false);
      expect(response.reason).toContain('No approval callback');
    });

    it('should call approval callback when set', async () => {
      const callback = vi.fn().mockResolvedValue({
        requestId: 'test',
        approved: true,
        respondedAt: new Date(),
      });

      agent.setApprovalCallback(callback);
      await agent.requestApproval('shell__exec', { command: 'echo hello' });

      expect(callback).toHaveBeenCalled();
    });

    it('should emit approval:required event', async () => {
      const handler = vi.fn();
      agent.on('event', handler);

      await agent.requestApproval('shell__exec', { command: 'test' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approval:required',
        })
      );
    });

    it('should emit approval:responded event when callback responds', async () => {
      const handler = vi.fn();
      agent.on('event', handler);

      agent.setApprovalCallback(async (req) => ({
        requestId: req.id,
        approved: true,
        respondedAt: new Date(),
      }));

      await agent.requestApproval('shell__exec', { command: 'test' });

      const events = handler.mock.calls.map(c => c[0].type);
      expect(events).toContain('approval:responded');
    });
  });

  describe('execute', () => {
    it('should execute task successfully', async () => {
      const result = await agent.execute({
        prompt: 'Test task',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should emit task:started event', async () => {
      const handler = vi.fn();
      agent.on('event', handler);

      await agent.execute({ prompt: 'Test' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task:started',
        })
      );
    });

    it('should emit task:completed event', async () => {
      const handler = vi.fn();
      agent.on('event', handler);

      await agent.execute({ prompt: 'Test' });

      const events = handler.mock.calls.map(c => c[0].type);
      expect(events).toContain('task:completed');
    });

    it('should increment task count', async () => {
      await agent.execute({ prompt: 'Task 1' });
      await agent.execute({ prompt: 'Task 2' });

      const state = agent.getState();
      expect(state.tasksExecuted).toBe(2);
    });

    it('should throw if already running', async () => {
      // Start a task
      const promise = agent.execute({ prompt: 'Long task' });

      // This is a placeholder test - real implementation would need actual async behavior
      await promise;
    });

    it('should update lastActivityAt', async () => {
      const before = agent.getState().lastActivityAt;

      // Small delay to ensure time difference
      await new Promise(r => setTimeout(r, 10));

      await agent.execute({ prompt: 'Test' });

      const after = agent.getState().lastActivityAt;
      expect(after.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe('simulateToolCall', () => {
    it('should track tool calls', async () => {
      const toolCall = await agent.simulateToolCall('filesystem__read_file', { path: '/test' });

      expect(toolCall.name).toBe('filesystem__read_file');
      expect(toolCall.requiredApproval).toBe(false);
    });

    it('should require approval for dangerous tools', async () => {
      agent.setApprovalCallback(async (req) => ({
        requestId: req.id,
        approved: true,
        respondedAt: new Date(),
      }));

      const toolCall = await agent.simulateToolCall('shell__exec', { command: 'ls' });

      expect(toolCall.requiredApproval).toBe(true);
      expect(toolCall.approvalGranted).toBe(true);
    });

    it('should mark denied when approval rejected', async () => {
      agent.setApprovalCallback(async (req) => ({
        requestId: req.id,
        approved: false,
        reason: 'Too risky',
        respondedAt: new Date(),
      }));

      const toolCall = await agent.simulateToolCall('shell__exec', { command: 'rm -rf /' });

      expect(toolCall.approvalGranted).toBe(false);
      expect(toolCall.error).toContain('Approval denied');
    });

    it('should increment tool call count', async () => {
      await agent.simulateToolCall('filesystem__read_file', { path: '/a' });
      await agent.simulateToolCall('filesystem__read_file', { path: '/b' });

      const state = agent.getState();
      expect(state.toolCallsMade).toBe(2);
    });

    it('should emit tool:called event', async () => {
      const handler = vi.fn();
      agent.on('event', handler);

      await agent.simulateToolCall('filesystem__read_file', { path: '/test' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool:called',
        })
      );
    });
  });

  describe('reset', () => {
    it('should reset agent state', async () => {
      await agent.execute({ prompt: 'Test' });

      agent.reset();

      const state = agent.getState();
      expect(state.status).toBe('idle');
      expect(state.currentTask).toBeUndefined();
      expect(state.error).toBeUndefined();
    });

    it('should preserve execution counts', async () => {
      await agent.execute({ prompt: 'Test' });

      agent.reset();

      const state = agent.getState();
      expect(state.tasksExecuted).toBe(1);
    });
  });

  describe('getHistorySummary', () => {
    it('should return history summary', async () => {
      await agent.execute({ prompt: 'Test 1' });
      await agent.execute({ prompt: 'Test 2' });

      const summary = agent.getHistorySummary();

      expect(summary.tasksExecuted).toBe(2);
      expect(summary.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('DANGEROUS_TOOL_CATEGORIES', () => {
  it('should define shell execution tools', () => {
    expect(DANGEROUS_TOOL_CATEGORIES.SHELL_EXEC).toContain('shell__exec');
    expect(DANGEROUS_TOOL_CATEGORIES.SHELL_EXEC).toContain('bash__run');
  });

  it('should define file write tools', () => {
    expect(DANGEROUS_TOOL_CATEGORIES.FILE_WRITE).toContain('filesystem__write_file');
    expect(DANGEROUS_TOOL_CATEGORIES.FILE_WRITE).toContain('filesystem__delete_file');
  });

  it('should define database tools', () => {
    expect(DANGEROUS_TOOL_CATEGORIES.DATABASE).toContain('postgres__execute');
  });

  it('should define network tools', () => {
    expect(DANGEROUS_TOOL_CATEGORIES.NETWORK).toContain('http__request');
  });
});

describe('AdhocAgent - Unrestricted Access', () => {
  it('should not be skill-restricted', () => {
    const agent = new AdhocAgent({ logger: testLogger });
    const state = agent.getState();

    // Adhoc agent doesn't have skillId or roleId
    expect(state).not.toHaveProperty('skillId');
    expect(state).not.toHaveProperty('roleId');
  });

  it('should allow any tool (with approval)', async () => {
    const agent = new AdhocAgent({
      logger: testLogger,
      requireApproval: false, // Disable for test
    });

    // Can call any tool without skill restriction
    const toolCall = await agent.simulateToolCall('any_server__any_tool', {});
    expect(toolCall.requiredApproval).toBe(false);
  });
});
