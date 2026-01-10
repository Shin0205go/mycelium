// ============================================================================
// AEGIS Core - Event-Driven Handler
// MCP Resource Subscription-based event handling for Decoy-AI
// ============================================================================

import { EventEmitter } from 'events';
import type { Logger } from '@aegis/shared';
import type {
  ResourceSubscription,
  ResourceEventHandler,
  ResourceReadResult,
  ResourceUpdatedNotification,
  ResourceListChangedNotification
} from './types/mcp-types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for EventDrivenHandler
 */
export interface EventDrivenHandlerConfig {
  /** Maximum concurrent event handlers */
  maxConcurrentHandlers?: number;

  /** Timeout for handler execution (ms) */
  handlerTimeout?: number;

  /** Whether to auto-reconnect on subscription failure */
  autoReconnect?: boolean;

  /** Reconnect delay (ms) */
  reconnectDelay?: number;

  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
}

/**
 * Event types emitted by the handler
 */
export interface EventDrivenHandlerEvents {
  'resource:updated': (uri: string, content: ResourceReadResult) => void;
  'resource:list_changed': () => void;
  'subscription:created': (uri: string) => void;
  'subscription:removed': (uri: string) => void;
  'subscription:error': (uri: string, error: Error) => void;
  'handler:error': (pattern: string, error: Error) => void;
}

/**
 * Router interface for sending MCP requests
 */
export interface MCPRouter {
  sendRequest(serverName: string, method: string, params?: Record<string, unknown>): Promise<unknown>;
  readResource(uri: string): Promise<ResourceReadResult>;
}

// ============================================================================
// Event-Driven Handler
// ============================================================================

/**
 * EventDrivenHandler manages MCP resource subscriptions and event dispatch.
 * Instead of polling, it subscribes to resources and reacts to notifications.
 *
 * Usage:
 * ```typescript
 * const handler = new EventDrivenHandler(logger, router);
 *
 * // Subscribe to Mattermost channel updates
 * await handler.subscribe('mattermost://channel/general', 'mattermost');
 *
 * // Register event handler
 * handler.on('mattermost://channel/*', async (uri, content) => {
 *   // Handle new messages
 * });
 *
 * // Process incoming notification
 * handler.handleNotification({
 *   jsonrpc: '2.0',
 *   method: 'notifications/resources/updated',
 *   params: { uri: 'mattermost://channel/general' }
 * });
 * ```
 */
export class EventDrivenHandler extends EventEmitter {
  private logger: Logger;
  private router: MCPRouter;
  private config: Required<EventDrivenHandlerConfig>;

  /** Active subscriptions by URI */
  private subscriptions: Map<string, ResourceSubscription> = new Map();

  /** Registered event handlers */
  private handlers: ResourceEventHandler[] = [];

  /** Currently executing handlers (for concurrency control) */
  private activeHandlers: Set<string> = new Set();

  /** Reconnect attempts per URI */
  private reconnectAttempts: Map<string, number> = new Map();

  constructor(
    logger: Logger,
    router: MCPRouter,
    config?: EventDrivenHandlerConfig
  ) {
    super();
    this.logger = logger;
    this.router = router;
    this.config = {
      maxConcurrentHandlers: config?.maxConcurrentHandlers ?? 10,
      handlerTimeout: config?.handlerTimeout ?? 30000,
      autoReconnect: config?.autoReconnect ?? true,
      reconnectDelay: config?.reconnectDelay ?? 5000,
      maxReconnectAttempts: config?.maxReconnectAttempts ?? 3
    };

    this.logger.debug('EventDrivenHandler initialized', {
      maxConcurrentHandlers: this.config.maxConcurrentHandlers,
      autoReconnect: this.config.autoReconnect
    });
  }

  // ============================================================================
  // Subscription Management
  // ============================================================================

  /**
   * Subscribe to a resource URI
   */
  async subscribe(
    uri: string,
    serverName: string,
    options?: {
      onUpdate?: ResourceSubscription['onUpdate'];
      onError?: ResourceSubscription['onError'];
    }
  ): Promise<void> {
    if (this.subscriptions.has(uri)) {
      this.logger.debug(`Already subscribed to ${uri}`);
      return;
    }

    try {
      // Send subscription request to server
      await this.router.sendRequest(serverName, 'resources/subscribe', { uri });

      const subscription: ResourceSubscription = {
        uri,
        serverName,
        subscribedAt: new Date(),
        updateCount: 0,
        onUpdate: options?.onUpdate,
        onError: options?.onError
      };

      this.subscriptions.set(uri, subscription);
      this.reconnectAttempts.delete(uri);

      this.logger.info(`Subscribed to resource: ${uri}`);
      this.emit('subscription:created', uri);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to subscribe to ${uri}: ${err.message}`);

      if (this.config.autoReconnect) {
        this.scheduleReconnect(uri, serverName, options);
      }

      throw err;
    }
  }

  /**
   * Unsubscribe from a resource URI
   */
  async unsubscribe(uri: string): Promise<void> {
    const subscription = this.subscriptions.get(uri);
    if (!subscription) {
      this.logger.debug(`Not subscribed to ${uri}`);
      return;
    }

    try {
      await this.router.sendRequest(
        subscription.serverName,
        'resources/unsubscribe',
        { uri }
      );
    } catch (error) {
      this.logger.warn(`Error unsubscribing from ${uri}: ${error}`);
    }

    this.subscriptions.delete(uri);
    this.logger.info(`Unsubscribed from resource: ${uri}`);
    this.emit('subscription:removed', uri);
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(
    uri: string,
    serverName: string,
    options?: {
      onUpdate?: ResourceSubscription['onUpdate'];
      onError?: ResourceSubscription['onError'];
    }
  ): void {
    const attempts = (this.reconnectAttempts.get(uri) ?? 0) + 1;

    if (attempts > this.config.maxReconnectAttempts) {
      this.logger.error(`Max reconnect attempts reached for ${uri}`);
      this.emit('subscription:error', uri, new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts.set(uri, attempts);
    const delay = this.config.reconnectDelay * attempts;

    this.logger.debug(`Scheduling reconnect for ${uri} in ${delay}ms (attempt ${attempts})`);

    setTimeout(async () => {
      try {
        await this.subscribe(uri, serverName, options);
      } catch {
        // subscribe() will schedule another reconnect if needed
      }
    }, delay);
  }

  /**
   * Get all active subscriptions
   */
  getSubscriptions(): ResourceSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Check if subscribed to a URI
   */
  isSubscribed(uri: string): boolean {
    return this.subscriptions.has(uri);
  }

  // ============================================================================
  // Event Handler Registration
  // ============================================================================

  /**
   * Register an event handler for a URI pattern
   */
  on(
    pattern: string,
    handler: ResourceEventHandler['handler'],
    options?: { priority?: number; propagate?: boolean }
  ): this {
    const eventHandler: ResourceEventHandler = {
      pattern,
      handler,
      priority: options?.priority ?? 0,
      propagate: options?.propagate ?? true
    };

    this.handlers.push(eventHandler);

    // Sort by priority (descending)
    this.handlers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    this.logger.debug(`Registered handler for pattern: ${pattern}`);
    return this;
  }

  /**
   * Remove event handlers matching a pattern
   */
  off(pattern: string): this {
    const before = this.handlers.length;
    this.handlers = this.handlers.filter(h => h.pattern !== pattern);
    const removed = before - this.handlers.length;

    if (removed > 0) {
      this.logger.debug(`Removed ${removed} handlers for pattern: ${pattern}`);
    }

    return this;
  }

  // ============================================================================
  // Notification Handling
  // ============================================================================

  /**
   * Handle incoming MCP notification
   */
  async handleNotification(
    notification: ResourceUpdatedNotification | ResourceListChangedNotification
  ): Promise<void> {
    switch (notification.method) {
      case 'notifications/resources/updated':
        await this.handleResourceUpdated(notification as ResourceUpdatedNotification);
        break;

      case 'notifications/resources/list_changed':
        await this.handleResourceListChanged();
        break;

      default:
        this.logger.debug(`Unknown notification method: ${(notification as { method: string }).method}`);
    }
  }

  /**
   * Handle resource updated notification
   */
  private async handleResourceUpdated(
    notification: ResourceUpdatedNotification
  ): Promise<void> {
    const { uri } = notification.params;
    const subscription = this.subscriptions.get(uri);

    if (!subscription) {
      this.logger.debug(`Received update for unsubscribed resource: ${uri}`);
      return;
    }

    try {
      // Read the updated resource content
      const content = await this.router.readResource(uri);

      // Update subscription stats
      subscription.lastUpdateAt = new Date();
      subscription.updateCount++;

      // Emit event
      this.emit('resource:updated', uri, content);

      // Call subscription-specific handler
      if (subscription.onUpdate) {
        await subscription.onUpdate(uri, content);
      }

      // Call pattern-matched handlers
      await this.dispatchToHandlers(uri, content);

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Error handling resource update for ${uri}: ${err.message}`);

      if (subscription.onError) {
        subscription.onError(uri, err);
      }

      this.emit('subscription:error', uri, err);
    }
  }

  /**
   * Handle resource list changed notification
   */
  private async handleResourceListChanged(): Promise<void> {
    this.logger.info('Resource list changed');
    this.emit('resource:list_changed');
  }

  /**
   * Dispatch content to matching handlers
   */
  private async dispatchToHandlers(
    uri: string,
    content: ResourceReadResult
  ): Promise<void> {
    const matchingHandlers = this.handlers.filter(h => this.matchPattern(uri, h.pattern));

    for (const handler of matchingHandlers) {
      // Check concurrency limit
      if (this.activeHandlers.size >= this.config.maxConcurrentHandlers) {
        this.logger.warn(`Max concurrent handlers reached, queuing handler for ${uri}`);
        await this.waitForSlot();
      }

      const handlerId = `${handler.pattern}:${Date.now()}`;
      this.activeHandlers.add(handlerId);

      try {
        // Execute with timeout
        await Promise.race([
          handler.handler(uri, content),
          this.createTimeout(this.config.handlerTimeout, uri)
        ]);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Handler error for pattern ${handler.pattern}: ${err.message}`);
        this.emit('handler:error', handler.pattern, err);
      } finally {
        this.activeHandlers.delete(handlerId);
      }

      // Stop propagation if handler requests it
      if (!handler.propagate) {
        break;
      }
    }
  }

  /**
   * Match URI against pattern (supports * wildcard)
   */
  private matchPattern(uri: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === uri) return true;

    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    return new RegExp(`^${regexPattern}$`).test(uri);
  }

  /**
   * Wait for a handler slot to become available
   */
  private async waitForSlot(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (this.activeHandlers.size < this.config.maxConcurrentHandlers) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number, uri: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Handler timeout for ${uri} after ${ms}ms`));
      }, ms);
    });
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get handler statistics
   */
  getStats(): {
    subscriptionCount: number;
    handlerCount: number;
    activeHandlers: number;
    totalUpdates: number;
  } {
    let totalUpdates = 0;
    for (const sub of this.subscriptions.values()) {
      totalUpdates += sub.updateCount;
    }

    return {
      subscriptionCount: this.subscriptions.size,
      handlerCount: this.handlers.length,
      activeHandlers: this.activeHandlers.size,
      totalUpdates
    };
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Unsubscribe from all resources and clean up
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing EventDrivenHandler');

    // Unsubscribe from all resources
    const uris = Array.from(this.subscriptions.keys());
    await Promise.all(uris.map(uri => this.unsubscribe(uri)));

    // Clear handlers
    this.handlers = [];
    this.activeHandlers.clear();
    this.reconnectAttempts.clear();

    // Remove all listeners
    this.removeAllListeners();

    this.logger.info('EventDrivenHandler disposed');
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an EventDrivenHandler instance
 */
export function createEventDrivenHandler(
  logger: Logger,
  router: MCPRouter,
  config?: EventDrivenHandlerConfig
): EventDrivenHandler {
  return new EventDrivenHandler(logger, router, config);
}
