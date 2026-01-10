// ============================================================================
// AEGIS RBAC - Capability Manager
// JWT-like capability token issuance and verification
// ============================================================================

import { createHmac, randomBytes } from 'crypto';
import type {
  Logger,
  CapabilityDeclaration,
  CapabilityToken,
  CapabilityTokenPayload,
  CapabilityVerificationResult,
  CapabilityAttenuationRequest,
  CapabilityContextConstraints
} from '@aegis/shared';

// ============================================================================
// Constants
// ============================================================================

/** Default token expiration in milliseconds */
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/** Scope level hierarchy (higher index = more privileged) */
const SCOPE_LEVELS = ['read-only', 'write', 'admin'] as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse duration string to milliseconds
 * Supports: '5m', '1h', '24h', '30s', '7d'
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Expected: 5m, 1h, 24h, 30s, 7d`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Generate a unique token ID
 */
function generateTokenId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Check if scope A is a subset of (or equal to) scope B
 * Format: 'type:level' (e.g., 'db-access:read-only')
 */
function isScopeSubset(scopeA: string, scopeB: string): boolean {
  const [typeA, levelA] = scopeA.split(':');
  const [typeB, levelB] = scopeB.split(':');

  // Type must match exactly
  if (typeA !== typeB) return false;

  // Level must be <= parent level
  const levelIndexA = SCOPE_LEVELS.indexOf(levelA as typeof SCOPE_LEVELS[number]);
  const levelIndexB = SCOPE_LEVELS.indexOf(levelB as typeof SCOPE_LEVELS[number]);

  // Unknown levels are treated as lowest
  if (levelIndexA === -1 || levelIndexB === -1) return levelA === levelB;

  return levelIndexA <= levelIndexB;
}

// ============================================================================
// Capability Manager
// ============================================================================

/**
 * Configuration for CapabilityManager
 */
export interface CapabilityManagerConfig {
  /** Secret key for signing tokens (should be securely stored in production) */
  secretKey?: string;

  /** Maximum tokens to track in memory (for use counting) */
  maxTrackedTokens?: number;

  /** Enable strict mode (fail-close on any validation issue) */
  strictMode?: boolean;
}

/**
 * Token tracking entry (for use count and revocation)
 */
interface TrackedToken {
  jti: string;
  usesRemaining: number;
  createdAt: Date;
  lastUsedAt?: Date;
  revoked: boolean;
  revokedReason?: string;
}

/**
 * Capability Manager
 * Handles JWT-like capability token issuance, verification, and attenuation
 */
export class CapabilityManager {
  private logger: Logger;
  private secretKey: string;
  private trackedTokens: Map<string, TrackedToken> = new Map();
  private maxTrackedTokens: number;
  private strictMode: boolean;

  constructor(logger: Logger, config?: CapabilityManagerConfig) {
    this.logger = logger;
    this.secretKey = config?.secretKey || randomBytes(32).toString('hex');
    this.maxTrackedTokens = config?.maxTrackedTokens || 10000;
    this.strictMode = config?.strictMode || false;

    this.logger.debug('CapabilityManager initialized', {
      strictMode: this.strictMode,
      maxTrackedTokens: this.maxTrackedTokens
    });
  }

  // ============================================================================
  // Token Issuance
  // ============================================================================

  /**
   * Issue a new capability token based on skill declaration
   */
  issue(
    skillId: string,
    declaration: CapabilityDeclaration,
    subjectId: string,
    taskContext?: Record<string, unknown>
  ): CapabilityToken {
    const now = Math.floor(Date.now() / 1000);
    const expiryMs = declaration.expiresIn
      ? parseDuration(declaration.expiresIn)
      : DEFAULT_EXPIRY_MS;
    const exp = now + Math.floor(expiryMs / 1000);

    const jti = generateTokenId();

    // Build context constraints
    const context: CapabilityContextConstraints = {
      ...declaration.contextConstraints
    };

    // Inject task context if provided
    if (taskContext?.taskId) {
      context.taskId = String(taskContext.taskId);
    }

    const payload: CapabilityTokenPayload = {
      iss: skillId,
      sub: subjectId,
      scope: `${declaration.type}:${declaration.scope}`,
      exp,
      iat: now,
      nbf: now,
      jti,
      usesLeft: declaration.maxUses,
      attenuationAllowed: declaration.attenuationAllowed ?? true,
      context: Object.keys(context).length > 0 ? context : undefined
    };

    const token = this.sign(payload);

    // Track token for use counting
    if (declaration.maxUses !== undefined) {
      this.trackToken(jti, declaration.maxUses);
    }

    this.logger.info(`Issued capability token`, {
      skillId,
      scope: payload.scope,
      expiresIn: declaration.expiresIn,
      maxUses: declaration.maxUses,
      jti
    });

    return {
      payload,
      token,
      metadata: {
        createdAt: new Date(),
        useCount: 0
      }
    };
  }

  /**
   * Issue an attenuated (weaker) token from a parent token
   */
  attenuate(request: CapabilityAttenuationRequest): CapabilityToken {
    // Verify parent token first
    const parentResult = this.verify(request.parentToken);
    if (!parentResult.valid || !parentResult.payload) {
      throw new Error(`Cannot attenuate invalid token: ${parentResult.reason}`);
    }

    const parentPayload = parentResult.payload;

    // Check attenuation is allowed
    if (!parentPayload.attenuationAllowed) {
      throw new Error('Parent token does not allow attenuation');
    }

    // Verify new scope is subset of parent scope
    if (!isScopeSubset(request.newScope, parentPayload.scope)) {
      throw new Error(
        `New scope '${request.newScope}' is not a subset of parent scope '${parentPayload.scope}'`
      );
    }

    // Calculate new expiration
    const now = Math.floor(Date.now() / 1000);
    let newExp = parentPayload.exp; // Default to parent expiration

    if (request.newExpiresIn) {
      const newExpiryMs = parseDuration(request.newExpiresIn);
      const requestedExp = now + Math.floor(newExpiryMs / 1000);
      newExp = Math.min(requestedExp, parentPayload.exp);
    }

    // Calculate new max uses
    let newUsesLeft: number | undefined = undefined;
    if (parentPayload.usesLeft !== undefined) {
      if (request.newMaxUses !== undefined) {
        newUsesLeft = Math.min(request.newMaxUses, parentPayload.usesLeft);
      } else {
        newUsesLeft = parentPayload.usesLeft;
      }
    } else if (request.newMaxUses !== undefined) {
      newUsesLeft = request.newMaxUses;
    }

    const jti = generateTokenId();

    // Merge context constraints
    const context: CapabilityContextConstraints = {
      ...parentPayload.context,
      ...request.additionalContext
    };

    const payload: CapabilityTokenPayload = {
      iss: parentPayload.iss,
      sub: parentPayload.sub,
      scope: request.newScope,
      exp: newExp,
      iat: now,
      nbf: now,
      jti,
      usesLeft: newUsesLeft,
      parentJti: parentPayload.jti,
      attenuationAllowed: parentPayload.attenuationAllowed,
      context: Object.keys(context).length > 0 ? context : undefined
    };

    const token = this.sign(payload);

    // Track token for use counting
    if (newUsesLeft !== undefined) {
      this.trackToken(jti, newUsesLeft);
    }

    this.logger.info(`Issued attenuated token`, {
      parentJti: parentPayload.jti,
      newScope: request.newScope,
      jti
    });

    return {
      payload,
      token,
      metadata: {
        createdAt: new Date(),
        useCount: 0
      }
    };
  }

  // ============================================================================
  // Token Verification
  // ============================================================================

  /**
   * Verify a capability token
   * Does NOT consume a use - call consume() for that
   */
  verify(token: string, requiredScope?: string): CapabilityVerificationResult {
    try {
      // Decode and verify signature
      const payload = this.decode(token);
      if (!payload) {
        return { valid: false, reason: 'Invalid token signature' };
      }

      const now = Math.floor(Date.now() / 1000);

      // Check expiration
      if (payload.exp < now) {
        return { valid: false, reason: 'Token has expired' };
      }

      // Check not-before
      if (payload.nbf > now) {
        return { valid: false, reason: 'Token is not yet valid' };
      }

      // Check revocation
      const tracked = this.trackedTokens.get(payload.jti);
      if (tracked?.revoked) {
        return { valid: false, reason: `Token revoked: ${tracked.revokedReason}` };
      }

      // Check uses remaining
      if (payload.usesLeft !== undefined) {
        const usesRemaining = tracked?.usesRemaining ?? payload.usesLeft;
        if (usesRemaining <= 0) {
          return { valid: false, reason: 'Token has no remaining uses' };
        }
      }

      // Check required scope
      if (requiredScope && !isScopeSubset(requiredScope, payload.scope)) {
        return {
          valid: false,
          reason: `Token scope '${payload.scope}' does not satisfy required scope '${requiredScope}'`
        };
      }

      return {
        valid: true,
        payload,
        usesRemaining: tracked?.usesRemaining ?? payload.usesLeft
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Token verification failed: ${message}`);

      if (this.strictMode) {
        throw error;
      }

      return { valid: false, reason: message };
    }
  }

  /**
   * Verify token and check context constraints
   */
  verifyWithContext(
    token: string,
    requiredScope: string,
    context: Record<string, unknown>
  ): CapabilityVerificationResult {
    const result = this.verify(token, requiredScope);
    if (!result.valid || !result.payload) {
      return result;
    }

    const payload = result.payload;

    // Check context constraints
    if (payload.context) {
      // Check task ID constraint
      if (payload.context.taskId && payload.context.taskId !== context.taskId) {
        return {
          valid: false,
          reason: `Token is bound to task '${payload.context.taskId}', not '${context.taskId}'`
        };
      }

      // Check allowed tools constraint
      if (payload.context.allowedTools && context.toolName) {
        const toolName = String(context.toolName);
        if (!payload.context.allowedTools.includes(toolName)) {
          return {
            valid: false,
            reason: `Tool '${toolName}' is not in allowed tools for this token`
          };
        }
      }

      // Check allowed servers constraint
      if (payload.context.allowedServers && context.serverName) {
        const serverName = String(context.serverName);
        if (!payload.context.allowedServers.includes(serverName)) {
          return {
            valid: false,
            reason: `Server '${serverName}' is not in allowed servers for this token`
          };
        }
      }
    }

    return result;
  }

  /**
   * Consume one use of a token
   * Returns updated uses remaining, or throws if no uses left
   */
  consume(token: string): number | undefined {
    const result = this.verify(token);
    if (!result.valid || !result.payload) {
      throw new Error(`Cannot consume invalid token: ${result.reason}`);
    }

    const payload = result.payload;
    const tracked = this.trackedTokens.get(payload.jti);

    if (tracked) {
      if (tracked.usesRemaining <= 0) {
        throw new Error('Token has no remaining uses');
      }

      tracked.usesRemaining--;
      tracked.lastUsedAt = new Date();

      this.logger.debug(`Consumed token use`, {
        jti: payload.jti,
        usesRemaining: tracked.usesRemaining
      });

      return tracked.usesRemaining;
    }

    // Token not tracked (unlimited uses)
    return undefined;
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /**
   * Revoke a token
   */
  revoke(jti: string, reason: string = 'Manually revoked'): boolean {
    const tracked = this.trackedTokens.get(jti);
    if (tracked) {
      tracked.revoked = true;
      tracked.revokedReason = reason;
      this.logger.info(`Revoked token`, { jti, reason });
      return true;
    }

    // Create a tracked entry just for revocation
    this.trackedTokens.set(jti, {
      jti,
      usesRemaining: 0,
      createdAt: new Date(),
      revoked: true,
      revokedReason: reason
    });

    this.logger.info(`Revoked untracked token`, { jti, reason });
    return true;
  }

  /**
   * Check if a token is revoked
   */
  isRevoked(jti: string): boolean {
    return this.trackedTokens.get(jti)?.revoked ?? false;
  }

  /**
   * Get token statistics
   */
  getStats(): {
    trackedTokens: number;
    revokedTokens: number;
    exhaustedTokens: number;
  } {
    let revokedTokens = 0;
    let exhaustedTokens = 0;

    for (const tracked of this.trackedTokens.values()) {
      if (tracked.revoked) revokedTokens++;
      if (tracked.usesRemaining <= 0) exhaustedTokens++;
    }

    return {
      trackedTokens: this.trackedTokens.size,
      revokedTokens,
      exhaustedTokens
    };
  }

  /**
   * Clean up expired and fully-consumed tokens
   */
  cleanup(): number {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleaned = 0;

    for (const [jti, tracked] of this.trackedTokens.entries()) {
      const age = now - tracked.createdAt.getTime();

      // Clean up old tokens (expired or exhausted for 24h+)
      if (age > maxAge && (tracked.usesRemaining <= 0 || tracked.revoked)) {
        this.trackedTokens.delete(jti);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} tokens`);
    }

    return cleaned;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Track a token for use counting
   */
  private trackToken(jti: string, maxUses: number): void {
    // Cleanup if we're at capacity
    if (this.trackedTokens.size >= this.maxTrackedTokens) {
      this.cleanup();
    }

    this.trackedTokens.set(jti, {
      jti,
      usesRemaining: maxUses,
      createdAt: new Date(),
      revoked: false
    });
  }

  /**
   * Sign a payload and return the complete token
   * Format: base64url(payload).base64url(signature)
   */
  private sign(payload: CapabilityTokenPayload): string {
    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr).toString('base64url');

    const signature = createHmac('sha256', this.secretKey)
      .update(payloadB64)
      .digest('base64url');

    return `${payloadB64}.${signature}`;
  }

  /**
   * Decode and verify a token's signature
   * Returns payload if valid, null if invalid
   */
  private decode(token: string): CapabilityTokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [payloadB64, signature] = parts;

    // Verify signature
    const expectedSignature = createHmac('sha256', this.secretKey)
      .update(payloadB64)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return null;
    }

    // Decode payload
    try {
      const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
      return JSON.parse(payloadStr) as CapabilityTokenPayload;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a CapabilityManager instance
 */
export function createCapabilityManager(
  logger: Logger,
  config?: CapabilityManagerConfig
): CapabilityManager {
  return new CapabilityManager(logger, config);
}
