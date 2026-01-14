// ============================================================================
// AEGIS Enterprise MCP - Routing Strategies Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RoutingStrategyManager,
  CircuitBreaker,
  RetryHandler,
  createRoutingStrategyManager,
  NoHealthyServersError,
} from '../../src/router/routing-strategies.js';
import type { Logger, RoutingConfig, CircuitBreakerConfig, RetryConfig } from '@aegis/shared';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('CircuitBreaker', () => {
  let logger: Logger;
  let config: CircuitBreakerConfig;

  beforeEach(() => {
    logger = createMockLogger();
    config = {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      successThreshold: 2,
      granularity: 'server',
    };
  });

  it('should start in closed state', () => {
    const breaker = new CircuitBreaker('test', config, logger);

    expect(breaker.getStatus().state).toBe('closed');
    expect(breaker.canExecute()).toBe(true);
  });

  it('should open after failure threshold', () => {
    const breaker = new CircuitBreaker('test', config, logger);

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe('closed');

    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe('open');
    expect(breaker.canExecute()).toBe(false);
  });

  it('should transition to half-open after reset timeout', async () => {
    const shortConfig = { ...config, resetTimeoutMs: 50 };
    const breaker = new CircuitBreaker('test', shortConfig, logger);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe('open');

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should transition to half-open on next check
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.getStatus().state).toBe('half-open');
  });

  it('should close after success threshold in half-open', async () => {
    const shortConfig = { ...config, resetTimeoutMs: 50 };
    const breaker = new CircuitBreaker('test', shortConfig, logger);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 100));
    breaker.canExecute(); // Triggers half-open

    // Record successes
    breaker.recordSuccess();
    expect(breaker.getStatus().state).toBe('half-open');

    breaker.recordSuccess();
    expect(breaker.getStatus().state).toBe('closed');
  });

  it('should reopen on failure in half-open', async () => {
    const shortConfig = { ...config, resetTimeoutMs: 50 };
    const breaker = new CircuitBreaker('test', shortConfig, logger);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 100));
    breaker.canExecute(); // Triggers half-open

    // Record failure
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe('open');
  });

  it('should reset correctly', () => {
    const breaker = new CircuitBreaker('test', config, logger);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe('open');

    // Reset
    breaker.reset();
    expect(breaker.getStatus().state).toBe('closed');
    expect(breaker.getStatus().failureCount).toBe(0);
  });

  it('should call state change callback', () => {
    const callback = vi.fn();
    const breaker = new CircuitBreaker('test', config, logger, callback);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(callback).toHaveBeenCalledWith('open');
  });
});

describe('RetryHandler', () => {
  let logger: Logger;
  let config: RetryConfig;
  let handler: RetryHandler;

  beforeEach(() => {
    logger = createMockLogger();
    config = {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      useJitter: false,
      retryableErrors: ['ETIMEDOUT', 'ECONNRESET'],
    };
    handler = new RetryHandler(config, logger);
  });

  it('should succeed on first try', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await handler.executeWithRetry(operation, {
      server: 'test',
      toolName: 'tool',
    });

    expect(result.result).toBe('success');
    expect(result.retryCount).toBe(0);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable error', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('success');

    const result = await handler.executeWithRetry(operation, {
      server: 'test',
      toolName: 'tool',
    });

    expect(result.result).toBe('success');
    expect(result.retryCount).toBe(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable error', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('INVALID_INPUT'));

    await expect(
      handler.executeWithRetry(operation, { server: 'test', toolName: 'tool' })
    ).rejects.toThrow('INVALID_INPUT');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should give up after max retries', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(
      handler.executeWithRetry(operation, { server: 'test', toolName: 'tool' })
    ).rejects.toThrow('ETIMEDOUT');

    expect(operation).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });
});

describe('RoutingStrategyManager', () => {
  let logger: Logger;
  let manager: RoutingStrategyManager;

  beforeEach(() => {
    logger = createMockLogger();
    manager = createRoutingStrategyManager(logger);
  });

  describe('Server Registration', () => {
    it('should register servers', () => {
      manager.registerServer('server1');
      manager.registerServer('server2');

      const health = manager.getAllServerHealth();
      expect(health.length).toBe(2);
    });

    it('should unregister servers', () => {
      manager.registerServer('server1');
      manager.unregisterServer('server1');

      const health = manager.getAllServerHealth();
      expect(health.length).toBe(0);
    });
  });

  describe('Routing Decisions', () => {
    beforeEach(() => {
      manager.registerServer('server1');
      manager.registerServer('server2');
      manager.registerServer('server3');
    });

    it('should route by prefix when available', () => {
      const decision = manager.makeRoutingDecision(
        {
          toolName: 'server1__read_file',
          serverPrefix: 'server1',
          timestamp: new Date(),
        },
        ['server1', 'server2', 'server3']
      );

      expect(decision.server).toBe('server1');
      expect(decision.strategy).toBe('prefix');
    });

    it('should use round-robin when configured', () => {
      manager.updateConfig({ defaultStrategy: 'round-robin' });

      const decisions: string[] = [];
      for (let i = 0; i < 6; i++) {
        const decision = manager.makeRoutingDecision(
          { toolName: 'some_tool', timestamp: new Date() },
          ['server1', 'server2', 'server3']
        );
        decisions.push(decision.server);
      }

      // Should cycle through servers
      expect(decisions[0]).toBe('server1');
      expect(decisions[1]).toBe('server2');
      expect(decisions[2]).toBe('server3');
      expect(decisions[3]).toBe('server1');
    });

    it('should use least-connections routing', () => {
      manager.updateConfig({ defaultStrategy: 'least-connections' });

      // Simulate active requests
      manager.recordExecutionStart('server1');
      manager.recordExecutionStart('server1');
      manager.recordExecutionStart('server2');

      const decision = manager.makeRoutingDecision(
        { toolName: 'some_tool', timestamp: new Date() },
        ['server1', 'server2', 'server3']
      );

      expect(decision.server).toBe('server3'); // Has 0 active requests
    });

    it('should use latency-based routing', () => {
      manager.updateConfig({ defaultStrategy: 'latency-based' });

      // Simulate different latencies
      manager.recordExecutionResult({
        success: true,
        server: 'server1',
        durationMs: 100,
      });
      manager.recordExecutionResult({
        success: true,
        server: 'server2',
        durationMs: 50,
      });
      manager.recordExecutionResult({
        success: true,
        server: 'server3',
        durationMs: 200,
      });

      const decision = manager.makeRoutingDecision(
        { toolName: 'some_tool', timestamp: new Date() },
        ['server1', 'server2', 'server3']
      );

      expect(decision.server).toBe('server2'); // Lowest latency
    });

    it('should throw when no healthy servers available', () => {
      // Trip circuit breakers for all servers
      for (const server of ['server1', 'server2', 'server3']) {
        for (let i = 0; i < 5; i++) {
          manager.recordExecutionResult({
            success: false,
            server,
            durationMs: 100,
            error: 'Connection failed',
          });
        }
      }

      expect(() =>
        manager.makeRoutingDecision(
          { toolName: 'some_tool', timestamp: new Date() },
          ['server1', 'server2', 'server3']
        )
      ).toThrow(NoHealthyServersError);
    });
  });

  describe('Circuit Breaker Integration', () => {
    beforeEach(() => {
      manager = createRoutingStrategyManager(logger, {
        defaultStrategy: 'prefix',
        timeoutMs: 30000,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeoutMs: 1000,
          successThreshold: 2,
          granularity: 'server',
        },
      });
      manager.registerServer('server1');
      manager.registerServer('server2');
    });

    it('should open circuit after failures', () => {
      for (let i = 0; i < 3; i++) {
        manager.recordExecutionResult({
          success: false,
          server: 'server1',
          durationMs: 100,
          error: 'Connection failed',
        });
      }

      expect(manager.isServerHealthy('server1')).toBe(false);
      expect(manager.isServerHealthy('server2')).toBe(true);
    });

    it('should get circuit breaker status', () => {
      manager.recordExecutionResult({
        success: false,
        server: 'server1',
        durationMs: 100,
        error: 'Connection failed',
      });

      const status = manager.getCircuitBreakerStatus('server1');
      expect(status).toBeDefined();
      expect(status!.failureCount).toBe(1);
      expect(status!.state).toBe('closed');
    });

    it('should reset circuit breaker', () => {
      for (let i = 0; i < 3; i++) {
        manager.recordExecutionResult({
          success: false,
          server: 'server1',
          durationMs: 100,
          error: 'Connection failed',
        });
      }

      expect(manager.isServerHealthy('server1')).toBe(false);

      manager.resetCircuitBreaker('server1');

      expect(manager.isServerHealthy('server1')).toBe(true);
    });

    it('should emit circuit events', () => {
      const openHandler = vi.fn();
      manager.on('circuit-open', openHandler);

      for (let i = 0; i < 3; i++) {
        manager.recordExecutionResult({
          success: false,
          server: 'server1',
          durationMs: 100,
          error: 'Connection failed',
        });
      }

      expect(openHandler).toHaveBeenCalledWith('server1', expect.any(String));
    });
  });

  describe('Execution Tracking', () => {
    beforeEach(() => {
      manager.registerServer('server1');
    });

    it('should track execution metrics', () => {
      manager.recordExecutionStart('server1');
      manager.recordExecutionResult({
        success: true,
        server: 'server1',
        durationMs: 100,
      });

      const health = manager.getAllServerHealth();
      expect(health[0].avgResponseTimeMs).toBe(100);
    });

    it('should track error rate', () => {
      // 1 success, 1 failure = 50% error rate
      manager.recordExecutionResult({
        success: true,
        server: 'server1',
        durationMs: 100,
      });
      manager.recordExecutionResult({
        success: false,
        server: 'server1',
        durationMs: 100,
        error: 'Failed',
      });

      const health = manager.getAllServerHealth();
      expect(health[0].errorRate).toBe(0.5);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      manager.registerServer('server1');
      manager.registerServer('server2');
    });

    it('should provide comprehensive statistics', () => {
      manager.recordExecutionResult({
        success: true,
        server: 'server1',
        durationMs: 100,
      });
      manager.recordExecutionResult({
        success: true,
        server: 'server2',
        durationMs: 200,
      });
      manager.recordExecutionResult({
        success: false,
        server: 'server1',
        durationMs: 50,
        error: 'Failed',
      });

      const stats = manager.getStats();

      expect(stats.totalRequests).toBe(3);
      expect(stats.totalErrors).toBe(1);
      expect(stats.avgLatency).toBeCloseTo(116.67, 1);
      expect(stats.serverStats['server1'].requests).toBe(2);
      expect(stats.serverStats['server2'].requests).toBe(1);
    });
  });

  describe('Retry Integration', () => {
    beforeEach(() => {
      manager = createRoutingStrategyManager(logger, {
        defaultStrategy: 'prefix',
        timeoutMs: 30000,
        retry: {
          maxRetries: 2,
          baseDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          useJitter: false,
          retryableErrors: ['ETIMEDOUT'],
        },
      });
    });

    it('should retry operations', async () => {
      let attempt = 0;
      const operation = async () => {
        attempt++;
        if (attempt < 2) {
          const error = new Error('ETIMEDOUT');
          (error as any).code = 'ETIMEDOUT';
          throw error;
        }
        return 'success';
      };

      const result = await manager.executeWithRetry(operation, {
        server: 'server1',
        toolName: 'tool',
      });

      expect(result.result).toBe('success');
      expect(result.retryCount).toBe(1);
    });
  });
});
