// ============================================================================
// AEGIS Enterprise MCP - Sampling Handler
// Implements server-side LLM requests via sampling/createMessage
// Based on: "自社管理型MCPエコシステムの構築" Technical Report
// ============================================================================

import type {
  Logger,
  SamplingConfig,
  CreateMessageRequest,
  CreateMessageResult,
  SamplingMessage,
  ModelPreferences,
  ApprovalRequest,
  ApprovalResponse,
  HITLPolicy,
  ThinkingSignature,
  createDefaultSamplingConfig,
} from '@aegis/shared';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * LLM client interface for abstraction over different providers.
 */
export interface LLMClient {
  /** Provider name (e.g., 'anthropic', 'openai') */
  provider: string;

  /** Generate a message */
  createMessage(request: LLMRequest): Promise<LLMResponse>;

  /** Check if provider supports a specific model */
  supportsModel(modelId: string): boolean;
}

/**
 * Request to the LLM client.
 */
export interface LLMRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

/**
 * Response from the LLM client.
 */
export interface LLMResponse {
  model: string;
  content: string;
  stopReason?: 'endTurn' | 'stopSequence' | 'maxTokens';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  thinking?: ThinkingSignature;
}

/**
 * Sampling statistics.
 */
export interface SamplingStats {
  /** Total requests processed */
  totalRequests: number;

  /** Requests approved */
  approvedRequests: number;

  /** Requests denied */
  deniedRequests: number;

  /** Requests that timed out */
  timedOutRequests: number;

  /** Total tokens used */
  totalTokensUsed: number;

  /** Requests by server */
  requestsByServer: Record<string, number>;

  /** Tokens by server */
  tokensByServer: Record<string, number>;

  /** Requests in current hour */
  requestsThisHour: number;

  /** Tokens in current hour */
  tokensThisHour: number;
}

/**
 * Rate limit status.
 */
export interface RateLimitStatus {
  /** Whether rate limit is exceeded */
  exceeded: boolean;

  /** Which limit was exceeded */
  limitType?: 'requests-per-minute' | 'requests-per-hour' | 'tokens-per-hour';

  /** Current usage */
  currentUsage: number;

  /** Limit value */
  limit: number;

  /** When the limit resets */
  resetsAt: Date;
}

// ============================================================================
// Events
// ============================================================================

export interface SamplingHandlerEvents {
  /** Emitted when approval is needed */
  'approval-needed': (request: ApprovalRequest) => void;

  /** Emitted when a request is processed */
  'request-processed': (result: {
    server: string;
    approved: boolean;
    tokensUsed?: number;
    duration: number;
  }) => void;

  /** Emitted when rate limit is hit */
  'rate-limit-exceeded': (status: RateLimitStatus) => void;
}

// ============================================================================
// Sampling Handler Implementation
// ============================================================================

/**
 * Handles sampling requests from MCP servers.
 * Implements the sampling/createMessage flow with HITL support.
 */
export class SamplingHandler extends EventEmitter {
  private logger: Logger;
  private config: SamplingConfig;
  private hitlPolicy?: HITLPolicy;
  private llmClients: Map<string, LLMClient> = new Map();
  private stats: SamplingStats;
  private pendingApprovals: Map<string, {
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  // Rate limiting state
  private requestTimestamps: Date[] = [];
  private hourlyRequests: number = 0;
  private hourlyTokens: number = 0;
  private lastHourReset: Date;

  constructor(
    logger: Logger,
    config?: Partial<SamplingConfig>,
    hitlPolicy?: HITLPolicy
  ) {
    super();
    this.logger = logger;
    this.config = {
      enabled: false,
      approvalMode: 'policy-based',
      defaultModel: 'claude-3-5-haiku-latest',
      modelMapping: {
        basic: 'claude-3-5-haiku-latest',
        standard: 'claude-sonnet-4-5-20250929',
        advanced: 'claude-opus-4-5-20251101',
      },
      maxTokensLimit: 4096,
      ...config,
    };
    this.hitlPolicy = hitlPolicy;
    this.lastHourReset = new Date();
    this.stats = this.initializeStats();
  }

  private initializeStats(): SamplingStats {
    return {
      totalRequests: 0,
      approvedRequests: 0,
      deniedRequests: 0,
      timedOutRequests: 0,
      totalTokensUsed: 0,
      requestsByServer: {},
      tokensByServer: {},
      requestsThisHour: 0,
      tokensThisHour: 0,
    };
  }

  // ===== Configuration =====

  /**
   * Update sampling configuration.
   */
  updateConfig(config: Partial<SamplingConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Sampling configuration updated', { config: this.config });
  }

  /**
   * Get current configuration.
   */
  getConfig(): SamplingConfig {
    return { ...this.config };
  }

  /**
   * Set HITL policy.
   */
  setHITLPolicy(policy: HITLPolicy): void {
    this.hitlPolicy = policy;
    this.logger.info('HITL policy updated');
  }

  /**
   * Register an LLM client.
   */
  registerLLMClient(provider: string, client: LLMClient): void {
    this.llmClients.set(provider, client);
    this.logger.info(`LLM client registered: ${provider}`);
  }

  // ===== Main Handler =====

  /**
   * Handle a sampling/createMessage request from an MCP server.
   */
  async handleCreateMessage(
    serverName: string,
    request: CreateMessageRequest,
    currentRole: string
  ): Promise<CreateMessageResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    this.stats.requestsByServer[serverName] =
      (this.stats.requestsByServer[serverName] || 0) + 1;

    this.logger.info(`Sampling request from server: ${serverName}`, {
      role: currentRole,
      messageCount: request.messages.length,
      maxTokens: request.maxTokens,
    });

    // Check if sampling is enabled
    if (!this.config.enabled) {
      this.stats.deniedRequests++;
      throw new SamplingDisabledError('Sampling is not enabled');
    }

    // Check server allowlist/blocklist
    if (!this.isServerAllowed(serverName)) {
      this.stats.deniedRequests++;
      throw new SamplingNotAllowedError(
        `Server '${serverName}' is not allowed to request sampling`
      );
    }

    // Check rate limits
    const rateLimitStatus = this.checkRateLimits();
    if (rateLimitStatus.exceeded) {
      this.stats.deniedRequests++;
      this.emit('rate-limit-exceeded', rateLimitStatus);
      throw new SamplingRateLimitError(
        `Rate limit exceeded: ${rateLimitStatus.limitType}`,
        rateLimitStatus
      );
    }

    // Determine if approval is needed
    const needsApproval = this.needsApproval(serverName, request);

    if (needsApproval) {
      // Create approval request
      const approvalRequest = this.createApprovalRequest(
        serverName,
        request,
        currentRole
      );

      // Request approval (async)
      const approvalResponse = await this.requestApproval(approvalRequest);

      if (!approvalResponse.approved) {
        this.stats.deniedRequests++;
        throw new SamplingDeniedError(
          approvalResponse.reason || 'Request denied by user'
        );
      }

      // Apply any modifications from approval
      if (approvalResponse.modifiedArguments) {
        request = {
          ...request,
          ...approvalResponse.modifiedArguments,
        } as CreateMessageRequest;
      }
    }

    // Select the appropriate model
    const selectedModel = this.selectModel(request.modelPreferences);

    // Enforce max tokens limit
    const maxTokens = Math.min(
      request.maxTokens || this.config.maxTokensLimit,
      this.config.maxTokensLimit
    );

    // Execute the LLM request
    const result = await this.executeLLMRequest(
      selectedModel,
      request,
      maxTokens
    );

    // Update statistics
    this.stats.approvedRequests++;
    if (result.usage) {
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
      this.stats.totalTokensUsed += totalTokens;
      this.stats.tokensByServer[serverName] =
        (this.stats.tokensByServer[serverName] || 0) + totalTokens;
      this.hourlyTokens += totalTokens;
    }
    this.requestTimestamps.push(new Date());
    this.hourlyRequests++;

    const duration = Date.now() - startTime;
    this.emit('request-processed', {
      server: serverName,
      approved: true,
      tokensUsed: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
      duration,
    });

    this.logger.info(`Sampling request completed`, {
      server: serverName,
      model: result.model,
      duration,
      tokensUsed: result.usage,
    });

    return result;
  }

  // ===== Private Methods =====

  private isServerAllowed(serverName: string): boolean {
    // Check blocklist first
    if (this.config.blockedServers?.includes(serverName)) {
      return false;
    }

    // If allowlist is specified, server must be on it
    if (this.config.allowedServers && this.config.allowedServers.length > 0) {
      return this.config.allowedServers.includes(serverName);
    }

    // Default: allow all servers not on blocklist
    return true;
  }

  private checkRateLimits(): RateLimitStatus {
    const now = new Date();

    // Reset hourly counters if needed
    if (now.getTime() - this.lastHourReset.getTime() > 3600000) {
      this.hourlyRequests = 0;
      this.hourlyTokens = 0;
      this.lastHourReset = now;
    }

    // Clean up old request timestamps (older than 1 minute)
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => ts > oneMinuteAgo
    );

    const limits = this.config.rateLimits;
    if (!limits) {
      return { exceeded: false, currentUsage: 0, limit: Infinity, resetsAt: now };
    }

    // Check requests per minute
    if (this.requestTimestamps.length >= limits.maxRequestsPerMinute) {
      return {
        exceeded: true,
        limitType: 'requests-per-minute',
        currentUsage: this.requestTimestamps.length,
        limit: limits.maxRequestsPerMinute,
        resetsAt: new Date(this.requestTimestamps[0].getTime() + 60000),
      };
    }

    // Check requests per hour
    if (this.hourlyRequests >= limits.maxRequestsPerHour) {
      return {
        exceeded: true,
        limitType: 'requests-per-hour',
        currentUsage: this.hourlyRequests,
        limit: limits.maxRequestsPerHour,
        resetsAt: new Date(this.lastHourReset.getTime() + 3600000),
      };
    }

    // Check tokens per hour
    if (this.hourlyTokens >= limits.maxTokensPerHour) {
      return {
        exceeded: true,
        limitType: 'tokens-per-hour',
        currentUsage: this.hourlyTokens,
        limit: limits.maxTokensPerHour,
        resetsAt: new Date(this.lastHourReset.getTime() + 3600000),
      };
    }

    return {
      exceeded: false,
      currentUsage: this.requestTimestamps.length,
      limit: limits.maxRequestsPerMinute,
      resetsAt: now,
    };
  }

  private needsApproval(
    serverName: string,
    request: CreateMessageRequest
  ): boolean {
    switch (this.config.approvalMode) {
      case 'always':
        return true;
      case 'never':
        return false;
      case 'policy-based':
        return this.checkPolicyBasedApproval(serverName, request);
      default:
        return true;
    }
  }

  private checkPolicyBasedApproval(
    serverName: string,
    request: CreateMessageRequest
  ): boolean {
    if (!this.hitlPolicy) {
      // Default: require approval for untrusted sources
      return true;
    }

    // Check for high-risk content in messages
    const hasHighRiskContent = request.messages.some((msg) => {
      if (msg.content.type !== 'text') return false;
      const text = msg.content.text.toLowerCase();
      return (
        text.includes('delete') ||
        text.includes('destroy') ||
        text.includes('admin') ||
        text.includes('sudo') ||
        text.includes('password')
      );
    });

    if (hasHighRiskContent) {
      return true;
    }

    // Check if server is in the never-require list
    for (const pattern of this.hitlPolicy.neverRequireApproval) {
      if (this.matchesPattern(serverName, pattern)) {
        return false;
      }
    }

    // Check if server is in the always-require list
    for (const pattern of this.hitlPolicy.alwaysRequireApproval) {
      if (this.matchesPattern(serverName, pattern)) {
        return true;
      }
    }

    // Default: don't require approval
    return false;
  }

  private matchesPattern(value: string, pattern: string): boolean {
    // Simple glob matching with * wildcard
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(value);
  }

  private createApprovalRequest(
    serverName: string,
    request: CreateMessageRequest,
    currentRole: string
  ): ApprovalRequest {
    const now = new Date();
    const timeoutMs = this.hitlPolicy?.defaultTimeoutMs || 60000;

    return {
      id: `sampling-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      operationType: 'sampling',
      details: {
        samplingRequest: request,
      },
      source: {
        server: serverName,
        role: currentRole,
      },
      risk: this.assessRisk(request),
      createdAt: now,
      expiresAt: new Date(now.getTime() + timeoutMs),
    };
  }

  private assessRisk(request: CreateMessageRequest): {
    level: 'low' | 'medium' | 'high' | 'critical';
    reasons: string[];
  } {
    const reasons: string[] = [];
    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';

    // Check message count
    if (request.messages.length > 10) {
      reasons.push('Large conversation context');
      level = 'medium';
    }

    // Check for image content
    const hasImages = request.messages.some(
      (msg) => msg.content.type === 'image'
    );
    if (hasImages) {
      reasons.push('Contains image content');
      level = 'medium';
    }

    // Check max tokens requested
    if (request.maxTokens && request.maxTokens > 2048) {
      reasons.push('High token count requested');
      if (level === 'low') level = 'medium';
    }

    // Check for advanced model request
    if (
      request.modelPreferences?.intelligenceLevel === 'advanced' ||
      request.modelPreferences?.modelHints?.some((h) =>
        h.includes('opus') || h.includes('gpt-4')
      )
    ) {
      reasons.push('Advanced model requested (higher cost)');
      level = 'high';
    }

    // Check for all-servers context
    if (request.includeContext === 'allServers') {
      reasons.push('Requests access to all server contexts');
      level = 'high';
    }

    return { level, reasons };
  }

  private async requestApproval(
    request: ApprovalRequest
  ): Promise<ApprovalResponse> {
    return new Promise((resolve, reject) => {
      const timeoutMs =
        request.expiresAt.getTime() - request.createdAt.getTime();

      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(request.id);
        this.stats.timedOutRequests++;

        const action = this.hitlPolicy?.timeoutAction || 'deny';
        if (action === 'deny') {
          resolve({
            requestId: request.id,
            approved: false,
            reason: 'Approval request timed out',
            respondedAt: new Date(),
          });
        } else if (action === 'approve') {
          resolve({
            requestId: request.id,
            approved: true,
            reason: 'Auto-approved on timeout',
            respondedAt: new Date(),
          });
        } else {
          reject(new Error('Approval request timed out - escalation required'));
        }
      }, timeoutMs);

      this.pendingApprovals.set(request.id, {
        request,
        resolve,
        reject,
        timeout,
      });

      // Emit event for UI to handle
      this.emit('approval-needed', request);

      this.logger.info('Approval request created', {
        id: request.id,
        operationType: request.operationType,
        expiresAt: request.expiresAt,
      });
    });
  }

  /**
   * Respond to a pending approval request.
   */
  respondToApproval(response: ApprovalResponse): void {
    const pending = this.pendingApprovals.get(response.requestId);
    if (!pending) {
      this.logger.warn('No pending approval found', { id: response.requestId });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(response.requestId);
    pending.resolve(response);

    this.logger.info('Approval response received', {
      id: response.requestId,
      approved: response.approved,
    });
  }

  /**
   * Get pending approvals.
   */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map((p) => p.request);
  }

  private selectModel(preferences?: ModelPreferences): string {
    // If specific model hints are provided, try to use them
    if (preferences?.modelHints && preferences.modelHints.length > 0) {
      const hintedModel = preferences.modelHints[0];
      // Check if any client supports this model
      for (const client of this.llmClients.values()) {
        if (client.supportsModel(hintedModel)) {
          return hintedModel;
        }
      }
    }

    // Select based on intelligence level
    const level = preferences?.intelligenceLevel || 'standard';
    switch (level) {
      case 'basic':
        return this.config.modelMapping.basic;
      case 'advanced':
        return this.config.modelMapping.advanced;
      case 'standard':
      default:
        return this.config.modelMapping.standard;
    }
  }

  private async executeLLMRequest(
    model: string,
    request: CreateMessageRequest,
    maxTokens: number
  ): Promise<CreateMessageResult> {
    // Find a client that supports this model
    let selectedClient: LLMClient | undefined;
    for (const client of this.llmClients.values()) {
      if (client.supportsModel(model)) {
        selectedClient = client;
        break;
      }
    }

    if (!selectedClient) {
      throw new SamplingExecutionError(
        `No LLM client available for model: ${model}`
      );
    }

    // Convert sampling messages to LLM format
    const llmMessages = this.convertMessages(request);
    if (request.systemPrompt) {
      llmMessages.unshift({
        role: 'system' as const,
        content: request.systemPrompt,
      });
    }

    try {
      const response = await selectedClient.createMessage({
        model,
        messages: llmMessages,
        maxTokens,
        temperature: request.modelPreferences?.temperature,
        stopSequences: request.stopSequences,
      });

      return {
        model: response.model,
        role: 'assistant',
        content: {
          type: 'text',
          text: response.content,
        },
        stopReason: response.stopReason,
        usage: response.usage,
      };
    } catch (error) {
      throw new SamplingExecutionError(
        `LLM request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private convertMessages(
    request: CreateMessageRequest
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return request.messages
      .filter((msg) => msg.content.type === 'text')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: (msg.content as { type: 'text'; text: string }).text,
      }));
  }

  // ===== Statistics =====

  /**
   * Get sampling statistics.
   */
  getStats(): SamplingStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = this.initializeStats();
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class SamplingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SamplingError';
  }
}

export class SamplingDisabledError extends SamplingError {
  constructor(message: string) {
    super(message);
    this.name = 'SamplingDisabledError';
  }
}

export class SamplingNotAllowedError extends SamplingError {
  constructor(message: string) {
    super(message);
    this.name = 'SamplingNotAllowedError';
  }
}

export class SamplingRateLimitError extends SamplingError {
  constructor(
    message: string,
    public readonly status: RateLimitStatus
  ) {
    super(message);
    this.name = 'SamplingRateLimitError';
  }
}

export class SamplingDeniedError extends SamplingError {
  constructor(message: string) {
    super(message);
    this.name = 'SamplingDeniedError';
  }
}

export class SamplingExecutionError extends SamplingError {
  constructor(message: string) {
    super(message);
    this.name = 'SamplingExecutionError';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a sampling handler with default configuration.
 */
export function createSamplingHandler(
  logger: Logger,
  config?: Partial<SamplingConfig>,
  hitlPolicy?: HITLPolicy
): SamplingHandler {
  return new SamplingHandler(logger, config, hitlPolicy);
}

/**
 * Create a mock LLM client for testing.
 */
export function createMockLLMClient(
  provider: string,
  responseContent: string = 'Mock response'
): LLMClient {
  return {
    provider,
    supportsModel: () => true,
    createMessage: async (request: LLMRequest): Promise<LLMResponse> => {
      return {
        model: request.model,
        content: responseContent,
        stopReason: 'endTurn',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      };
    },
  };
}
