/**
 * Tests for WorkflowAgent auto-escalation feature
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkflowAgent, WorkflowAgentConfig } from '../src/agents/workflow-agent.js';
import * as context from '../src/lib/context.js';

// Mock run method that will be tracked
const mockRun = vi.fn().mockResolvedValue(undefined);
const mockExecute = vi.fn().mockResolvedValue({ success: true });

// Mock the AdhocAgent as a class
vi.mock('../src/agents/adhoc-agent.js', () => {
  return {
    AdhocAgent: class MockAdhocAgent {
      config: any;
      constructor(config: any) {
        this.config = config;
        MockAdhocAgent.lastInstance = this;
        MockAdhocAgent.constructorCalls.push(config);
      }
      run = mockRun;
      execute = mockExecute;
      static lastInstance: any = null;
      static constructorCalls: any[] = [];
      static reset() {
        MockAdhocAgent.lastInstance = null;
        MockAdhocAgent.constructorCalls = [];
      }
    }
  };
});

// Import the mocked AdhocAgent to access static properties
import { AdhocAgent } from '../src/agents/adhoc-agent.js';

// Mock the context module
vi.mock('../src/lib/context.js', async () => {
  const actual = await vi.importActual('../src/lib/context.js');
  return {
    ...actual,
    writeContext: vi.fn().mockResolvedValue('/tmp/test-context.json'),
  };
});

describe('WorkflowAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockClear();
    mockExecute.mockClear();
    (AdhocAgent as any).reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('auto-escalation', () => {
    it('should create AdhocAgent with correct config when onFailure is auto', async () => {
      const config: WorkflowAgentConfig = {
        model: 'claude-sonnet-4-5-20250929',
        onFailure: 'auto',
        useApiKey: true,
      };

      const agent = new WorkflowAgent(config);

      // Access the private handleFailure method via any
      const agentAny = agent as any;
      agentAny.lastScriptCall = {
        skillId: 'test-skill',
        scriptPath: 'scripts/test.py',
        args: ['--verbose'],
      };
      agentAny.rl = {
        close: vi.fn(),
      };

      const mockResult = {
        success: false,
        exitCode: 1,
        stdout: 'output',
        stderr: 'error',
      };

      await agentAny.handleFailure(mockResult);

      // Verify AdhocAgent was created with the correct config
      const constructorCalls = (AdhocAgent as any).constructorCalls;
      expect(constructorCalls.length).toBe(1);
      expect(constructorCalls[0]).toEqual({
        model: 'claude-sonnet-4-5-20250929',
        contextPath: '/tmp/test-context.json',
        useApiKey: true,
      });

      // Verify run() was called on the AdhocAgent instance
      expect(mockRun).toHaveBeenCalled();
    });

    it('should close readline before starting adhoc agent', async () => {
      const config: WorkflowAgentConfig = {
        onFailure: 'auto',
      };

      const agent = new WorkflowAgent(config);
      const agentAny = agent as any;

      const closeMock = vi.fn();
      agentAny.lastScriptCall = {
        skillId: 'test-skill',
        scriptPath: 'scripts/test.py',
      };
      agentAny.rl = {
        close: closeMock,
      };

      const mockResult = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: '',
      };

      await agentAny.handleFailure(mockResult);

      expect(closeMock).toHaveBeenCalled();
      expect(agentAny.rl).toBeNull();
    });

    it('should not escalate when onFailure is prompt', async () => {
      const config: WorkflowAgentConfig = {
        onFailure: 'prompt',
      };

      const agent = new WorkflowAgent(config);
      const agentAny = agent as any;

      agentAny.lastScriptCall = {
        skillId: 'test-skill',
        scriptPath: 'scripts/test.py',
      };

      const mockResult = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: '',
      };

      await agentAny.handleFailure(mockResult);

      // AdhocAgent should NOT be created
      expect((AdhocAgent as any).constructorCalls.length).toBe(0);
    });

    it('should not escalate when onFailure is exit', async () => {
      const config: WorkflowAgentConfig = {
        onFailure: 'exit',
      };

      const agent = new WorkflowAgent(config);
      const agentAny = agent as any;

      agentAny.lastScriptCall = {
        skillId: 'test-skill',
        scriptPath: 'scripts/test.py',
      };

      const mockResult = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: '',
      };

      await agentAny.handleFailure(mockResult);

      // AdhocAgent should NOT be created
      expect((AdhocAgent as any).constructorCalls.length).toBe(0);
    });

    it('should save context before escalating', async () => {
      const config: WorkflowAgentConfig = {
        onFailure: 'auto',
      };

      const agent = new WorkflowAgent(config);
      const agentAny = agent as any;

      agentAny.lastScriptCall = {
        skillId: 'test-skill',
        scriptPath: 'scripts/test.py',
        args: ['arg1', 'arg2'],
      };
      agentAny.rl = {
        close: vi.fn(),
      };

      const mockResult = {
        success: false,
        exitCode: 2,
        stdout: 'test output',
        stderr: 'test error',
      };

      await agentAny.handleFailure(mockResult);

      // Verify writeContext was called with correct parameters
      expect(context.writeContext).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: 'test-skill',
          scriptPath: 'scripts/test.py',
          args: ['arg1', 'arg2'],
          error: expect.objectContaining({
            exitCode: 2,
            stdout: 'test output',
            stderr: 'test error',
          }),
        })
      );
    });

    it('should not escalate when no result is provided', async () => {
      const config: WorkflowAgentConfig = {
        onFailure: 'auto',
      };

      const agent = new WorkflowAgent(config);
      const agentAny = agent as any;

      agentAny.lastScriptCall = {
        skillId: 'test-skill',
        scriptPath: 'scripts/test.py',
      };

      await agentAny.handleFailure(null);

      // AdhocAgent should NOT be created when result is null
      expect((AdhocAgent as any).constructorCalls.length).toBe(0);
    });

    it('should not escalate when no lastScriptCall exists', async () => {
      const config: WorkflowAgentConfig = {
        onFailure: 'auto',
      };

      const agent = new WorkflowAgent(config);
      const agentAny = agent as any;

      agentAny.lastScriptCall = null;

      const mockResult = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: '',
      };

      await agentAny.handleFailure(mockResult);

      // AdhocAgent should NOT be created when lastScriptCall is null
      expect((AdhocAgent as any).constructorCalls.length).toBe(0);
    });
  });
});
