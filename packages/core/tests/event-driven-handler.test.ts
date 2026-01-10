/**
 * Event-Driven Handler Tests
 *
 * Tests covering MCP Resource Subscription-based event handling:
 * 1. Subscription Management - subscribe/unsubscribe to resources
 * 2. Notification Handling - processing resource updates
 * 3. Pattern Matching - wildcard URI patterns
 * 4. Handler Dispatch - calling registered handlers
 * 5. Error Handling - reconnection and error propagation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  EventDrivenHandler,
  createEventDrivenHandler,
  type MCPRouter
} from '../src/event-driven-handler.js';
import type { Logger } from '@aegis/shared';
import type { ResourceReadResult } from '../src/types/mcp-types.js';

// Mock logger
const testLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

// Mock router
function createMockRouter(): MCPRouter & {
  sendRequest: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
} {
  return {
    sendRequest: vi.fn().mockResolvedValue({}),
    readResource: vi.fn().mockResolvedValue({
      contents: [{ uri: 'test://resource', text: 'content' }]
    })
  };
}

describe('EventDrivenHandler', () => {
  let handler: EventDrivenHandler;
  let mockRouter: ReturnType<typeof createMockRouter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter = createMockRouter();
    handler = createEventDrivenHandler(testLogger, mockRouter);
  });

  afterEach(async () => {
    await handler.dispose();
  });

  // ============================================================================
  // Subscription Management
  // ============================================================================

  describe('Subscription Management', () => {
    it('should subscribe to a resource', async () => {
      await handler.subscribe('mattermost://channel/general', 'mattermost');

      expect(mockRouter.sendRequest).toHaveBeenCalledWith(
        'mattermost',
        'resources/subscribe',
        { uri: 'mattermost://channel/general' }
      );
      expect(handler.isSubscribed('mattermost://channel/general')).toBe(true);
    });

    it('should not duplicate subscriptions', async () => {
      await handler.subscribe('mattermost://channel/general', 'mattermost');
      await handler.subscribe('mattermost://channel/general', 'mattermost');

      expect(mockRouter.sendRequest).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from a resource', async () => {
      await handler.subscribe('mattermost://channel/general', 'mattermost');
      await handler.unsubscribe('mattermost://channel/general');

      expect(mockRouter.sendRequest).toHaveBeenCalledWith(
        'mattermost',
        'resources/unsubscribe',
        { uri: 'mattermost://channel/general' }
      );
      expect(handler.isSubscribed('mattermost://channel/general')).toBe(false);
    });

    it('should handle unsubscribe for non-existent subscription', async () => {
      await handler.unsubscribe('nonexistent://resource');
      expect(mockRouter.sendRequest).not.toHaveBeenCalled();
    });

    it('should track multiple subscriptions', async () => {
      await handler.subscribe('mattermost://channel/general', 'mattermost');
      await handler.subscribe('outlook://inbox/unread', 'outlook');

      const subscriptions = handler.getSubscriptions();
      expect(subscriptions).toHaveLength(2);
      expect(subscriptions.map(s => s.uri)).toContain('mattermost://channel/general');
      expect(subscriptions.map(s => s.uri)).toContain('outlook://inbox/unread');
    });

    it('should emit subscription:created event', async () => {
      const createdHandler = vi.fn();
      handler.addListener('subscription:created', createdHandler);

      await handler.subscribe('test://resource', 'test');

      expect(createdHandler).toHaveBeenCalledWith('test://resource');
    });

    it('should emit subscription:removed event', async () => {
      const removedHandler = vi.fn();
      handler.addListener('subscription:removed', removedHandler);

      await handler.subscribe('test://resource', 'test');
      await handler.unsubscribe('test://resource');

      expect(removedHandler).toHaveBeenCalledWith('test://resource');
    });
  });

  // ============================================================================
  // Notification Handling
  // ============================================================================

  describe('Notification Handling', () => {
    it('should handle resource updated notification', async () => {
      await handler.subscribe('mattermost://channel/general', 'mattermost');

      const updateHandler = vi.fn();
      handler.addListener('resource:updated', updateHandler);

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'mattermost://channel/general' }
      });

      expect(mockRouter.readResource).toHaveBeenCalledWith('mattermost://channel/general');
      expect(updateHandler).toHaveBeenCalled();
    });

    it('should call subscription-specific onUpdate handler', async () => {
      const onUpdate = vi.fn();

      await handler.subscribe('test://resource', 'test', { onUpdate });

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(onUpdate).toHaveBeenCalledWith(
        'test://resource',
        expect.objectContaining({ contents: expect.any(Array) })
      );
    });

    it('should handle resource list changed notification', async () => {
      const listChangedHandler = vi.fn();
      handler.addListener('resource:list_changed', listChangedHandler);

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/list_changed'
      });

      expect(listChangedHandler).toHaveBeenCalled();
    });

    it('should ignore notifications for unsubscribed resources', async () => {
      const updateHandler = vi.fn();
      handler.addListener('resource:updated', updateHandler);

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'unsubscribed://resource' }
      });

      expect(mockRouter.readResource).not.toHaveBeenCalled();
      expect(updateHandler).not.toHaveBeenCalled();
    });

    it('should update subscription stats on notification', async () => {
      await handler.subscribe('test://resource', 'test');

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      const subscriptions = handler.getSubscriptions();
      const sub = subscriptions.find(s => s.uri === 'test://resource');

      expect(sub?.updateCount).toBe(1);
      expect(sub?.lastUpdateAt).toBeDefined();
    });
  });

  // ============================================================================
  // Pattern Matching & Handler Registration
  // ============================================================================

  describe('Pattern Matching', () => {
    it('should match exact URI', async () => {
      const exactHandler = vi.fn();
      handler.on('mattermost://channel/general', exactHandler);

      await handler.subscribe('mattermost://channel/general', 'mattermost');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'mattermost://channel/general' }
      });

      expect(exactHandler).toHaveBeenCalled();
    });

    it('should match wildcard pattern', async () => {
      const wildcardHandler = vi.fn();
      handler.on('mattermost://channel/*', wildcardHandler);

      await handler.subscribe('mattermost://channel/general', 'mattermost');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'mattermost://channel/general' }
      });

      expect(wildcardHandler).toHaveBeenCalled();
    });

    it('should match global wildcard', async () => {
      const globalHandler = vi.fn();
      handler.on('*', globalHandler);

      await handler.subscribe('any://resource', 'test');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'any://resource' }
      });

      expect(globalHandler).toHaveBeenCalled();
    });

    it('should call handlers in priority order', async () => {
      const callOrder: number[] = [];

      handler.on('test://*', () => { callOrder.push(1); }, { priority: 10 });
      handler.on('test://*', () => { callOrder.push(2); }, { priority: 20 });
      handler.on('test://*', () => { callOrder.push(3); }, { priority: 5 });

      await handler.subscribe('test://resource', 'test');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(callOrder).toEqual([2, 1, 3]); // Descending priority
    });

    it('should stop propagation when requested', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      handler.on('test://*', handler1, { priority: 10, propagate: false });
      handler.on('test://*', handler2, { priority: 5 });

      await handler.subscribe('test://resource', 'test');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should remove handlers with off()', async () => {
      const testHandler = vi.fn();
      handler.on('test://*', testHandler);
      handler.off('test://*');

      await handler.subscribe('test://resource', 'test');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(testHandler).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should call onError when read fails', async () => {
      const onError = vi.fn();
      mockRouter.readResource.mockRejectedValueOnce(new Error('Read failed'));

      await handler.subscribe('test://resource', 'test', { onError });

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(onError).toHaveBeenCalledWith('test://resource', expect.any(Error));
    });

    it('should emit subscription:error on read failure', async () => {
      const errorHandler = vi.fn();
      handler.addListener('subscription:error', errorHandler);

      mockRouter.readResource.mockRejectedValueOnce(new Error('Read failed'));
      await handler.subscribe('test://resource', 'test');

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(errorHandler).toHaveBeenCalledWith('test://resource', expect.any(Error));
    });

    it('should emit handler:error when handler throws', async () => {
      const errorHandler = vi.fn();
      handler.addListener('handler:error', errorHandler);

      handler.on('test://*', () => {
        throw new Error('Handler crashed');
      });

      await handler.subscribe('test://resource', 'test');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(errorHandler).toHaveBeenCalledWith('test://*', expect.any(Error));
    });

    it('should continue to next handler after error', async () => {
      const handler1 = vi.fn().mockImplementation(() => {
        throw new Error('Handler 1 crashed');
      });
      const handler2 = vi.fn();

      handler.on('test://*', handler1, { priority: 10 });
      handler.on('test://*', handler2, { priority: 5 });

      await handler.subscribe('test://resource', 'test');
      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource' }
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Statistics
  // ============================================================================

  describe('Statistics', () => {
    it('should return correct stats', async () => {
      handler.on('test://*', vi.fn());
      handler.on('other://*', vi.fn());

      await handler.subscribe('test://resource1', 'test');
      await handler.subscribe('test://resource2', 'test');

      await handler.handleNotification({
        jsonrpc: '2.0',
        method: 'notifications/resources/updated',
        params: { uri: 'test://resource1' }
      });

      const stats = handler.getStats();

      expect(stats.subscriptionCount).toBe(2);
      expect(stats.handlerCount).toBe(2);
      expect(stats.totalUpdates).toBe(1);
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe('Cleanup', () => {
    it('should dispose all subscriptions', async () => {
      await handler.subscribe('test://resource1', 'test');
      await handler.subscribe('test://resource2', 'test');

      await handler.dispose();

      expect(handler.getSubscriptions()).toHaveLength(0);
      expect(mockRouter.sendRequest).toHaveBeenCalledWith(
        'test',
        'resources/unsubscribe',
        expect.any(Object)
      );
    });
  });

  // ============================================================================
  // Factory Function
  // ============================================================================

  describe('Factory Function', () => {
    it('should create handler with default config', () => {
      const h = createEventDrivenHandler(testLogger, mockRouter);
      expect(h).toBeInstanceOf(EventDrivenHandler);
    });

    it('should create handler with custom config', () => {
      const h = createEventDrivenHandler(testLogger, mockRouter, {
        maxConcurrentHandlers: 5,
        handlerTimeout: 10000,
        autoReconnect: false
      });
      expect(h).toBeInstanceOf(EventDrivenHandler);
    });
  });
});
