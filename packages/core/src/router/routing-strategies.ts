// ============================================================================
// AEGIS Enterprise MCP - Advanced Routing Strategies
// Implements circuit breaker, failover, weighted routing, and retry logic
// Based on: "自社管理型MCPエコシステムの構築" Technical Report
// ============================================================================

import type {
  Logger,
  RoutingConfig,
  RoutingStrategyType,
  CircuitBreakerConfig,
  CircuitBreakerStatus,
  CircuitState,
  RetryConfig,
  WeightedRoutingConfig,
  FailoverRoutingConfig,
  ServerHealth,
  isWeightedRouting,
  isFailoverRouting,
} from '@aegis/shared';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Routing decision result.
 */
export interface RoutingDecision {
  /** Selected server */
  server: string;

  /** Strategy used */
  strategy: RoutingStrategyType;

  /** Alternative servers if primary fails */
  alternatives: string[];

  /** Whether circuit breaker is active */
  circuitBreakerActive: boolean;

  /** Routing metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Request execution context for routing.
 */
export interface RequestContext {
  /** Tool name being called */
  toolName: string;

  /** Server prefix extracted from tool name */
  serverPrefix?: string;

  /** Arguments to the tool */
  arguments?: Record<string, unknown>;

  /** Request ID for tracking */
  requestId?: string;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Execution result for metrics.
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Server that executed the request */
  server: string;

  /** Execution duration in ms */
  durationMs: number;

  /** Error if failed */
  error?: string;

  /** Retry count */
  retryCount?: number;
}

/**
 * Router events.
 */
export interface RoutingStrategyEvents {
  'circuit-open': (server: string, reason: string) => void;
  'circuit-close': (server: string) => void;
  'circuit-half-open': (server: string) => void;
  'failover': (from: string, to: string, reason: string) => void;
  'retry': (server: string, attempt: number, maxAttempts: number) => void;
  'routing-decision': (decision: RoutingDecision) => void;
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

/**
 * Circuit breaker for individual servers or tools.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailure?: Date;
  private lastStateChange: Date;
  private nextRetryAt?: Date;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig,
    private readonly logger: Logger,
    private readonly onStateChange?: (state: CircuitState) => void
  ) {
    this.lastStateChange = new Date();
  }

  /**
   * Check if the circuit allows requests.
   */
  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (this.nextRetryAt && new Date() >= this.nextRetryAt) {
        this.transitionTo('half-open');
        return true;
      }
      return false;
    }

    // half-open: allow limited requests
    return true;
  }

  /**
   * Record a successful execution.
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  /**
   * Record a failed execution.
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailure = new Date();

    if (this.state === 'half-open') {
      // Any failure in half-open state trips the breaker again
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  /**
   * Get current status.
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastStateChange: this.lastStateChange,
      nextRetryAt: this.nextRetryAt,
    };
  }

  /**
   * Reset the circuit breaker.
   */
  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.transitionTo('closed');
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    switch (newState) {
      case 'open':
        this.nextRetryAt = new Date(Date.now() + this.config.resetTimeoutMs);
        this.logger.warn(`Circuit breaker OPEN for ${this.name}`, {
          failureCount: this.failureCount,
          nextRetryAt: this.nextRetryAt,
        });
        break;

      case 'half-open':
        this.successCount = 0;
        this.logger.info(`Circuit breaker HALF-OPEN for ${this.name}`);
        break;

      case 'closed':
        this.failureCount = 0;
        this.successCount = 0;
        this.nextRetryAt = undefined;
        this.logger.info(`Circuit breaker CLOSED for ${this.name}`);
        break;
    }

    this.onStateChange?.(newState);
  }
}

// ============================================================================
// Retry Handler Implementation
// ============================================================================

/**
 * Handles retry logic with exponential backoff.
 */
export class RetryHandler {
  constructor(
    private readonly config: RetryConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Execute with retry logic.
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: { server: string; toolName: string }
  ): Promise<{ result: T; retryCount: number }> {
    let lastError: Error | undefined;
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await operation();
        return { result, retryCount };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorCode = this.extractErrorCode(lastError);

        // Check if error is retryable
        if (!this.isRetryable(errorCode)) {
          throw lastError;
        }

        // Check if we have retries left
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Calculate delay
        const delay = this.calculateDelay(attempt);
        retryCount++;

        this.logger.warn(`Retrying request`, {
          server: context.server,
          toolName: context.toolName,
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          delayMs: delay,
          error: lastError.message,
        });

        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  private extractErrorCode(error: Error): string {
    // Try to extract error code from message or code property
    const errorWithCode = error as Error & { code?: string };
    if (errorWithCode.code) {
      return errorWithCode.code;
    }

    // Check message for common error codes
    const message = error.message.toUpperCase();
    if (message.includes('ETIMEDOUT')) return 'ETIMEDOUT';
    if (message.includes('ECONNRESET')) return 'ECONNRESET';
    if (message.includes('ECONNREFUSED')) return 'ECONNREFUSED';
    if (message.includes('TIMEOUT')) return 'ETIMEDOUT';

    return 'UNKNOWN';
  }

  private isRetryable(errorCode: string): boolean {
    return this.config.retryableErrors.includes(errorCode);
  }

  private calculateDelay(attempt: number): number {
    let delay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    delay = Math.min(delay, this.config.maxDelayMs);

    if (this.config.useJitter) {
      // Add random jitter up to 25%
      const jitter = delay * 0.25 * Math.random();
      delay += jitter;
    }

    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Routing Strategy Manager
// ============================================================================

/**
 * Manages routing strategies and server selection.
 */
export class RoutingStrategyManager extends EventEmitter {
  private logger: Logger;
  private config: RoutingConfig;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private retryHandler?: RetryHandler;
  private serverMetrics: Map<string, {
    requestCount: number;
    errorCount: number;
    totalLatency: number;
    lastRequestTime?: Date;
    activeRequests: number;
  }> = new Map();
  private roundRobinIndex: Map<string, number> = new Map();

  constructor(logger: Logger, config?: Partial<RoutingConfig>) {
    super();
    this.logger = logger;
    this.config = {
      defaultStrategy: 'prefix',
      timeoutMs: 30000,
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        successThreshold: 2,
        granularity: 'server',
      },
      retry: {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        useJitter: true,
        retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'],
      },
      deduplication: false,
      batching: {
        enabled: false,
        maxBatchSize: 10,
        maxWaitMs: 100,
      },
      ...config,
    };

    if (this.config.retry) {
      this.retryHandler = new RetryHandler(this.config.retry, this.logger);
    }
  }

  // ===== Configuration =====

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<RoutingConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.retry) {
      this.retryHandler = new RetryHandler(this.config.retry!, this.logger);
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): RoutingConfig {
    return { ...this.config };
  }

  // ===== Server Registration =====

  /**
   * Register a server for routing.
   */
  registerServer(serverName: string): void {
    if (!this.serverMetrics.has(serverName)) {
      this.serverMetrics.set(serverName, {
        requestCount: 0,
        errorCount: 0,
        totalLatency: 0,
        activeRequests: 0,
      });
    }

    // Create circuit breaker if configured
    if (
      this.config.circuitBreaker &&
      this.config.circuitBreaker.granularity === 'server'
    ) {
      this.getOrCreateCircuitBreaker(serverName);
    }
  }

  /**
   * Unregister a server.
   */
  unregisterServer(serverName: string): void {
    this.serverMetrics.delete(serverName);
    this.circuitBreakers.delete(serverName);
  }

  // ===== Routing Decision =====

  /**
   * Make a routing decision for a request.
   */
  makeRoutingDecision(
    context: RequestContext,
    availableServers: string[]
  ): RoutingDecision {
    const { toolName, serverPrefix } = context;

    // Filter out servers with open circuit breakers
    const healthyServers = availableServers.filter((server) =>
      this.isServerHealthy(server)
    );

    if (healthyServers.length === 0) {
      // All servers are unhealthy - try to find one in half-open state
      const halfOpenServer = availableServers.find((server) => {
        const breaker = this.circuitBreakers.get(server);
        return breaker?.getStatus().state === 'half-open';
      });

      if (halfOpenServer) {
        return {
          server: halfOpenServer,
          strategy: 'failover',
          alternatives: [],
          circuitBreakerActive: true,
          metadata: { reason: 'All servers down, trying half-open' },
        };
      }

      throw new NoHealthyServersError(
        'No healthy servers available for routing'
      );
    }

    // If server prefix is specified in tool name, use prefix strategy
    if (serverPrefix && healthyServers.includes(serverPrefix)) {
      return {
        server: serverPrefix,
        strategy: 'prefix',
        alternatives: healthyServers.filter((s) => s !== serverPrefix),
        circuitBreakerActive: false,
      };
    }

    // Apply configured routing strategy
    switch (this.config.defaultStrategy) {
      case 'weighted':
        return this.applyWeightedRouting(healthyServers, toolName);

      case 'round-robin':
        return this.applyRoundRobinRouting(healthyServers, toolName);

      case 'least-connections':
        return this.applyLeastConnectionsRouting(healthyServers);

      case 'latency-based':
        return this.applyLatencyBasedRouting(healthyServers);

      case 'failover':
        return this.applyFailoverRouting(healthyServers, toolName);

      case 'prefix':
      default:
        return {
          server: healthyServers[0],
          strategy: 'prefix',
          alternatives: healthyServers.slice(1),
          circuitBreakerActive: false,
        };
    }
  }

  private applyWeightedRouting(
    servers: string[],
    toolName: string
  ): RoutingDecision {
    const serverConfig = this.config.serverConfigs?.[toolName];

    if (!serverConfig || serverConfig.type !== 'weighted') {
      // Fall back to uniform weights
      const randomIndex = Math.floor(Math.random() * servers.length);
      return {
        server: servers[randomIndex],
        strategy: 'weighted',
        alternatives: servers.filter((_, i) => i !== randomIndex),
        circuitBreakerActive: false,
      };
    }

    const weightedConfig = serverConfig as WeightedRoutingConfig;
    const weights = weightedConfig.weights;

    // Calculate total weight
    let totalWeight = 0;
    for (const server of servers) {
      totalWeight += weights[server] || 1;
    }

    // Select based on weight
    let random = Math.random() * totalWeight;
    for (const server of servers) {
      random -= weights[server] || 1;
      if (random <= 0) {
        return {
          server,
          strategy: 'weighted',
          alternatives: servers.filter((s) => s !== server),
          circuitBreakerActive: false,
          metadata: { weight: weights[server] || 1 },
        };
      }
    }

    return {
      server: servers[0],
      strategy: 'weighted',
      alternatives: servers.slice(1),
      circuitBreakerActive: false,
    };
  }

  private applyRoundRobinRouting(
    servers: string[],
    toolName: string
  ): RoutingDecision {
    const key = toolName || 'default';
    const currentIndex = this.roundRobinIndex.get(key) || 0;
    const selectedServer = servers[currentIndex % servers.length];

    this.roundRobinIndex.set(key, (currentIndex + 1) % servers.length);

    return {
      server: selectedServer,
      strategy: 'round-robin',
      alternatives: servers.filter((s) => s !== selectedServer),
      circuitBreakerActive: false,
      metadata: { index: currentIndex },
    };
  }

  private applyLeastConnectionsRouting(servers: string[]): RoutingDecision {
    let minConnections = Infinity;
    let selectedServer = servers[0];

    for (const server of servers) {
      const metrics = this.serverMetrics.get(server);
      const connections = metrics?.activeRequests || 0;

      if (connections < minConnections) {
        minConnections = connections;
        selectedServer = server;
      }
    }

    return {
      server: selectedServer,
      strategy: 'least-connections',
      alternatives: servers.filter((s) => s !== selectedServer),
      circuitBreakerActive: false,
      metadata: { activeConnections: minConnections },
    };
  }

  private applyLatencyBasedRouting(servers: string[]): RoutingDecision {
    let minLatency = Infinity;
    let selectedServer = servers[0];

    for (const server of servers) {
      const metrics = this.serverMetrics.get(server);
      if (metrics && metrics.requestCount > 0) {
        const avgLatency = metrics.totalLatency / metrics.requestCount;
        if (avgLatency < minLatency) {
          minLatency = avgLatency;
          selectedServer = server;
        }
      }
    }

    return {
      server: selectedServer,
      strategy: 'latency-based',
      alternatives: servers.filter((s) => s !== selectedServer),
      circuitBreakerActive: false,
      metadata: { avgLatency: minLatency },
    };
  }

  private applyFailoverRouting(
    servers: string[],
    toolName: string
  ): RoutingDecision {
    const serverConfig = this.config.serverConfigs?.[toolName];

    if (serverConfig && serverConfig.type === 'failover') {
      const failoverConfig = serverConfig as FailoverRoutingConfig;

      // Check if primary is available
      if (servers.includes(failoverConfig.primary)) {
        return {
          server: failoverConfig.primary,
          strategy: 'failover',
          alternatives: failoverConfig.fallbacks.filter((s) =>
            servers.includes(s)
          ),
          circuitBreakerActive: false,
          metadata: { isPrimary: true },
        };
      }

      // Try fallbacks in order
      for (const fallback of failoverConfig.fallbacks) {
        if (servers.includes(fallback)) {
          this.emit(
            'failover',
            failoverConfig.primary,
            fallback,
            'Primary unavailable'
          );
          return {
            server: fallback,
            strategy: 'failover',
            alternatives: failoverConfig.fallbacks
              .filter((s) => s !== fallback)
              .filter((s) => servers.includes(s)),
            circuitBreakerActive: false,
            metadata: { isPrimary: false, fallbackOrder: failoverConfig.fallbacks.indexOf(fallback) },
          };
        }
      }
    }

    // Default: use first available
    return {
      server: servers[0],
      strategy: 'failover',
      alternatives: servers.slice(1),
      circuitBreakerActive: false,
    };
  }

  // ===== Circuit Breaker Management =====

  private getOrCreateCircuitBreaker(name: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(
        name,
        this.config.circuitBreaker!,
        this.logger,
        (state) => this.onCircuitStateChange(name, state)
      );
      this.circuitBreakers.set(name, breaker);
    }
    return breaker;
  }

  private onCircuitStateChange(name: string, state: CircuitState): void {
    switch (state) {
      case 'open':
        this.emit('circuit-open', name, 'Failure threshold exceeded');
        break;
      case 'half-open':
        this.emit('circuit-half-open', name);
        break;
      case 'closed':
        this.emit('circuit-close', name);
        break;
    }
  }

  /**
   * Check if a server is healthy (circuit breaker allows requests).
   */
  isServerHealthy(server: string): boolean {
    const breaker = this.circuitBreakers.get(server);
    if (!breaker) return true; // No circuit breaker = healthy
    return breaker.canExecute();
  }

  /**
   * Get circuit breaker status for a server.
   */
  getCircuitBreakerStatus(server: string): CircuitBreakerStatus | undefined {
    return this.circuitBreakers.get(server)?.getStatus();
  }

  /**
   * Reset circuit breaker for a server.
   */
  resetCircuitBreaker(server: string): void {
    this.circuitBreakers.get(server)?.reset();
  }

  // ===== Execution Tracking =====

  /**
   * Record start of execution.
   */
  recordExecutionStart(server: string): void {
    const metrics = this.serverMetrics.get(server);
    if (metrics) {
      metrics.activeRequests++;
      metrics.lastRequestTime = new Date();
    }
  }

  /**
   * Record execution result.
   */
  recordExecutionResult(result: ExecutionResult): void {
    const metrics = this.serverMetrics.get(result.server);
    if (metrics) {
      metrics.requestCount++;
      metrics.totalLatency += result.durationMs;
      metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);

      if (!result.success) {
        metrics.errorCount++;
        this.circuitBreakers.get(result.server)?.recordFailure();
      } else {
        this.circuitBreakers.get(result.server)?.recordSuccess();
      }
    }
  }

  // ===== Execute with Retry =====

  /**
   * Execute an operation with retry logic.
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: { server: string; toolName: string }
  ): Promise<{ result: T; retryCount: number }> {
    if (!this.retryHandler) {
      const result = await operation();
      return { result, retryCount: 0 };
    }

    return this.retryHandler.executeWithRetry(operation, context);
  }

  // ===== Server Health =====

  /**
   * Get health status for all servers.
   */
  getAllServerHealth(): ServerHealth[] {
    const result: ServerHealth[] = [];

    for (const [server, metrics] of this.serverMetrics.entries()) {
      const circuitBreaker = this.circuitBreakers.get(server);
      const circuitStatus = circuitBreaker?.getStatus();

      const errorRate =
        metrics.requestCount > 0
          ? metrics.errorCount / metrics.requestCount
          : 0;

      const avgResponseTime =
        metrics.requestCount > 0
          ? metrics.totalLatency / metrics.requestCount
          : undefined;

      result.push({
        server,
        healthy: this.isServerHealthy(server),
        status: this.determineServerStatus(server, errorRate),
        lastSuccess: metrics.lastRequestTime,
        avgResponseTimeMs: avgResponseTime,
        errorRate,
        circuitBreaker: circuitStatus,
      });
    }

    return result;
  }

  private determineServerStatus(
    server: string,
    errorRate: number
  ): 'connected' | 'disconnected' | 'degraded' | 'unknown' {
    const circuitStatus = this.circuitBreakers.get(server)?.getStatus();

    if (circuitStatus?.state === 'open') {
      return 'disconnected';
    }

    if (errorRate > 0.5) {
      return 'degraded';
    }

    const metrics = this.serverMetrics.get(server);
    if (!metrics?.lastRequestTime) {
      return 'unknown';
    }

    return 'connected';
  }

  // ===== Statistics =====

  /**
   * Get routing statistics.
   */
  getStats(): {
    totalRequests: number;
    totalErrors: number;
    avgLatency: number;
    serverStats: Record<
      string,
      { requests: number; errors: number; avgLatency: number }
    >;
    circuitBreakerStats: Record<string, CircuitBreakerStatus>;
  } {
    let totalRequests = 0;
    let totalErrors = 0;
    let totalLatency = 0;
    const serverStats: Record<
      string,
      { requests: number; errors: number; avgLatency: number }
    > = {};
    const circuitBreakerStats: Record<string, CircuitBreakerStatus> = {};

    for (const [server, metrics] of this.serverMetrics.entries()) {
      totalRequests += metrics.requestCount;
      totalErrors += metrics.errorCount;
      totalLatency += metrics.totalLatency;

      serverStats[server] = {
        requests: metrics.requestCount,
        errors: metrics.errorCount,
        avgLatency:
          metrics.requestCount > 0
            ? metrics.totalLatency / metrics.requestCount
            : 0,
      };
    }

    for (const [name, breaker] of this.circuitBreakers.entries()) {
      circuitBreakerStats[name] = breaker.getStatus();
    }

    return {
      totalRequests,
      totalErrors,
      avgLatency: totalRequests > 0 ? totalLatency / totalRequests : 0,
      serverStats,
      circuitBreakerStats,
    };
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

export class NoHealthyServersError extends RoutingError {
  constructor(message: string) {
    super(message);
    this.name = 'NoHealthyServersError';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a routing strategy manager with default configuration.
 */
export function createRoutingStrategyManager(
  logger: Logger,
  config?: Partial<RoutingConfig>
): RoutingStrategyManager {
  return new RoutingStrategyManager(logger, config);
}
