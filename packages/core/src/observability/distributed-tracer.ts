// ============================================================================
// AEGIS Enterprise MCP - Distributed Tracing (OpenTelemetry Compatible)
// Provides end-to-end visibility across multi-server MCP environments
// Based on: "自社管理型MCPエコシステムの構築" Technical Report
// ============================================================================

import type {
  Logger,
  TraceContext,
  ToolExecutionSpan,
  SpanEvent,
  GatewayMetrics,
  createTraceContext,
  generateTraceId,
  generateSpanId,
} from '@aegis/shared';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Span status.
 */
export type SpanStatus = 'unset' | 'ok' | 'error';

/**
 * Span kind for categorization.
 */
export type SpanKind =
  | 'internal'    // Internal operation
  | 'server'      // Server receiving request
  | 'client'      // Client sending request
  | 'producer'    // Message producer
  | 'consumer';   // Message consumer

/**
 * Full span with additional metadata.
 */
export interface Span extends ToolExecutionSpan {
  kind: SpanKind;
  links?: TraceContext[];
  isRoot: boolean;
}

/**
 * Trace containing all spans.
 */
export interface Trace {
  traceId: string;
  rootSpan: Span;
  spans: Span[];
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  status: SpanStatus;
}

/**
 * Tracer configuration.
 */
export interface TracerConfig {
  /** Service name for spans */
  serviceName: string;

  /** Sampling rate (0-1) */
  samplingRate: number;

  /** Maximum spans per trace */
  maxSpansPerTrace: number;

  /** Maximum traces to keep in memory */
  maxTraces: number;

  /** Whether to propagate trace context */
  propagateContext: boolean;

  /** Export interval in ms (0 = disabled) */
  exportIntervalMs: number;

  /** Exporter configuration */
  exporter?: {
    type: 'console' | 'otlp' | 'custom';
    endpoint?: string;
    headers?: Record<string, string>;
  };
}

/**
 * Span builder for fluent API.
 */
export interface SpanBuilder {
  setKind(kind: SpanKind): SpanBuilder;
  setAttribute(key: string, value: string | number | boolean): SpanBuilder;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): SpanBuilder;
  addLink(context: TraceContext): SpanBuilder;
  setError(message: string): SpanBuilder;
  end(): Span;
}

/**
 * Metrics collector.
 */
export interface MetricsCollector {
  /** Record a counter metric */
  incrementCounter(name: string, value?: number, labels?: Record<string, string>): void;

  /** Record a gauge metric */
  setGauge(name: string, value: number, labels?: Record<string, string>): void;

  /** Record a histogram value */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;

  /** Get all metrics */
  getMetrics(): Record<string, number | Record<string, number>>;
}

// ============================================================================
// Distributed Tracer Implementation
// ============================================================================

/**
 * Distributed tracer for MCP operations.
 * Compatible with OpenTelemetry concepts but lightweight.
 */
export class DistributedTracer extends EventEmitter {
  private logger: Logger;
  private config: TracerConfig;
  private activeTraces: Map<string, Trace> = new Map();
  private completedTraces: Trace[] = [];
  private spanStack: Map<string, Span[]> = new Map();
  private metricsCollector: SimpleMetricsCollector;
  private exportTimer?: ReturnType<typeof setInterval>;

  constructor(logger: Logger, config?: Partial<TracerConfig>) {
    super();
    this.logger = logger;
    this.config = {
      serviceName: 'aegis-gateway',
      samplingRate: 1.0,
      maxSpansPerTrace: 100,
      maxTraces: 1000,
      propagateContext: true,
      exportIntervalMs: 0,
      ...config,
    };

    this.metricsCollector = new SimpleMetricsCollector();

    // Start export timer if configured
    if (this.config.exportIntervalMs > 0) {
      this.startExportTimer();
    }
  }

  // ===== Tracing API =====

  /**
   * Start a new trace or continue an existing one.
   */
  startTrace(parentContext?: TraceContext): TraceContext {
    // Apply sampling
    if (Math.random() > this.config.samplingRate) {
      // Return a context that won't be traced
      return {
        traceId: 'unsampled',
        spanId: generateSpanIdLocal(),
        traceFlags: 0, // Not sampled
      };
    }

    const context: TraceContext = {
      traceId: parentContext?.traceId ?? generateTraceIdLocal(),
      spanId: generateSpanIdLocal(),
      parentSpanId: parentContext?.spanId,
      traceFlags: 1, // Sampled
    };

    if (!parentContext) {
      // Create new trace
      const rootSpan: Span = {
        context,
        name: 'root',
        operationType: 'routing',
        startTime: new Date(),
        status: 'unset',
        attributes: { 'service.name': this.config.serviceName },
        kind: 'server',
        isRoot: true,
      };

      const trace: Trace = {
        traceId: context.traceId,
        rootSpan,
        spans: [rootSpan],
        startTime: new Date(),
        status: 'unset',
      };

      this.activeTraces.set(context.traceId, trace);
      this.spanStack.set(context.traceId, [rootSpan]);
    }

    return context;
  }

  /**
   * Start a new span within a trace.
   */
  startSpan(
    name: string,
    parentContext: TraceContext,
    operationType: ToolExecutionSpan['operationType'] = 'tool-call'
  ): SpanBuilder {
    const trace = this.activeTraces.get(parentContext.traceId);
    const context: TraceContext = {
      traceId: parentContext.traceId,
      spanId: generateSpanIdLocal(),
      parentSpanId: parentContext.spanId,
      traceFlags: parentContext.traceFlags,
    };

    const span: Span = {
      context,
      name,
      operationType,
      startTime: new Date(),
      status: 'unset',
      attributes: {},
      kind: 'internal',
      isRoot: false,
    };

    if (trace) {
      trace.spans.push(span);
      const stack = this.spanStack.get(parentContext.traceId) || [];
      stack.push(span);
      this.spanStack.set(parentContext.traceId, stack);
    }

    return new SpanBuilderImpl(span, () => this.endSpan(span));
  }

  /**
   * End a span.
   */
  private endSpan(span: Span): Span {
    span.endTime = new Date();
    span.durationMs = span.endTime.getTime() - span.startTime.getTime();

    // Pop from stack
    const stack = this.spanStack.get(span.context.traceId);
    if (stack) {
      const index = stack.indexOf(span);
      if (index !== -1) {
        stack.splice(index, 1);
      }
    }

    // Record metrics
    this.metricsCollector.recordHistogram(
      'span_duration_ms',
      span.durationMs,
      {
        operation: span.operationType,
        status: span.status,
      }
    );

    if (span.status === 'error') {
      this.metricsCollector.incrementCounter('span_errors_total', 1, {
        operation: span.operationType,
      });
    }

    return span;
  }

  /**
   * End a trace.
   */
  endTrace(traceId: string, status: SpanStatus = 'ok'): Trace | undefined {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return undefined;

    trace.endTime = new Date();
    trace.durationMs = trace.endTime.getTime() - trace.startTime.getTime();
    trace.status = status;

    // End root span
    trace.rootSpan.endTime = trace.endTime;
    trace.rootSpan.durationMs = trace.durationMs;
    trace.rootSpan.status = status;

    // Move to completed
    this.activeTraces.delete(traceId);
    this.completedTraces.push(trace);
    this.spanStack.delete(traceId);

    // Trim if needed
    while (this.completedTraces.length > this.config.maxTraces) {
      this.completedTraces.shift();
    }

    // Record metrics
    this.metricsCollector.recordHistogram('trace_duration_ms', trace.durationMs);
    this.metricsCollector.incrementCounter('traces_total');

    this.emit('trace-completed', trace);
    return trace;
  }

  // ===== Context Propagation =====

  /**
   * Extract trace context from headers.
   */
  extractContext(headers: Record<string, string>): TraceContext | undefined {
    // W3C Trace Context format
    const traceparent = headers['traceparent'];
    if (traceparent) {
      const parts = traceparent.split('-');
      if (parts.length === 4) {
        return {
          traceId: parts[1],
          spanId: parts[2],
          traceFlags: parseInt(parts[3], 16),
          traceState: headers['tracestate'],
        };
      }
    }

    return undefined;
  }

  /**
   * Inject trace context into headers.
   */
  injectContext(context: TraceContext, headers: Record<string, string>): void {
    if (!this.config.propagateContext) return;

    // W3C Trace Context format: version-traceId-spanId-traceFlags
    const traceparent = `00-${context.traceId}-${context.spanId}-${(
      context.traceFlags || 0
    )
      .toString(16)
      .padStart(2, '0')}`;
    headers['traceparent'] = traceparent;

    if (context.traceState) {
      headers['tracestate'] = context.traceState;
    }
  }

  // ===== Query API =====

  /**
   * Get active traces.
   */
  getActiveTraces(): Trace[] {
    return Array.from(this.activeTraces.values());
  }

  /**
   * Get completed traces.
   */
  getCompletedTraces(since?: Date): Trace[] {
    if (!since) return [...this.completedTraces];
    return this.completedTraces.filter((t) => t.startTime >= since);
  }

  /**
   * Get a specific trace.
   */
  getTrace(traceId: string): Trace | undefined {
    return (
      this.activeTraces.get(traceId) ||
      this.completedTraces.find((t) => t.traceId === traceId)
    );
  }

  /**
   * Get spans for a trace.
   */
  getSpans(traceId: string): Span[] {
    const trace = this.getTrace(traceId);
    return trace?.spans || [];
  }

  /**
   * Export spans in OpenTelemetry-compatible format.
   */
  exportSpans(since?: Date): ToolExecutionSpan[] {
    const traces = this.getCompletedTraces(since);
    const spans: ToolExecutionSpan[] = [];

    for (const trace of traces) {
      spans.push(...trace.spans);
    }

    return spans;
  }

  // ===== Metrics =====

  /**
   * Get metrics collector.
   */
  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  /**
   * Get gateway metrics summary.
   */
  getGatewayMetrics(): GatewayMetrics {
    const metrics = this.metricsCollector.getMetrics();
    const serverRequests: Record<string, number> = {};
    const serverErrors: Record<string, number> = {};
    const toolRequests: Record<string, number> = {};

    // Extract from metrics
    for (const [key, value] of Object.entries(metrics)) {
      if (key.startsWith('requests_by_server_')) {
        const server = key.replace('requests_by_server_', '');
        serverRequests[server] = value as number;
      } else if (key.startsWith('errors_by_server_')) {
        const server = key.replace('errors_by_server_', '');
        serverErrors[server] = value as number;
      } else if (key.startsWith('requests_by_tool_')) {
        const tool = key.replace('requests_by_tool_', '');
        toolRequests[tool] = value as number;
      }
    }

    return {
      requestsTotal: (metrics['requests_total'] as number) || 0,
      requestsByServer: serverRequests,
      requestsByTool: toolRequests,
      errorsByServer: serverErrors,
      avgLatencyByServer: {},
      p99LatencyByServer: {},
      circuitBreakerTrips: (metrics['circuit_breaker_trips_total'] as number) || 0,
      samplingRequests: (metrics['sampling_requests_total'] as number) || 0,
      samplingTokensUsed: (metrics['sampling_tokens_total'] as number) || 0,
    };
  }

  // ===== Export =====

  private startExportTimer(): void {
    this.exportTimer = setInterval(() => {
      this.exportToConsole();
    }, this.config.exportIntervalMs);
  }

  private exportToConsole(): void {
    const traces = this.completedTraces.slice(-10); // Last 10 traces
    for (const trace of traces) {
      this.logger.debug('Trace completed', {
        traceId: trace.traceId,
        duration: trace.durationMs,
        spanCount: trace.spans.length,
        status: trace.status,
      });
    }
  }

  /**
   * Stop the tracer.
   */
  stop(): void {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }
  }

  /**
   * Clear all traces.
   */
  clear(): void {
    this.activeTraces.clear();
    this.completedTraces = [];
    this.spanStack.clear();
    this.metricsCollector.clear();
  }
}

// ============================================================================
// SpanBuilder Implementation
// ============================================================================

class SpanBuilderImpl implements SpanBuilder {
  constructor(
    private span: Span,
    private onEnd: () => Span
  ) {}

  setKind(kind: SpanKind): SpanBuilder {
    this.span.kind = kind;
    return this;
  }

  setAttribute(key: string, value: string | number | boolean): SpanBuilder {
    this.span.attributes[key] = value;
    return this;
  }

  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): SpanBuilder {
    if (!this.span.events) {
      this.span.events = [];
    }
    this.span.events.push({
      name,
      timestamp: new Date(),
      attributes,
    });
    return this;
  }

  addLink(context: TraceContext): SpanBuilder {
    if (!this.span.links) {
      this.span.links = [];
    }
    this.span.links.push(context);
    return this;
  }

  setError(message: string): SpanBuilder {
    this.span.status = 'error';
    this.span.errorMessage = message;
    this.addEvent('exception', { message });
    return this;
  }

  end(): Span {
    return this.onEnd();
  }
}

// ============================================================================
// Simple Metrics Collector
// ============================================================================

class SimpleMetricsCollector implements MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  incrementCounter(
    name: string,
    value: number = 1,
    labels?: Record<string, string>
  ): void {
    const key = this.makeKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  setGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, value);
  }

  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    const key = this.makeKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);

    // Keep only last 1000 values
    if (values.length > 1000) {
      values.shift();
    }

    this.histograms.set(key, values);
  }

  getMetrics(): Record<string, number | Record<string, number>> {
    const result: Record<string, number | Record<string, number>> = {};

    for (const [key, value] of this.counters.entries()) {
      result[key] = value;
    }

    for (const [key, value] of this.gauges.entries()) {
      result[key] = value;
    }

    for (const [key, values] of this.histograms.entries()) {
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const p99Index = Math.floor(sorted.length * 0.99);

        result[`${key}_avg`] = avg;
        result[`${key}_p99`] = sorted[p99Index] || 0;
        result[`${key}_count`] = values.length;
      }
    }

    return result;
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private makeKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }

    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');

    return `${name}{${labelStr}}`;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateTraceIdLocal(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSpanIdLocal(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a distributed tracer with default configuration.
 */
export function createDistributedTracer(
  logger: Logger,
  config?: Partial<TracerConfig>
): DistributedTracer {
  return new DistributedTracer(logger, config);
}
