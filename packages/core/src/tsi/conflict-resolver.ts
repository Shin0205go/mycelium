// ============================================================================
// AEGIS Enterprise MCP - Tool Space Interference (TSI) Mitigation
// Implements conflict detection and resolution for multi-server environments
// Based on: "自社管理型MCPエコシステムの構築" Technical Report - Nexus-MCP Pattern
// ============================================================================

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  Logger,
  ToolConflict,
  ConflictResolutionStrategy,
  ConflictResolutionRule,
  ToolNamespace,
  ToolVisibilityOverride,
  ToolSelectionContext,
  ToolSelectionResult,
} from '@aegis/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Tool with source server information.
 */
export interface ToolWithSource {
  tool: Tool;
  serverName: string;
  prefixedName: string;
  originalName: string;
}

/**
 * Namespace configuration for TSI mitigation.
 */
export interface NamespaceConfig {
  namespaces: ToolNamespace[];
  defaultNamespace?: string;
}

/**
 * Tool frequency data for smart selection.
 */
export interface ToolFrequencyData {
  toolName: string;
  usageCount: number;
  lastUsed: Date;
  avgExecutionTime?: number;
  successRate?: number;
}

/**
 * Conflict resolver configuration.
 */
export interface ConflictResolverConfig {
  /** Enable automatic conflict resolution */
  autoResolve: boolean;

  /** Default resolution strategy */
  defaultStrategy: ConflictResolutionStrategy['type'];

  /** Custom resolution rules */
  rules: ConflictResolutionRule[];

  /** Namespace configuration */
  namespaces?: NamespaceConfig;

  /** Maximum tools to present (for TSI reduction) */
  maxToolsToPresent: number;

  /** Enable semantic similarity for tool selection */
  enableSemanticSelection: boolean;
}

// ============================================================================
// Conflict Resolver Implementation
// ============================================================================

/**
 * Manages tool space interference by detecting and resolving conflicts,
 * and providing context-aware tool selection.
 */
export class ConflictResolver {
  private logger: Logger;
  private config: ConflictResolverConfig;
  private tools: Map<string, ToolWithSource[]> = new Map();
  private resolvedConflicts: Map<string, ConflictResolutionStrategy> = new Map();
  private toolFrequency: Map<string, ToolFrequencyData> = new Map();
  private visibilityOverrides: ToolVisibilityOverride[] = [];

  constructor(logger: Logger, config?: Partial<ConflictResolverConfig>) {
    this.logger = logger;
    this.config = {
      autoResolve: true,
      defaultStrategy: 'prefix',
      rules: [],
      maxToolsToPresent: 50,
      enableSemanticSelection: false,
      ...config,
    };
  }

  // ===== Tool Registration =====

  /**
   * Register tools from a server.
   */
  registerTools(serverName: string, tools: Tool[]): void {
    for (const tool of tools) {
      const prefixedName = `${serverName}__${tool.name}`;
      const toolWithSource: ToolWithSource = {
        tool,
        serverName,
        prefixedName,
        originalName: tool.name,
      };

      // Track by original name for conflict detection
      const existing = this.tools.get(tool.name) || [];
      existing.push(toolWithSource);
      this.tools.set(tool.name, existing);

      // Track by prefixed name for unique access
      this.tools.set(prefixedName, [toolWithSource]);
    }

    this.logger.info(`Registered ${tools.length} tools from server: ${serverName}`);
  }

  /**
   * Unregister tools from a server.
   */
  unregisterTools(serverName: string): void {
    for (const [name, toolList] of this.tools.entries()) {
      const filtered = toolList.filter((t) => t.serverName !== serverName);
      if (filtered.length === 0) {
        this.tools.delete(name);
      } else {
        this.tools.set(name, filtered);
      }
    }

    this.logger.info(`Unregistered tools from server: ${serverName}`);
  }

  /**
   * Clear all registered tools.
   */
  clearTools(): void {
    this.tools.clear();
    this.resolvedConflicts.clear();
  }

  // ===== Conflict Detection =====

  /**
   * Detect all tool conflicts.
   */
  detectConflicts(): ToolConflict[] {
    const conflicts: ToolConflict[] = [];

    for (const [toolName, toolList] of this.tools.entries()) {
      // Skip prefixed names
      if (toolName.includes('__')) continue;

      // Check for name collisions
      if (toolList.length > 1) {
        const servers = toolList.map((t) => t.serverName);
        const conflict = this.analyzeConflict(toolName, toolList);
        conflicts.push(conflict);
      }
    }

    this.logger.info(`Detected ${conflicts.length} tool conflicts`);
    return conflicts;
  }

  private analyzeConflict(
    toolName: string,
    toolList: ToolWithSource[]
  ): ToolConflict {
    const servers = toolList.map((t) => t.serverName);

    // Analyze conflict type
    let conflictType: ToolConflict['conflictType'] = 'name-collision';
    let severity: ToolConflict['severity'] = 'low';

    // Check for semantic overlap
    const descriptions = toolList.map((t) => t.tool.description?.toLowerCase() || '');
    const hasSemanticOverlap = this.detectSemanticOverlap(descriptions);
    if (hasSemanticOverlap) {
      conflictType = 'semantic-overlap';
      severity = 'medium';
    }

    // Check for version mismatch
    // (In real implementation, you'd check tool metadata for version info)
    const hasVersionMismatch = this.detectVersionMismatch(toolList);
    if (hasVersionMismatch) {
      conflictType = 'version-mismatch';
      severity = 'high';
    }

    // Determine if resolvable
    const resolvable = true; // Most conflicts are resolvable

    // Suggest resolution strategy
    const suggestedResolution = this.suggestResolution(toolName, toolList);

    return {
      toolName,
      conflictingServers: servers,
      conflictType,
      severity,
      resolvable,
      suggestedResolution,
    };
  }

  private detectSemanticOverlap(descriptions: string[]): boolean {
    if (descriptions.length < 2) return false;

    // Simple overlap detection based on common keywords
    const keywords = new Map<string, number>();
    for (const desc of descriptions) {
      const words = desc.split(/\s+/).filter((w) => w.length > 3);
      for (const word of words) {
        keywords.set(word, (keywords.get(word) || 0) + 1);
      }
    }

    // If many keywords appear in multiple descriptions, there's overlap
    let overlapCount = 0;
    for (const count of keywords.values()) {
      if (count > 1) overlapCount++;
    }

    return overlapCount > 3; // Threshold for semantic overlap
  }

  private detectVersionMismatch(toolList: ToolWithSource[]): boolean {
    // Check input schemas for differences
    const schemas = toolList.map((t) => JSON.stringify(t.tool.inputSchema || {}));
    const uniqueSchemas = new Set(schemas);
    return uniqueSchemas.size > 1;
  }

  private suggestResolution(
    toolName: string,
    toolList: ToolWithSource[]
  ): ConflictResolutionStrategy {
    // Check for custom rules first
    for (const rule of this.config.rules) {
      if (this.matchesPattern(toolName, rule.toolPattern)) {
        return rule.strategy;
      }
    }

    // Default strategy based on conflict type
    switch (this.config.defaultStrategy) {
      case 'prefix':
        return { type: 'prefix', serverPrefix: toolList[0].serverName };

      case 'priority':
        return {
          type: 'priority',
          primaryServer: toolList[0].serverName,
          fallbackServers: toolList.slice(1).map((t) => t.serverName),
        };

      case 'namespace':
        return {
          type: 'namespace',
          namespace: this.config.namespaces?.defaultNamespace || 'default',
        };

      default:
        return { type: 'prefix', serverPrefix: toolList[0].serverName };
    }
  }

  private matchesPattern(toolName: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(toolName);
  }

  // ===== Conflict Resolution =====

  /**
   * Resolve a specific conflict.
   */
  resolveConflict(
    conflict: ToolConflict,
    strategy: ConflictResolutionStrategy
  ): void {
    this.resolvedConflicts.set(conflict.toolName, strategy);

    this.logger.info(`Resolved conflict for tool: ${conflict.toolName}`, {
      strategy: strategy.type,
    });
  }

  /**
   * Auto-resolve all conflicts using default strategies.
   */
  autoResolveConflicts(): Map<string, ConflictResolutionStrategy> {
    const conflicts = this.detectConflicts();
    const resolutions = new Map<string, ConflictResolutionStrategy>();

    for (const conflict of conflicts) {
      const strategy = conflict.suggestedResolution || {
        type: 'prefix' as const,
        serverPrefix: conflict.conflictingServers[0],
      };
      this.resolveConflict(conflict, strategy);
      resolutions.set(conflict.toolName, strategy);
    }

    return resolutions;
  }

  /**
   * Get resolved tool name based on conflict resolution.
   */
  getResolvedToolName(originalName: string, serverName: string): string {
    const resolution = this.resolvedConflicts.get(originalName);

    if (!resolution) {
      // No conflict or unresolved - use prefix strategy
      return `${serverName}__${originalName}`;
    }

    switch (resolution.type) {
      case 'prefix':
        return `${serverName}__${originalName}`;

      case 'namespace':
        return `${resolution.namespace}::${serverName}__${originalName}`;

      case 'priority':
        // Primary server doesn't need prefix
        if (serverName === resolution.primaryServer) {
          return originalName;
        }
        return `${serverName}__${originalName}`;

      case 'hide':
        // Hidden servers' tools are not exposed
        if (resolution.hiddenServers.includes(serverName)) {
          return ''; // Empty means hidden
        }
        return `${serverName}__${originalName}`;

      case 'version-select':
        // Would need version metadata to implement properly
        return `${serverName}__${originalName}`;

      case 'merge':
        // Return the merged tool name
        return originalName;

      default:
        return `${serverName}__${originalName}`;
    }
  }

  // ===== Context-Aware Tool Selection (Nexus-MCP Pattern) =====

  /**
   * Select relevant tools based on context.
   * Implements the Nexus-MCP pattern for TSI reduction.
   */
  selectTools(context: ToolSelectionContext): ToolSelectionResult {
    const allTools = this.getAllResolvedTools();

    if (allTools.length <= this.config.maxToolsToPresent) {
      // No selection needed - return all tools
      return {
        selectedTools: allTools.map((t) => t.tool),
        totalToolsAvailable: allTools.length,
        selectionMethod: 'categorical',
      };
    }

    // Apply selection strategies
    let selectedTools: ToolWithSource[] = [];

    // 1. Prioritize recently used tools
    if (context.recentTools && context.recentTools.length > 0) {
      const recentSet = new Set(context.recentTools);
      const recent = allTools.filter(
        (t) =>
          recentSet.has(t.prefixedName) || recentSet.has(t.originalName)
      );
      selectedTools.push(...recent);
    }

    // 2. Apply category prioritization
    if (context.priorityCategories && context.priorityCategories.length > 0) {
      const categorized = this.categorizeTools(
        allTools,
        context.priorityCategories
      );
      selectedTools.push(...categorized.slice(0, 10)); // Top 10 per category
    }

    // 3. Apply server prioritization
    if (context.priorityServers && context.priorityServers.length > 0) {
      const serverSet = new Set(context.priorityServers);
      const priorityServerTools = allTools.filter((t) =>
        serverSet.has(t.serverName)
      );
      selectedTools.push(...priorityServerTools);
    }

    // 4. Query-based selection (simple keyword matching)
    if (context.query) {
      const queryTerms = context.query.toLowerCase().split(/\s+/);
      const queryMatched = allTools.filter((t) => {
        const searchText = `${t.tool.name} ${t.tool.description || ''}`.toLowerCase();
        return queryTerms.some((term) => searchText.includes(term));
      });
      selectedTools.push(...queryMatched);
    }

    // 5. Add frequency-based selection
    const frequentTools = this.getFrequentlyUsedTools(10);
    selectedTools.push(...frequentTools);

    // Deduplicate and limit
    const uniqueTools = this.deduplicateTools(selectedTools);
    const limitedTools = uniqueTools.slice(0, context.maxTools);

    // Calculate confidence scores
    const confidenceScores = new Map<string, number>();
    for (const tool of limitedTools) {
      const score = this.calculateConfidence(tool, context);
      confidenceScores.set(tool.prefixedName, score);
    }

    // Sort by confidence
    limitedTools.sort((a, b) => {
      const scoreA = confidenceScores.get(a.prefixedName) || 0;
      const scoreB = confidenceScores.get(b.prefixedName) || 0;
      return scoreB - scoreA;
    });

    return {
      selectedTools: limitedTools.map((t) => ({
        ...t.tool,
        name: t.prefixedName, // Use resolved prefixed name
      })),
      totalToolsAvailable: allTools.length,
      selectionMethod: 'hybrid',
      confidenceScores,
      excludedTools: allTools
        .filter((t) => !limitedTools.includes(t))
        .slice(0, 10)
        .map((t) => ({
          tool: t.prefixedName,
          reason: 'Low relevance to current context',
        })),
    };
  }

  private getAllResolvedTools(): ToolWithSource[] {
    const result: ToolWithSource[] = [];
    const seen = new Set<string>();

    for (const toolList of this.tools.values()) {
      for (const tool of toolList) {
        const resolvedName = this.getResolvedToolName(
          tool.originalName,
          tool.serverName
        );

        // Skip hidden tools
        if (!resolvedName) continue;

        // Skip duplicates
        if (seen.has(resolvedName)) continue;
        seen.add(resolvedName);

        result.push({
          ...tool,
          prefixedName: resolvedName,
        });
      }
    }

    return result;
  }

  private categorizeTools(
    tools: ToolWithSource[],
    categories: string[]
  ): ToolWithSource[] {
    const result: ToolWithSource[] = [];
    const categorySet = new Set(categories.map((c) => c.toLowerCase()));

    for (const tool of tools) {
      const toolName = tool.originalName.toLowerCase();
      const description = (tool.tool.description || '').toLowerCase();

      // Simple category matching based on keywords
      const isMatch = Array.from(categorySet).some(
        (cat) => toolName.includes(cat) || description.includes(cat)
      );

      if (isMatch) {
        result.push(tool);
      }
    }

    return result;
  }

  private getFrequentlyUsedTools(limit: number): ToolWithSource[] {
    const sortedFrequency = Array.from(this.toolFrequency.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);

    const result: ToolWithSource[] = [];
    for (const freq of sortedFrequency) {
      const toolList = this.tools.get(freq.toolName);
      if (toolList && toolList.length > 0) {
        result.push(toolList[0]);
      }
    }

    return result;
  }

  private deduplicateTools(tools: ToolWithSource[]): ToolWithSource[] {
    const seen = new Set<string>();
    return tools.filter((t) => {
      if (seen.has(t.prefixedName)) return false;
      seen.add(t.prefixedName);
      return true;
    });
  }

  private calculateConfidence(
    tool: ToolWithSource,
    context: ToolSelectionContext
  ): number {
    let score = 0.5; // Base score

    // Boost for recent usage
    if (context.recentTools?.includes(tool.prefixedName)) {
      score += 0.3;
    }

    // Boost for priority server
    if (context.priorityServers?.includes(tool.serverName)) {
      score += 0.2;
    }

    // Boost for query match
    if (context.query) {
      const queryTerms = context.query.toLowerCase().split(/\s+/);
      const searchText = `${tool.tool.name} ${tool.tool.description || ''}`.toLowerCase();
      const matchCount = queryTerms.filter((term) =>
        searchText.includes(term)
      ).length;
      score += matchCount * 0.1;
    }

    // Boost for frequency
    const freq = this.toolFrequency.get(tool.prefixedName);
    if (freq) {
      score += Math.min(freq.usageCount / 100, 0.2);
    }

    return Math.min(score, 1.0);
  }

  // ===== Tool Frequency Tracking =====

  /**
   * Record tool usage for frequency-based selection.
   */
  recordToolUsage(
    toolName: string,
    executionTime?: number,
    success?: boolean
  ): void {
    const existing = this.toolFrequency.get(toolName) || {
      toolName,
      usageCount: 0,
      lastUsed: new Date(),
      avgExecutionTime: 0,
      successRate: 1,
    };

    existing.usageCount++;
    existing.lastUsed = new Date();

    if (executionTime !== undefined) {
      const prevTotal = existing.avgExecutionTime! * (existing.usageCount - 1);
      existing.avgExecutionTime = (prevTotal + executionTime) / existing.usageCount;
    }

    if (success !== undefined) {
      const prevSuccessCount = existing.successRate! * (existing.usageCount - 1);
      existing.successRate = (prevSuccessCount + (success ? 1 : 0)) / existing.usageCount;
    }

    this.toolFrequency.set(toolName, existing);
  }

  // ===== Visibility Overrides =====

  /**
   * Add a visibility override.
   */
  addVisibilityOverride(override: ToolVisibilityOverride): void {
    this.visibilityOverrides.push(override);
  }

  /**
   * Apply visibility overrides to a tool list.
   */
  applyVisibilityOverrides(
    tools: Tool[],
    context: { role?: string; contextType?: string }
  ): Tool[] {
    return tools.filter((tool) => {
      for (const override of this.visibilityOverrides) {
        if (!this.matchesPattern(tool.name, override.pattern)) {
          continue;
        }

        // Check conditions
        if (override.condition) {
          if (
            override.condition.roles &&
            context.role &&
            !override.condition.roles.includes(context.role)
          ) {
            continue;
          }
          if (
            override.condition.contexts &&
            context.contextType &&
            !override.condition.contexts.includes(context.contextType)
          ) {
            continue;
          }
        }

        switch (override.action) {
          case 'hide':
            return false;
          case 'show':
            return true;
          case 'rename':
            if (override.newName) {
              tool.name = override.newName;
            }
            return true;
        }
      }

      return true; // Default: show
    });
  }

  // ===== Namespace Management =====

  /**
   * Get tools in a specific namespace.
   */
  getToolsInNamespace(namespace: string): ToolWithSource[] {
    const namespaceConfig = this.config.namespaces?.namespaces.find(
      (n) => n.id === namespace
    );

    if (!namespaceConfig) {
      return [];
    }

    const serverSet = new Set(namespaceConfig.servers);
    return this.getAllResolvedTools().filter((t) =>
      serverSet.has(t.serverName)
    );
  }

  /**
   * Get all namespace IDs.
   */
  getNamespaces(): string[] {
    return this.config.namespaces?.namespaces.map((n) => n.id) || [];
  }

  // ===== Statistics =====

  /**
   * Get conflict statistics.
   */
  getStats(): {
    totalTools: number;
    uniqueToolNames: number;
    conflictCount: number;
    resolvedConflicts: number;
    toolsByServer: Record<string, number>;
  } {
    const conflicts = this.detectConflicts();
    const toolsByServer: Record<string, number> = {};

    for (const toolList of this.tools.values()) {
      for (const tool of toolList) {
        toolsByServer[tool.serverName] =
          (toolsByServer[tool.serverName] || 0) + 1;
      }
    }

    return {
      totalTools: Array.from(this.tools.values()).reduce(
        (sum, list) => sum + list.length,
        0
      ),
      uniqueToolNames: this.tools.size,
      conflictCount: conflicts.length,
      resolvedConflicts: this.resolvedConflicts.size,
      toolsByServer,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a conflict resolver with default configuration.
 */
export function createConflictResolver(
  logger: Logger,
  config?: Partial<ConflictResolverConfig>
): ConflictResolver {
  return new ConflictResolver(logger, config);
}
