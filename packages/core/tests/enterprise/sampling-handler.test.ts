// ============================================================================
// AEGIS Enterprise MCP - Sampling Handler Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SamplingHandler,
  createSamplingHandler,
  createMockLLMClient,
  SamplingDisabledError,
  SamplingNotAllowedError,
  SamplingRateLimitError,
  SamplingDeniedError,
  type LLMClient,
} from '../../src/sampling/sampling-handler.js';
import type { Logger, SamplingConfig, CreateMessageRequest, HITLPolicy } from '@aegis/shared';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('SamplingHandler', () => {
  let logger: Logger;
  let handler: SamplingHandler;
  let mockLLMClient: LLMClient;

  beforeEach(() => {
    logger = createMockLogger();
    mockLLMClient = createMockLLMClient('anthropic', 'Test response');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should create handler with default config', () => {
      handler = createSamplingHandler(logger);
      const config = handler.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.approvalMode).toBe('policy-based');
      expect(config.defaultModel).toBe('claude-3-5-haiku-latest');
    });

    it('should create handler with custom config', () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        defaultModel: 'gpt-4',
        maxTokensLimit: 8192,
      });

      const config = handler.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.defaultModel).toBe('gpt-4');
      expect(config.maxTokensLimit).toBe(8192);
    });

    it('should update config dynamically', () => {
      handler = createSamplingHandler(logger);
      handler.updateConfig({ enabled: true });

      expect(handler.getConfig().enabled).toBe(true);
    });
  });

  describe('Sampling Disabled', () => {
    it('should throw error when sampling is disabled', async () => {
      handler = createSamplingHandler(logger, { enabled: false });

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      await expect(
        handler.handleCreateMessage('test-server', request, 'user')
      ).rejects.toThrow(SamplingDisabledError);
    });
  });

  describe('Server Allowlist/Blocklist', () => {
    it('should block servers on blocklist', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        blockedServers: ['blocked-server'],
      });

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      await expect(
        handler.handleCreateMessage('blocked-server', request, 'user')
      ).rejects.toThrow(SamplingNotAllowedError);
    });

    it('should allow servers on allowlist', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        allowedServers: ['allowed-server'],
        approvalMode: 'never',
      });
      handler.registerLLMClient('anthropic', mockLLMClient);

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      const result = await handler.handleCreateMessage('allowed-server', request, 'user');
      expect(result.role).toBe('assistant');
    });

    it('should block servers not on allowlist', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        allowedServers: ['allowed-server'],
      });

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      await expect(
        handler.handleCreateMessage('other-server', request, 'user')
      ).rejects.toThrow(SamplingNotAllowedError);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce requests per minute limit', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'never',
        rateLimits: {
          maxRequestsPerMinute: 2,
          maxRequestsPerHour: 100,
          maxTokensPerHour: 10000,
        },
      });
      handler.registerLLMClient('anthropic', mockLLMClient);

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      // First two requests should succeed
      await handler.handleCreateMessage('test-server', request, 'user');
      await handler.handleCreateMessage('test-server', request, 'user');

      // Third request should be rate limited
      await expect(
        handler.handleCreateMessage('test-server', request, 'user')
      ).rejects.toThrow(SamplingRateLimitError);
    });
  });

  describe('Approval Modes', () => {
    it('should auto-approve in never mode', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'never',
      });
      handler.registerLLMClient('anthropic', mockLLMClient);

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      const result = await handler.handleCreateMessage('test-server', request, 'user');
      expect(result.content.type).toBe('text');
    });

    it('should emit approval-needed in always mode', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'always',
      });
      handler.registerLLMClient('anthropic', mockLLMClient);

      const approvalPromise = new Promise<void>((resolve) => {
        handler.on('approval-needed', (request) => {
          // Auto-approve for test
          handler.respondToApproval({
            requestId: request.id,
            approved: true,
            respondedAt: new Date(),
          });
          resolve();
        });
      });

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      const resultPromise = handler.handleCreateMessage('test-server', request, 'user');
      await approvalPromise;
      const result = await resultPromise;

      expect(result.role).toBe('assistant');
    });

    it('should deny when approval is rejected', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'always',
      });

      handler.on('approval-needed', (request) => {
        handler.respondToApproval({
          requestId: request.id,
          approved: false,
          reason: 'User denied',
          respondedAt: new Date(),
        });
      });

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      await expect(
        handler.handleCreateMessage('test-server', request, 'user')
      ).rejects.toThrow(SamplingDeniedError);
    });
  });

  describe('Model Selection', () => {
    it('should use model hint when supported', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'never',
      });

      const specificClient = createMockLLMClient('anthropic', 'Opus response');
      handler.registerLLMClient('anthropic', specificClient);

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
        modelPreferences: {
          modelHints: ['claude-opus-4-5-20251101'],
        },
      };

      const result = await handler.handleCreateMessage('test-server', request, 'user');
      expect(result.model).toBe('claude-opus-4-5-20251101');
    });

    it('should use intelligence level for model selection', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'never',
        modelMapping: {
          basic: 'haiku',
          standard: 'sonnet',
          advanced: 'opus',
        },
      });
      handler.registerLLMClient('anthropic', mockLLMClient);

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
        modelPreferences: {
          intelligenceLevel: 'advanced',
        },
      };

      const result = await handler.handleCreateMessage('test-server', request, 'user');
      expect(result.model).toBe('opus');
    });
  });

  describe('Statistics', () => {
    it('should track request statistics', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'never',
      });
      handler.registerLLMClient('anthropic', mockLLMClient);

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      await handler.handleCreateMessage('server-a', request, 'user');
      await handler.handleCreateMessage('server-b', request, 'user');
      await handler.handleCreateMessage('server-a', request, 'user');

      const stats = handler.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.approvedRequests).toBe(3);
      expect(stats.requestsByServer['server-a']).toBe(2);
      expect(stats.requestsByServer['server-b']).toBe(1);
    });

    it('should reset statistics', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'never',
      });
      handler.registerLLMClient('anthropic', mockLLMClient);

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      await handler.handleCreateMessage('test-server', request, 'user');
      handler.resetStats();

      const stats = handler.getStats();
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('Pending Approvals', () => {
    it('should track pending approvals', async () => {
      handler = createSamplingHandler(logger, {
        enabled: true,
        approvalMode: 'always',
      });

      const request: CreateMessageRequest = {
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
      };

      // Start request but don't respond to approval
      const resultPromise = handler.handleCreateMessage('test-server', request, 'user');

      // Give it a moment to create the approval
      await new Promise((resolve) => setTimeout(resolve, 10));

      const pending = handler.getPendingApprovals();
      expect(pending.length).toBe(1);
      expect(pending[0].operationType).toBe('sampling');

      // Cleanup: respond to prevent hanging
      handler.respondToApproval({
        requestId: pending[0].id,
        approved: false,
        respondedAt: new Date(),
      });

      await expect(resultPromise).rejects.toThrow();
    });
  });
});
