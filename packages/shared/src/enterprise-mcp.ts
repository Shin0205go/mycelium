// ============================================================================
// AEGIS Enterprise MCP Architecture Types
// Based on: "自社管理型MCPエコシステムの構築" Technical Report
// ============================================================================

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Logger, Role, ThinkingSignature, MCPServerConfig } from './index.js';

// Re-define ToolCallContext locally to avoid circular dependency
// (The main definition is in index.ts)
interface LocalToolCallContext {
  thinking?: ThinkingSignature;
  agentName?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 1. Sampling Types (Server-side LLM Requests)
// ============================================================================

/**
 * Model preferences for sampling requests.
 * Servers can hint at cost/speed/capability tradeoffs.
 */
export interface ModelPreferences {
  /** Prioritize cost efficiency */
  costPriority?: 'low' | 'medium' | 'high';

  /** Prioritize speed */
  speedPriority?: 'low' | 'medium' | 'high';

  /** Minimum intelligence level required */
  intelligenceLevel?: 'basic' | 'standard' | 'advanced';

  /** Specific model hints (e.g., ['claude-3-haiku', 'gpt-4o-mini']) */
  modelHints?: string[];

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Temperature for generation */
  temperature?: number;
}

/**
 * Context inclusion mode for sampling requests.
 */
export type ContextInclusionMode =
  | 'none'           // No additional context
  | 'thisServer'     // Only context from requesting server
  | 'allServers';    // Context from all connected servers

/**
 * Message role in sampling conversation.
 */
export type SamplingRole = 'user' | 'assistant';

/**
 * Content types supported in sampling messages.
 */
export interface SamplingTextContent {
  type: 'text';
  text: string;
}

export interface SamplingImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type SamplingContent = SamplingTextContent | SamplingImageContent;

/**
 * Message in a sampling request.
 */
export interface SamplingMessage {
  role: SamplingRole;
  content: SamplingContent;
}

/**
 * Request from MCP server to create a message using host's LLM.
 * Implements sampling/createMessage from MCP specification.
 */
export interface CreateMessageRequest {
  /** The conversation messages */
  messages: SamplingMessage[];

  /** System prompt for the LLM */
  systemPrompt?: string;

  /** Model preferences and hints */
  modelPreferences?: ModelPreferences;

  /** What context to include from other servers */
  includeContext?: ContextInclusionMode;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Stop sequences */
  stopSequences?: string[];

  /** Additional metadata from the requesting server */
  metadata?: Record<string, unknown>;
}

/**
 * Response to a sampling request.
 */
export interface CreateMessageResult {
  /** The model that was used */
  model: string;

  /** Message role (always 'assistant') */
  role: 'assistant';

  /** Generated content */
  content: SamplingContent;

  /** Stop reason */
  stopReason?: 'endTurn' | 'stopSequence' | 'maxTokens';

  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Approval mode for sampling requests.
 */
export type SamplingApprovalMode =
  | 'always'         // Always require user approval
  | 'never'          // Never require approval (auto-approve)
  | 'policy-based';  // Decide based on content/source

/**
 * Sampling handler configuration.
 */
export interface SamplingConfig {
  /** Whether sampling is enabled */
  enabled: boolean;

  /** Approval mode */
  approvalMode: SamplingApprovalMode;

  /** Default model to use if no preference specified */
  defaultModel: string;

  /** Model mapping for preferences -> actual model IDs */
  modelMapping: {
    basic: string;
    standard: string;
    advanced: string;
  };

  /** Maximum tokens allowed per request */
  maxTokensLimit: number;

  /** Allowed servers that can request sampling */
  allowedServers?: string[];

  /** Blocked servers that cannot request sampling */
  blockedServers?: string[];

  /** Rate limits for sampling requests */
  rateLimits?: {
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
    maxTokensPerHour: number;
  };
}

// ============================================================================
// 2. Capability Negotiation Types
// ============================================================================

/**
 * Client capabilities declared during initialization.
 */
export interface ClientCapabilities {
  /** Sampling capability - can handle createMessage requests */
  sampling?: Record<string, unknown>;

  /** Roots capability - can provide filesystem boundaries */
  roots?: {
    listChanged?: boolean;
  };

  /** Experimental capabilities */
  experimental?: Record<string, unknown>;
}

/**
 * Server capabilities returned during initialization.
 */
export interface ServerCapabilities {
  /** Tools capability */
  tools?: {
    listChanged?: boolean;
  };

  /** Resources capability */
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };

  /** Prompts capability */
  prompts?: {
    listChanged?: boolean;
  };

  /** Logging capability */
  logging?: Record<string, unknown>;

  /** Experimental capabilities */
  experimental?: Record<string, unknown>;
}

/**
 * Negotiated capabilities between client and server.
 */
export interface NegotiatedCapabilities {
  /** Protocol version agreed upon */
  protocolVersion: string;

  /** Client capabilities */
  client: ClientCapabilities;

  /** Server capabilities */
  server: ServerCapabilities;

  /** Negotiation timestamp */
  negotiatedAt: Date;

  /** Whether full capability set was negotiated */
  isFullyNegotiated: boolean;
}

/**
 * Capability requirement for a role or tool.
 */
export interface CapabilityRequirement {
  /** Required capability name */
  capability: string;

  /** Minimum version required (semantic versioning) */
  minVersion?: string;

  /** Whether this capability is optional */
  optional?: boolean;

  /** Fallback behavior if capability is unavailable */
  fallback?: 'degrade' | 'error' | 'skip';
}

// ============================================================================
// 3. Tool Space Interference (TSI) Mitigation Types
// ============================================================================

/**
 * Tool conflict detection result.
 */
export interface ToolConflict {
  /** Tool name that conflicts */
  toolName: string;

  /** Servers that provide this tool */
  conflictingServers: string[];

  /** Type of conflict */
  conflictType: 'name-collision' | 'semantic-overlap' | 'version-mismatch';

  /** Severity of the conflict */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Whether this conflict is resolvable */
  resolvable: boolean;

  /** Suggested resolution strategy */
  suggestedResolution?: ConflictResolutionStrategy;
}

/**
 * Strategy for resolving tool conflicts.
 */
export type ConflictResolutionStrategy =
  | { type: 'prefix'; serverPrefix: string }
  | { type: 'namespace'; namespace: string }
  | { type: 'priority'; primaryServer: string; fallbackServers: string[] }
  | { type: 'version-select'; preferredVersion: string }
  | { type: 'merge'; mergedSchema: Tool }
  | { type: 'hide'; hiddenServers: string[] };

/**
 * Tool namespace for organizing tools from multiple servers.
 */
export interface ToolNamespace {
  /** Namespace identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description: string;

  /** Prefix used for tools in this namespace */
  prefix: string;

  /** Servers included in this namespace */
  servers: string[];

  /** Conflict resolution rules for this namespace */
  conflictRules?: ConflictResolutionRule[];
}

/**
 * Rule for resolving conflicts within a namespace.
 */
export interface ConflictResolutionRule {
  /** Pattern to match tool names */
  toolPattern: string;

  /** Resolution strategy to apply */
  strategy: ConflictResolutionStrategy;

  /** Priority of this rule (higher = checked first) */
  priority: number;
}

/**
 * Tool visibility override for TSI mitigation.
 */
export interface ToolVisibilityOverride {
  /** Tool name pattern */
  pattern: string;

  /** Whether to show or hide */
  action: 'show' | 'hide' | 'rename';

  /** New name if action is 'rename' */
  newName?: string;

  /** Condition for applying this override */
  condition?: {
    /** Only apply for specific roles */
    roles?: string[];
    /** Only apply for specific contexts */
    contexts?: string[];
  };
}

/**
 * Context-aware tool selection for large tool spaces.
 * Implements Nexus-MCP pattern for reducing TSI.
 */
export interface ToolSelectionContext {
  /** User's query or intent */
  query: string;

  /** Current conversation context */
  conversationHistory?: SamplingMessage[];

  /** Previously used tools in this session */
  recentTools?: string[];

  /** Maximum number of tools to present */
  maxTools: number;

  /** Categories to prioritize */
  priorityCategories?: string[];

  /** Servers to prioritize */
  priorityServers?: string[];
}

/**
 * Result of context-aware tool selection.
 */
export interface ToolSelectionResult {
  /** Selected tools to present */
  selectedTools: Tool[];

  /** Total tools available before selection */
  totalToolsAvailable: number;

  /** Selection method used */
  selectionMethod: 'categorical' | 'semantic' | 'frequency' | 'hybrid';

  /** Confidence scores for selected tools */
  confidenceScores?: Map<string, number>;

  /** Excluded tools with reasons */
  excludedTools?: Array<{
    tool: string;
    reason: string;
  }>;
}

// ============================================================================
// 4. Routing Strategy Types
// ============================================================================

/**
 * Routing strategy for tool execution.
 */
export type RoutingStrategyType =
  | 'prefix'           // Route by server prefix (default)
  | 'weighted'         // Weighted distribution across servers
  | 'round-robin'      // Round-robin across available servers
  | 'least-connections'// Route to least-busy server
  | 'latency-based'    // Route to fastest-responding server
  | 'failover'         // Primary with fallback chain
  | 'smart';           // AI-assisted routing

/**
 * Weighted routing configuration.
 */
export interface WeightedRoutingConfig {
  type: 'weighted';

  /** Server weights (higher = more traffic) */
  weights: Record<string, number>;

  /** Whether to adjust weights based on performance */
  dynamicWeighting?: boolean;
}

/**
 * Failover routing configuration.
 */
export interface FailoverRoutingConfig {
  type: 'failover';

  /** Primary server */
  primary: string;

  /** Fallback servers in order of preference */
  fallbacks: string[];

  /** Conditions that trigger failover */
  failoverConditions: FailoverCondition[];
}

/**
 * Condition that triggers failover.
 */
export interface FailoverCondition {
  /** Type of condition */
  type: 'error-rate' | 'latency' | 'health-check' | 'timeout';

  /** Threshold for triggering (interpretation depends on type) */
  threshold: number;

  /** Time window for evaluation (ms) */
  windowMs: number;
}

/**
 * Circuit breaker state.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;

  /** Time to wait before half-opening (ms) */
  resetTimeoutMs: number;

  /** Number of successes needed to close from half-open */
  successThreshold: number;

  /** Whether to track failures per-tool or per-server */
  granularity: 'server' | 'tool';
}

/**
 * Circuit breaker status for a server or tool.
 */
export interface CircuitBreakerStatus {
  /** Current state */
  state: CircuitState;

  /** Failure count in current window */
  failureCount: number;

  /** Success count since last state change */
  successCount: number;

  /** When the circuit last changed state */
  lastStateChange: Date;

  /** When the circuit will attempt to half-open (if open) */
  nextRetryAt?: Date;
}

/**
 * Retry configuration for failed requests.
 */
export interface RetryConfig {
  /** Maximum retry attempts */
  maxRetries: number;

  /** Base delay between retries (ms) */
  baseDelayMs: number;

  /** Maximum delay between retries (ms) */
  maxDelayMs: number;

  /** Backoff multiplier */
  backoffMultiplier: number;

  /** Whether to use jitter */
  useJitter: boolean;

  /** Error types that should trigger retry */
  retryableErrors: string[];
}

/**
 * Complete routing configuration.
 */
export interface RoutingConfig {
  /** Default routing strategy */
  defaultStrategy: RoutingStrategyType;

  /** Per-server routing configurations */
  serverConfigs?: Record<string, WeightedRoutingConfig | FailoverRoutingConfig>;

  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig;

  /** Retry configuration */
  retry?: RetryConfig;

  /** Request timeout (ms) */
  timeoutMs: number;

  /** Enable request deduplication */
  deduplication?: boolean;

  /** Enable request batching */
  batching?: {
    enabled: boolean;
    maxBatchSize: number;
    maxWaitMs: number;
  };
}

// ============================================================================
// 5. Gateway Aggregation Types
// ============================================================================

/**
 * Server health status.
 */
export interface ServerHealth {
  /** Server name */
  server: string;

  /** Whether the server is healthy */
  healthy: boolean;

  /** Current status */
  status: 'connected' | 'disconnected' | 'degraded' | 'unknown';

  /** Last successful request time */
  lastSuccess?: Date;

  /** Last failure time */
  lastFailure?: Date;

  /** Average response time (ms) */
  avgResponseTimeMs?: number;

  /** Error rate (0-1) */
  errorRate?: number;

  /** Circuit breaker status */
  circuitBreaker?: CircuitBreakerStatus;
}

/**
 * Server capability summary.
 */
export interface ServerCapabilitySummary {
  /** Server name */
  server: string;

  /** Number of tools provided */
  toolCount: number;

  /** Number of resources provided */
  resourceCount: number;

  /** Number of prompts provided */
  promptCount: number;

  /** Negotiated capabilities */
  capabilities: ServerCapabilities;

  /** Server version info */
  serverInfo?: {
    name: string;
    version: string;
  };
}

/**
 * Aggregated gateway status.
 */
export interface GatewayStatus {
  /** Total number of configured servers */
  totalServers: number;

  /** Number of connected servers */
  connectedServers: number;

  /** Total tools available */
  totalTools: number;

  /** Tools by server */
  toolsByServer: Record<string, number>;

  /** Server health statuses */
  serverHealth: ServerHealth[];

  /** Active conflicts */
  activeConflicts: ToolConflict[];

  /** Gateway uptime (ms) */
  uptimeMs: number;

  /** Last aggregation time */
  lastAggregatedAt: Date;
}

/**
 * Server registration for dynamic gateway.
 */
export interface ServerRegistration {
  /** Server name */
  name: string;

  /** Server configuration */
  config: MCPServerConfig;

  /** Server tags for grouping */
  tags?: string[];

  /** Priority (higher = preferred) */
  priority?: number;

  /** Whether this server is critical */
  critical?: boolean;

  /** Dependencies on other servers */
  dependencies?: string[];

  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Dynamic server registry for gateway.
 */
export interface ServerRegistry {
  /** Register a new server */
  register(registration: ServerRegistration): Promise<void>;

  /** Deregister a server */
  deregister(name: string): Promise<void>;

  /** Get server by name */
  get(name: string): ServerRegistration | undefined;

  /** Get all registered servers */
  getAll(): ServerRegistration[];

  /** Get servers by tag */
  getByTag(tag: string): ServerRegistration[];

  /** Check if server is registered */
  has(name: string): boolean;
}

// ============================================================================
// 6. Distributed Tracing Types (OpenTelemetry Compatible)
// ============================================================================

/**
 * Trace context for distributed tracing.
 */
export interface TraceContext {
  /** Trace ID (32 hex chars) */
  traceId: string;

  /** Span ID (16 hex chars) */
  spanId: string;

  /** Parent span ID */
  parentSpanId?: string;

  /** Trace flags */
  traceFlags?: number;

  /** Trace state (W3C format) */
  traceState?: string;
}

/**
 * Span for tracing tool execution.
 */
export interface ToolExecutionSpan {
  /** Span context */
  context: TraceContext;

  /** Span name */
  name: string;

  /** Operation type */
  operationType: 'tool-call' | 'sampling' | 'routing' | 'aggregation';

  /** Start time */
  startTime: Date;

  /** End time */
  endTime?: Date;

  /** Duration in ms */
  durationMs?: number;

  /** Status */
  status: 'ok' | 'error' | 'unset';

  /** Error message if status is 'error' */
  errorMessage?: string;

  /** Attributes */
  attributes: Record<string, string | number | boolean>;

  /** Events during the span */
  events?: SpanEvent[];
}

/**
 * Event within a span.
 */
export interface SpanEvent {
  /** Event name */
  name: string;

  /** Event timestamp */
  timestamp: Date;

  /** Event attributes */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Metrics for observability.
 */
export interface GatewayMetrics {
  /** Total requests processed */
  requestsTotal: number;

  /** Requests by server */
  requestsByServer: Record<string, number>;

  /** Requests by tool */
  requestsByTool: Record<string, number>;

  /** Errors by server */
  errorsByServer: Record<string, number>;

  /** Average latency by server (ms) */
  avgLatencyByServer: Record<string, number>;

  /** P99 latency by server (ms) */
  p99LatencyByServer: Record<string, number>;

  /** Circuit breaker trips */
  circuitBreakerTrips: number;

  /** Sampling requests */
  samplingRequests: number;

  /** Sampling tokens used */
  samplingTokensUsed: number;
}

// ============================================================================
// 7. Virtual MCP Server Types (OpenAPI to MCP)
// ============================================================================

/**
 * OpenAPI operation mapping to MCP tool.
 */
export interface OpenAPIToolMapping {
  /** OpenAPI operation ID */
  operationId: string;

  /** HTTP method */
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';

  /** Path template */
  path: string;

  /** Mapped MCP tool name */
  toolName: string;

  /** Tool description (from OpenAPI summary/description) */
  description: string;

  /** Input schema derived from OpenAPI */
  inputSchema: Record<string, unknown>;

  /** Response handling configuration */
  responseMapping?: {
    /** JSONPath to extract result */
    resultPath?: string;
    /** Expected content type */
    contentType?: string;
  };
}

/**
 * Configuration for virtual MCP server from OpenAPI.
 */
export interface VirtualServerConfig {
  /** Server name */
  name: string;

  /** OpenAPI spec URL or path */
  openApiSpec: string;

  /** Base URL for API calls */
  baseUrl: string;

  /** Authentication configuration */
  auth?: {
    type: 'bearer' | 'api-key' | 'basic' | 'oauth2';
    tokenEnvVar?: string;
    headerName?: string;
  };

  /** Tool name prefix */
  toolPrefix?: string;

  /** Operations to include (glob patterns) */
  includeOperations?: string[];

  /** Operations to exclude (glob patterns) */
  excludeOperations?: string[];

  /** Rate limiting for this virtual server */
  rateLimit?: {
    requestsPerMinute: number;
    burstSize: number;
  };

  /** Request timeout (ms) */
  timeoutMs?: number;

  /** Custom headers to include in all requests */
  headers?: Record<string, string>;
}

/**
 * Virtual server status.
 */
export interface VirtualServerStatus {
  /** Server name */
  name: string;

  /** Whether the server is active */
  active: boolean;

  /** Number of tools available */
  toolCount: number;

  /** Last OpenAPI spec refresh */
  lastRefreshed?: Date;

  /** Parsing errors if any */
  errors?: string[];
}

// ============================================================================
// 8. HITL (Human-in-the-Loop) Types
// ============================================================================

/**
 * Approval request for sensitive operations.
 */
export interface ApprovalRequest {
  /** Unique request ID */
  id: string;

  /** Type of operation requiring approval */
  operationType: 'tool-call' | 'sampling' | 'role-switch';

  /** Details of the operation */
  details: {
    /** Tool name (for tool-call) */
    toolName?: string;
    /** Tool arguments (for tool-call) */
    arguments?: Record<string, unknown>;
    /** Sampling request (for sampling) */
    samplingRequest?: CreateMessageRequest;
    /** Target role (for role-switch) */
    targetRole?: string;
  };

  /** Source of the request */
  source: {
    /** Server name */
    server?: string;
    /** Current role */
    role: string;
    /** Agent name */
    agentName?: string;
  };

  /** Risk assessment */
  risk: {
    level: 'low' | 'medium' | 'high' | 'critical';
    reasons: string[];
  };

  /** When the request was created */
  createdAt: Date;

  /** Timeout for the approval */
  expiresAt: Date;
}

/**
 * Approval response from user.
 */
export interface ApprovalResponse {
  /** Request ID being responded to */
  requestId: string;

  /** Approval decision */
  approved: boolean;

  /** Modified arguments if approved with changes */
  modifiedArguments?: Record<string, unknown>;

  /** Reason for decision */
  reason?: string;

  /** Who approved/denied */
  respondedBy?: string;

  /** When the response was given */
  respondedAt: Date;
}

/**
 * HITL policy configuration.
 */
export interface HITLPolicy {
  /** Operations that always require approval */
  alwaysRequireApproval: string[];

  /** Operations that never require approval */
  neverRequireApproval: string[];

  /** Risk-based approval rules */
  riskBasedRules: Array<{
    /** Pattern to match operation */
    pattern: string;
    /** Minimum risk level to require approval */
    minRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  }>;

  /** Default timeout for approvals (ms) */
  defaultTimeoutMs: number;

  /** Action on timeout */
  timeoutAction: 'deny' | 'approve' | 'escalate';
}

// ============================================================================
// 9. Enterprise Gateway Interface
// ============================================================================

/**
 * Complete enterprise gateway configuration.
 */
export interface EnterpriseGatewayConfig {
  /** Gateway name */
  name: string;

  /** Sampling configuration */
  sampling?: SamplingConfig;

  /** Routing configuration */
  routing?: RoutingConfig;

  /** HITL policy */
  hitlPolicy?: HITLPolicy;

  /** Tool namespace configurations */
  namespaces?: ToolNamespace[];

  /** Virtual server configurations */
  virtualServers?: VirtualServerConfig[];

  /** Conflict resolution rules */
  conflictRules?: ConflictResolutionRule[];

  /** Observability settings */
  observability?: {
    /** Enable distributed tracing */
    tracingEnabled: boolean;
    /** Trace sampling rate (0-1) */
    traceSamplingRate: number;
    /** Enable metrics collection */
    metricsEnabled: boolean;
    /** Metrics export interval (ms) */
    metricsIntervalMs: number;
  };

  /** Security settings */
  security?: {
    /** Enable input validation */
    inputValidation: boolean;
    /** Enable output filtering */
    outputFiltering: boolean;
    /** Enable request signing */
    requestSigning: boolean;
  };
}

/**
 * Enterprise gateway interface.
 * Extends basic gateway with enterprise features.
 */
export interface EnterpriseGateway {
  // ===== Lifecycle =====

  /** Initialize the gateway */
  initialize(config: EnterpriseGatewayConfig): Promise<void>;

  /** Shutdown the gateway */
  shutdown(): Promise<void>;

  // ===== Server Management =====

  /** Get server registry */
  getRegistry(): ServerRegistry;

  /** Get gateway status */
  getStatus(): GatewayStatus;

  /** Get server health */
  getServerHealth(server: string): ServerHealth | undefined;

  // ===== Tool Routing =====

  /** Route a tool call */
  routeToolCall(
    toolName: string,
    arguments_: Record<string, unknown>,
    context?: LocalToolCallContext
  ): Promise<unknown>;

  /** Get available tools (with TSI mitigation) */
  getAvailableTools(context?: ToolSelectionContext): Promise<ToolSelectionResult>;

  /** Detect tool conflicts */
  detectConflicts(): ToolConflict[];

  /** Resolve a specific conflict */
  resolveConflict(conflict: ToolConflict, strategy: ConflictResolutionStrategy): void;

  // ===== Sampling =====

  /** Handle a sampling request from a server */
  handleSamplingRequest(
    server: string,
    request: CreateMessageRequest
  ): Promise<CreateMessageResult>;

  /** Get sampling configuration */
  getSamplingConfig(): SamplingConfig | undefined;

  /** Update sampling configuration */
  updateSamplingConfig(config: Partial<SamplingConfig>): void;

  // ===== HITL =====

  /** Request approval for an operation */
  requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;

  /** Get pending approvals */
  getPendingApprovals(): ApprovalRequest[];

  /** Respond to an approval request */
  respondToApproval(response: ApprovalResponse): void;

  // ===== Observability =====

  /** Get metrics */
  getMetrics(): GatewayMetrics;

  /** Export traces */
  exportTraces(since: Date): ToolExecutionSpan[];

  /** Get current trace context */
  getTraceContext(): TraceContext | undefined;

  // ===== Capability Negotiation =====

  /** Get negotiated capabilities for a server */
  getNegotiatedCapabilities(server: string): NegotiatedCapabilities | undefined;

  /** Renegotiate capabilities with a server */
  renegotiateCapabilities(server: string): Promise<NegotiatedCapabilities>;
}

// ============================================================================
// 10. Factory Functions
// ============================================================================

/**
 * Create default sampling configuration.
 */
export function createDefaultSamplingConfig(): SamplingConfig {
  return {
    enabled: false,
    approvalMode: 'policy-based',
    defaultModel: 'claude-3-5-haiku-latest',
    modelMapping: {
      basic: 'claude-3-5-haiku-latest',
      standard: 'claude-sonnet-4-5-20250929',
      advanced: 'claude-opus-4-5-20251101',
    },
    maxTokensLimit: 4096,
    rateLimits: {
      maxRequestsPerMinute: 10,
      maxRequestsPerHour: 100,
      maxTokensPerHour: 50000,
    },
  };
}

/**
 * Create default routing configuration.
 */
export function createDefaultRoutingConfig(): RoutingConfig {
  return {
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
  };
}

/**
 * Create default HITL policy.
 */
export function createDefaultHITLPolicy(): HITLPolicy {
  return {
    alwaysRequireApproval: [
      'delete_*',
      'destroy_*',
      '*_admin_*',
      'execute_command',
    ],
    neverRequireApproval: [
      'list_*',
      'get_*',
      'read_*',
      'search_*',
    ],
    riskBasedRules: [
      { pattern: 'write_*', minRiskLevel: 'medium' },
      { pattern: 'update_*', minRiskLevel: 'medium' },
      { pattern: 'create_*', minRiskLevel: 'low' },
    ],
    defaultTimeoutMs: 60000,
    timeoutAction: 'deny',
  };
}

/**
 * Generate a trace ID (32 hex chars).
 */
export function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a span ID (16 hex chars).
 */
export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a new trace context.
 */
export function createTraceContext(parentContext?: TraceContext): TraceContext {
  return {
    traceId: parentContext?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parentContext?.spanId,
    traceFlags: 1, // Sampled
  };
}

// ============================================================================
// 11. Type Guards
// ============================================================================

/**
 * Check if content is text content.
 */
export function isTextContent(content: SamplingContent): content is SamplingTextContent {
  return content.type === 'text';
}

/**
 * Check if content is image content.
 */
export function isImageContent(content: SamplingContent): content is SamplingImageContent {
  return content.type === 'image';
}

/**
 * Check if a routing config is weighted routing.
 */
export function isWeightedRouting(
  config: WeightedRoutingConfig | FailoverRoutingConfig
): config is WeightedRoutingConfig {
  return config.type === 'weighted';
}

/**
 * Check if a routing config is failover routing.
 */
export function isFailoverRouting(
  config: WeightedRoutingConfig | FailoverRoutingConfig
): config is FailoverRoutingConfig {
  return config.type === 'failover';
}
