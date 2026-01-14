// ============================================================================
// AEGIS Enterprise MCP - Distributed Tracer Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DistributedTracer,
  createDistributedTracer,
} from '../../src/observability/distributed-tracer.js';
import type { Logger, TraceContext } from '@aegis/shared';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('DistributedTracer', () => {
  let logger: Logger;
  let tracer: DistributedTracer;

  beforeEach(() => {
    logger = createMockLogger();
    tracer = createDistributedTracer(logger, {
      serviceName: 'test-service',
      samplingRate: 1.0,
      maxSpansPerTrace: 100,
      maxTraces: 100,
      propagateContext: true,
      exportIntervalMs: 0,
    });
  });

  afterEach(() => {
    tracer.stop();
    tracer.clear();
  });

  describe('Trace Creation', () => {
    it('should start a new trace', () => {
      const context = tracer.startTrace();

      expect(context.traceId).toBeDefined();
      expect(context.traceId.length).toBe(32);
      expect(context.spanId).toBeDefined();
      expect(context.spanId.length).toBe(16);
      expect(context.traceFlags).toBe(1); // Sampled
    });

    it('should continue existing trace with parent context', () => {
      const parentContext = tracer.startTrace();
      const childContext = tracer.startTrace(parentContext);

      expect(childContext.traceId).toBe(parentContext.traceId);
      expect(childContext.spanId).not.toBe(parentContext.spanId);
      expect(childContext.parentSpanId).toBe(parentContext.spanId);
    });

    it('should respect sampling rate', () => {
      const lowSampleTracer = createDistributedTracer(logger, {
        serviceName: 'test',
        samplingRate: 0,
        maxSpansPerTrace: 100,
        maxTraces: 100,
        propagateContext: true,
        exportIntervalMs: 0,
      });

      const context = lowSampleTracer.startTrace();
      expect(context.traceFlags).toBe(0); // Not sampled

      lowSampleTracer.stop();
    });
  });

  describe('Span Creation', () => {
    it('should create a span within a trace', () => {
      const traceContext = tracer.startTrace();
      const spanBuilder = tracer.startSpan('test-operation', traceContext, 'tool-call');

      const span = spanBuilder.end();

      expect(span.name).toBe('test-operation');
      expect(span.operationType).toBe('tool-call');
      expect(span.context.traceId).toBe(traceContext.traceId);
      expect(span.endTime).toBeDefined();
      expect(span.durationMs).toBeDefined();
    });

    it('should support span attributes', () => {
      const traceContext = tracer.startTrace();
      const span = tracer
        .startSpan('test-operation', traceContext)
        .setAttribute('tool.name', 'read_file')
        .setAttribute('tool.server', 'filesystem')
        .setAttribute('success', true)
        .end();

      expect(span.attributes['tool.name']).toBe('read_file');
      expect(span.attributes['tool.server']).toBe('filesystem');
      expect(span.attributes['success']).toBe(true);
    });

    it('should support span events', () => {
      const traceContext = tracer.startTrace();
      const span = tracer
        .startSpan('test-operation', traceContext)
        .addEvent('started')
        .addEvent('processing', { step: 1 })
        .addEvent('completed')
        .end();

      expect(span.events).toBeDefined();
      expect(span.events!.length).toBe(3);
      expect(span.events![0].name).toBe('started');
      expect(span.events![1].attributes?.step).toBe(1);
    });

    it('should support span links', () => {
      const traceContext1 = tracer.startTrace();
      const traceContext2 = tracer.startTrace();

      const span = tracer
        .startSpan('linked-operation', traceContext1)
        .addLink(traceContext2)
        .end();

      expect(span.links).toBeDefined();
      expect(span.links!.length).toBe(1);
      expect(span.links![0].traceId).toBe(traceContext2.traceId);
    });

    it('should support error handling', () => {
      const traceContext = tracer.startTrace();
      const span = tracer
        .startSpan('failing-operation', traceContext)
        .setError('Something went wrong')
        .end();

      expect(span.status).toBe('error');
      expect(span.errorMessage).toBe('Something went wrong');
      expect(span.events?.some((e) => e.name === 'exception')).toBe(true);
    });

    it('should set span kind', () => {
      const traceContext = tracer.startTrace();
      const span = tracer
        .startSpan('client-operation', traceContext)
        .setKind('client')
        .end();

      expect(span.kind).toBe('client');
    });
  });

  describe('Trace Lifecycle', () => {
    it('should end trace and move to completed', () => {
      const context = tracer.startTrace();
      tracer.startSpan('operation', context).end();

      const trace = tracer.endTrace(context.traceId, 'ok');

      expect(trace).toBeDefined();
      expect(trace!.status).toBe('ok');
      expect(trace!.endTime).toBeDefined();
      expect(trace!.durationMs).toBeDefined();

      // Should be in completed traces
      const completed = tracer.getCompletedTraces();
      expect(completed.find((t) => t.traceId === context.traceId)).toBeDefined();

      // Should not be in active traces
      const active = tracer.getActiveTraces();
      expect(active.find((t) => t.traceId === context.traceId)).toBeUndefined();
    });

    it('should track multiple spans in a trace', () => {
      const context = tracer.startTrace();

      tracer.startSpan('operation1', context).end();
      tracer.startSpan('operation2', context).end();
      tracer.startSpan('operation3', context).end();

      const trace = tracer.endTrace(context.traceId);

      // Root span + 3 operation spans
      expect(trace!.spans.length).toBe(4);
    });

    it('should emit trace-completed event', () => {
      const handler = vi.fn();
      tracer.on('trace-completed', handler);

      const context = tracer.startTrace();
      tracer.endTrace(context.traceId);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: context.traceId,
        })
      );
    });
  });

  describe('Context Propagation', () => {
    it('should inject context into headers', () => {
      const context = tracer.startTrace();
      const headers: Record<string, string> = {};

      tracer.injectContext(context, headers);

      expect(headers['traceparent']).toBeDefined();
      expect(headers['traceparent']).toContain(context.traceId);
      expect(headers['traceparent']).toContain(context.spanId);
    });

    it('should extract context from headers', () => {
      const originalContext = tracer.startTrace();
      const headers: Record<string, string> = {};
      tracer.injectContext(originalContext, headers);

      const extractedContext = tracer.extractContext(headers);

      expect(extractedContext).toBeDefined();
      expect(extractedContext!.traceId).toBe(originalContext.traceId);
      expect(extractedContext!.spanId).toBe(originalContext.spanId);
    });

    it('should return undefined for invalid headers', () => {
      const context = tracer.extractContext({});
      expect(context).toBeUndefined();
    });

    it('should respect propagateContext setting', () => {
      const noPropTracer = createDistributedTracer(logger, {
        serviceName: 'test',
        samplingRate: 1.0,
        maxSpansPerTrace: 100,
        maxTraces: 100,
        propagateContext: false,
        exportIntervalMs: 0,
      });

      const context = noPropTracer.startTrace();
      const headers: Record<string, string> = {};
      noPropTracer.injectContext(context, headers);

      expect(headers['traceparent']).toBeUndefined();

      noPropTracer.stop();
    });
  });

  describe('Query API', () => {
    it('should get trace by ID', () => {
      const context = tracer.startTrace();
      tracer.startSpan('test', context).end();

      const trace = tracer.getTrace(context.traceId);

      expect(trace).toBeDefined();
      expect(trace!.traceId).toBe(context.traceId);
    });

    it('should get spans for a trace', () => {
      const context = tracer.startTrace();
      tracer.startSpan('span1', context).end();
      tracer.startSpan('span2', context).end();

      const spans = tracer.getSpans(context.traceId);

      expect(spans.length).toBe(3); // Root + 2 spans
    });

    it('should filter completed traces by time', async () => {
      const context1 = tracer.startTrace();
      tracer.endTrace(context1.traceId);

      await new Promise((resolve) => setTimeout(resolve, 50));
      const afterFirst = new Date();

      const context2 = tracer.startTrace();
      tracer.endTrace(context2.traceId);

      const recentTraces = tracer.getCompletedTraces(afterFirst);

      expect(recentTraces.length).toBe(1);
      expect(recentTraces[0].traceId).toBe(context2.traceId);
    });

    it('should export spans', () => {
      const context = tracer.startTrace();
      tracer.startSpan('span1', context).end();
      tracer.startSpan('span2', context).end();
      tracer.endTrace(context.traceId);

      const spans = tracer.exportSpans();

      expect(spans.length).toBe(3);
    });
  });

  describe('Metrics', () => {
    it('should collect span duration metrics', () => {
      const context = tracer.startTrace();
      tracer.startSpan('test', context).end();
      tracer.endTrace(context.traceId);

      const metrics = tracer.getMetricsCollector().getMetrics();

      // Histogram metrics include labels in the key
      expect(
        Object.keys(metrics).some((k) => k.includes('span_duration_ms') && k.includes('_count'))
      ).toBe(true);
    });

    it('should count span errors', () => {
      const context = tracer.startTrace();
      tracer.startSpan('failing', context).setError('Failed').end();
      tracer.endTrace(context.traceId);

      const metrics = tracer.getMetricsCollector().getMetrics();

      expect(
        Object.keys(metrics).some((k) => k.includes('span_errors'))
      ).toBe(true);
    });

    it('should provide gateway metrics summary', () => {
      const context = tracer.startTrace();
      tracer.endTrace(context.traceId);

      const metrics = tracer.getGatewayMetrics();

      expect(metrics.requestsTotal).toBeDefined();
      expect(metrics.requestsByServer).toBeDefined();
      expect(metrics.requestsByTool).toBeDefined();
    });
  });

  describe('Memory Management', () => {
    it('should respect maxTraces limit', () => {
      const smallTracer = createDistributedTracer(logger, {
        serviceName: 'test',
        samplingRate: 1.0,
        maxSpansPerTrace: 100,
        maxTraces: 5,
        propagateContext: true,
        exportIntervalMs: 0,
      });

      // Create more traces than the limit
      for (let i = 0; i < 10; i++) {
        const context = smallTracer.startTrace();
        smallTracer.endTrace(context.traceId);
      }

      const completed = smallTracer.getCompletedTraces();
      expect(completed.length).toBeLessThanOrEqual(5);

      smallTracer.stop();
    });

    it('should clear all data', () => {
      const context = tracer.startTrace();
      tracer.startSpan('test', context).end();
      tracer.endTrace(context.traceId);

      tracer.clear();

      expect(tracer.getActiveTraces().length).toBe(0);
      expect(tracer.getCompletedTraces().length).toBe(0);
    });
  });

  describe('Simple Metrics Collector', () => {
    it('should increment counters', () => {
      const collector = tracer.getMetricsCollector();

      collector.incrementCounter('test_counter');
      collector.incrementCounter('test_counter');
      collector.incrementCounter('test_counter', 5);

      const metrics = collector.getMetrics();
      expect(metrics['test_counter']).toBe(7);
    });

    it('should set gauges', () => {
      const collector = tracer.getMetricsCollector();

      collector.setGauge('test_gauge', 100);
      collector.setGauge('test_gauge', 200);

      const metrics = collector.getMetrics();
      expect(metrics['test_gauge']).toBe(200);
    });

    it('should record histograms', () => {
      const collector = tracer.getMetricsCollector();

      collector.recordHistogram('latency', 100);
      collector.recordHistogram('latency', 200);
      collector.recordHistogram('latency', 150);

      const metrics = collector.getMetrics();
      expect(metrics['latency_avg']).toBe(150);
      expect(metrics['latency_count']).toBe(3);
    });

    it('should support labels', () => {
      const collector = tracer.getMetricsCollector();

      collector.incrementCounter('requests', 1, { server: 'server1' });
      collector.incrementCounter('requests', 1, { server: 'server2' });
      collector.incrementCounter('requests', 1, { server: 'server1' });

      const metrics = collector.getMetrics();
      expect(metrics['requests{server=server1}']).toBe(2);
      expect(metrics['requests{server=server2}']).toBe(1);
    });
  });
});
