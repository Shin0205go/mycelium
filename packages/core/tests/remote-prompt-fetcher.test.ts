/**
 * Unit tests for router/remote-prompt-fetcher.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RemotePromptFetcher,
  createRemotePromptFetcher,
  type PromptRouter,
} from '../src/router/remote-prompt-fetcher.js';
import type { Logger } from '@aegis/shared';
import type { RemoteInstruction } from '../src/types/router-types.js';

// Silent test logger
const createTestLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Mock router
const createMockRouter = (): PromptRouter => ({
  routeRequest: vi.fn(),
});

describe('RemotePromptFetcher', () => {
  let logger: Logger;
  let fetcher: RemotePromptFetcher;
  let mockRouter: PromptRouter;

  beforeEach(() => {
    logger = createTestLogger();
    fetcher = new RemotePromptFetcher(logger);
    mockRouter = createMockRouter();
  });

  describe('constructor', () => {
    it('should create fetcher', () => {
      expect(fetcher).toBeInstanceOf(RemotePromptFetcher);
    });
  });

  describe('createRemotePromptFetcher factory', () => {
    it('should create fetcher via factory', () => {
      const f = createRemotePromptFetcher(logger);
      expect(f).toBeInstanceOf(RemotePromptFetcher);
    });
  });

  describe('setRouter', () => {
    it('should set router', () => {
      expect(() => fetcher.setRouter(mockRouter)).not.toThrow();
    });
  });

  describe('fetchPrompt', () => {
    const config: RemoteInstruction = {
      backend: 'test-server',
      promptName: 'test-prompt',
    };

    describe('without router', () => {
      it('should return fallback when no router', async () => {
        const result = await fetcher.fetchPrompt(config);

        expect(result.success).toBe(false);
        expect(result.source).toBe('fallback');
        expect(result.error).toContain('No router');
      });

      it('should use provided fallback', async () => {
        const configWithFallback: RemoteInstruction = {
          ...config,
          fallback: 'Fallback content',
        };

        const result = await fetcher.fetchPrompt(configWithFallback);

        expect(result.success).toBe(true);
        expect(result.content).toBe('Fallback content');
        expect(result.source).toBe('fallback');
      });
    });

    describe('with router', () => {
      beforeEach(() => {
        fetcher.setRouter(mockRouter);
      });

      it('should fetch prompt successfully', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: {
            messages: [
              { role: 'system', content: 'System prompt content' },
            ],
          },
        });

        const result = await fetcher.fetchPrompt(config);

        expect(result.success).toBe(true);
        expect(result.content).toBe('System prompt content');
        expect(result.source).toBe('remote');
      });

      it('should handle text content objects', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: {
            messages: [
              { role: 'system', content: { type: 'text', text: 'Text content' } },
            ],
          },
        });

        const result = await fetcher.fetchPrompt(config);

        expect(result.success).toBe(true);
        expect(result.content).toBe('Text content');
      });

      it('should concatenate multiple messages', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: {
            messages: [
              { role: 'system', content: 'Line 1' },
              { role: 'user', content: 'Line 2' },
            ],
          },
        });

        const result = await fetcher.fetchPrompt(config);

        expect(result.content).toContain('Line 1');
        expect(result.content).toContain('Line 2');
      });

      it('should handle error response', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          error: { message: 'Not found' },
        });

        const result = await fetcher.fetchPrompt({
          ...config,
          fallback: 'Fallback',
        });

        expect(result.success).toBe(true);
        expect(result.source).toBe('fallback');
        expect(result.error).toBe('Not found');
      });

      it('should handle empty prompt', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: { messages: [] },
        });

        const result = await fetcher.fetchPrompt({
          ...config,
          fallback: 'Fallback',
        });

        expect(result.source).toBe('fallback');
      });

      it('should handle router exception', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('Network error')
        );

        const result = await fetcher.fetchPrompt({
          ...config,
          fallback: 'Fallback',
        });

        expect(result.success).toBe(true);
        expect(result.source).toBe('fallback');
        expect(result.error).toContain('Network error');
      });

      it('should handle direct string result', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: 'Direct string content',
        });

        const result = await fetcher.fetchPrompt(config);

        expect(result.success).toBe(true);
        expect(result.content).toBe('Direct string content');
      });

      it('should handle result.content', async () => {
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: { content: 'Content property' },
        });

        const result = await fetcher.fetchPrompt(config);

        expect(result.success).toBe(true);
        expect(result.content).toBe('Content property');
      });
    });

    describe('caching', () => {
      beforeEach(() => {
        fetcher.setRouter(mockRouter);
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: { messages: [{ content: 'Cached content' }] },
        });
      });

      it('should cache fetched prompts', async () => {
        await fetcher.fetchPrompt(config);
        const result = await fetcher.fetchPrompt(config);

        expect(result.source).toBe('cache');
        expect(mockRouter.routeRequest).toHaveBeenCalledTimes(1);
      });

      it('should not cache when cacheTtl is 0', async () => {
        const noCacheConfig: RemoteInstruction = {
          ...config,
          cacheTtl: 0,
        };

        await fetcher.fetchPrompt(noCacheConfig);
        await fetcher.fetchPrompt(noCacheConfig);

        expect(mockRouter.routeRequest).toHaveBeenCalledTimes(2);
      });

      it('should use different cache keys for different arguments', async () => {
        const config1: RemoteInstruction = {
          ...config,
          arguments: { arg1: 'value1' },
        };
        const config2: RemoteInstruction = {
          ...config,
          arguments: { arg1: 'value2' },
        };

        await fetcher.fetchPrompt(config1);
        await fetcher.fetchPrompt(config2);

        expect(mockRouter.routeRequest).toHaveBeenCalledTimes(2);
      });
    });

    describe('cache expiration', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        fetcher.setRouter(mockRouter);
        (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
          result: { messages: [{ content: 'Content' }] },
        });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should expire cache after TTL', async () => {
        const shortTtlConfig: RemoteInstruction = {
          ...config,
          cacheTtl: 60, // 60 seconds
        };

        await fetcher.fetchPrompt(shortTtlConfig);

        // Advance time past TTL
        vi.advanceTimersByTime(61 * 1000);

        await fetcher.fetchPrompt(shortTtlConfig);

        expect(mockRouter.routeRequest).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('clearCache', () => {
    it('should clear all cached entries', async () => {
      fetcher.setRouter(mockRouter);
      (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
        result: { messages: [{ content: 'Content' }] },
      });

      await fetcher.fetchPrompt({ backend: 'server', promptName: 'prompt1' });
      await fetcher.fetchPrompt({ backend: 'server', promptName: 'prompt2' });

      fetcher.clearCache();

      const stats = fetcher.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('invalidateCache', () => {
    it('should invalidate specific cache entry', async () => {
      fetcher.setRouter(mockRouter);
      (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
        result: { messages: [{ content: 'Content' }] },
      });

      const config1: RemoteInstruction = { backend: 'server', promptName: 'prompt1' };
      const config2: RemoteInstruction = { backend: 'server', promptName: 'prompt2' };

      await fetcher.fetchPrompt(config1);
      await fetcher.fetchPrompt(config2);

      fetcher.invalidateCache(config1);

      const stats = fetcher.getCacheStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      fetcher.setRouter(mockRouter);
      (mockRouter.routeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
        result: { messages: [{ content: 'Content' }] },
      });

      await fetcher.fetchPrompt({ backend: 'server', promptName: 'prompt' });

      const stats = fetcher.getCacheStats();

      expect(stats.size).toBe(1);
      expect(stats.entries.length).toBe(1);
      expect(stats.entries[0]).toContain('server:prompt');
    });

    it('should return empty stats initially', () => {
      const stats = fetcher.getCacheStats();

      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });
  });
});
