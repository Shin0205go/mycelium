// ============================================================================
// AEGIS Enterprise MCP - Virtual MCP Server from OpenAPI
// Automatically exposes REST APIs as MCP tools
// Based on: "自社管理型MCPエコシステムの構築" Technical Report
// ============================================================================

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  Logger,
  VirtualServerConfig,
  VirtualServerStatus,
  OpenAPIToolMapping,
} from '@aegis/shared';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Simplified OpenAPI Schema types.
 */
interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
  parameters?: ParameterObject[];
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBody;
  responses?: Record<string, ResponseObject>;
  tags?: string[];
  security?: SecurityRequirement[];
}

interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

interface RequestBody {
  required?: boolean;
  content?: Record<string, { schema?: SchemaObject }>;
}

interface ResponseObject {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  description?: string;
  enum?: unknown[];
  format?: string;
  $ref?: string;
}

interface SecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

type SecurityRequirement = Record<string, string[]>;

/**
 * Tool execution request.
 */
export interface ToolExecutionRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool execution result.
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  statusCode?: number;
  headers?: Record<string, string>;
}

/**
 * HTTP client interface for making requests.
 */
export interface HTTPClient {
  request(options: HTTPRequestOptions): Promise<HTTPResponse>;
}

interface HTTPRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

interface HTTPResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

// ============================================================================
// OpenAPI Adapter Implementation
// ============================================================================

/**
 * Adapts OpenAPI specifications to MCP tools.
 * Allows REST APIs to be called as MCP tools without custom server code.
 */
export class OpenAPIAdapter extends EventEmitter {
  private logger: Logger;
  private config: VirtualServerConfig;
  private spec?: OpenAPISpec;
  private tools: Map<string, OpenAPIToolMapping> = new Map();
  private httpClient: HTTPClient;
  private authToken?: string;
  private lastRefreshed?: Date;
  private errors: string[] = [];

  constructor(
    logger: Logger,
    config: VirtualServerConfig,
    httpClient?: HTTPClient
  ) {
    super();
    this.logger = logger;
    this.config = config;
    this.httpClient = httpClient || this.createDefaultHTTPClient();
  }

  // ===== Initialization =====

  /**
   * Load and parse the OpenAPI specification.
   */
  async load(): Promise<void> {
    try {
      this.logger.info(`Loading OpenAPI spec: ${this.config.openApiSpec}`);

      // Fetch the spec
      const specContent = await this.fetchSpec();

      // Parse the spec
      this.spec = this.parseSpec(specContent);

      // Generate tools from paths
      this.generateTools();

      this.lastRefreshed = new Date();
      this.errors = [];

      this.logger.info(`Loaded ${this.tools.size} tools from OpenAPI spec`, {
        serverName: this.config.name,
        title: this.spec.info.title,
        version: this.spec.info.version,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.errors.push(errorMessage);
      this.logger.error(`Failed to load OpenAPI spec: ${errorMessage}`);
      throw error;
    }
  }

  private async fetchSpec(): Promise<string> {
    const specPath = this.config.openApiSpec;

    // Check if it's a URL or file path
    if (specPath.startsWith('http://') || specPath.startsWith('https://')) {
      const response = await this.httpClient.request({
        method: 'GET',
        url: specPath,
        timeout: this.config.timeoutMs || 30000,
      });
      return typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
    } else {
      // File path - use fs (dynamic import for ESM compatibility)
      const fs = await import('fs/promises');
      return await fs.readFile(specPath, 'utf-8');
    }
  }

  private parseSpec(content: string): OpenAPISpec {
    try {
      // Try JSON first
      return JSON.parse(content);
    } catch {
      // Try YAML (simplified parsing)
      throw new Error('YAML parsing not implemented - please provide JSON OpenAPI spec');
    }
  }

  private generateTools(): void {
    if (!this.spec) return;

    const prefix = this.config.toolPrefix || this.sanitizeName(this.spec.info.title);

    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      const methods: Array<{ method: string; operation?: Operation }> = [
        { method: 'get', operation: pathItem.get },
        { method: 'post', operation: pathItem.post },
        { method: 'put', operation: pathItem.put },
        { method: 'patch', operation: pathItem.patch },
        { method: 'delete', operation: pathItem.delete },
      ];

      for (const { method, operation } of methods) {
        if (!operation) continue;

        // Check include/exclude patterns
        const operationId = operation.operationId || this.generateOperationId(method, path);
        if (!this.shouldIncludeOperation(operationId)) continue;

        const toolMapping = this.createToolMapping(
          prefix,
          path,
          method as 'get' | 'post' | 'put' | 'patch' | 'delete',
          operation,
          pathItem.parameters
        );

        this.tools.set(toolMapping.toolName, toolMapping);
      }
    }
  }

  private shouldIncludeOperation(operationId: string): boolean {
    // Check exclude patterns first
    if (this.config.excludeOperations) {
      for (const pattern of this.config.excludeOperations) {
        if (this.matchesGlob(operationId, pattern)) {
          return false;
        }
      }
    }

    // Check include patterns
    if (this.config.includeOperations && this.config.includeOperations.length > 0) {
      for (const pattern of this.config.includeOperations) {
        if (this.matchesGlob(operationId, pattern)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  private matchesGlob(value: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(value);
  }

  private createToolMapping(
    prefix: string,
    path: string,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    operation: Operation,
    pathParameters?: ParameterObject[]
  ): OpenAPIToolMapping {
    const operationId = operation.operationId || this.generateOperationId(method, path);
    const toolName = `${prefix}__${this.sanitizeName(operationId)}`;

    // Combine path and operation parameters
    const allParameters = [
      ...(pathParameters || []),
      ...(operation.parameters || []),
    ];

    // Build input schema
    const inputSchema = this.buildInputSchema(allParameters, operation.requestBody);

    const description =
      operation.summary ||
      operation.description ||
      `${method.toUpperCase()} ${path}`;

    return {
      operationId,
      method,
      path,
      toolName,
      description,
      inputSchema,
      responseMapping: this.buildResponseMapping(operation.responses),
    };
  }

  private generateOperationId(method: string, path: string): string {
    // Generate operation ID from method and path
    // e.g., GET /users/{id} -> getUsers_id
    const cleanPath = path
      .replace(/\{(\w+)\}/g, '$1')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    return `${method}${cleanPath.charAt(0).toUpperCase()}${cleanPath.slice(1)}`;
  }

  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private buildInputSchema(
    parameters: ParameterObject[],
    requestBody?: RequestBody
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    // Add parameters
    for (const param of parameters) {
      properties[param.name] = this.convertSchemaToJsonSchema(param.schema, param.description);
      if (param.required) {
        required.push(param.name);
      }
    }

    // Add request body
    if (requestBody) {
      const jsonContent = requestBody.content?.['application/json'];
      if (jsonContent?.schema) {
        // Inline the body schema properties
        const bodySchema = this.convertSchemaToJsonSchema(jsonContent.schema);
        if (bodySchema && typeof bodySchema === 'object' && 'properties' in bodySchema) {
          Object.assign(properties, (bodySchema as { properties: Record<string, unknown> }).properties);
          if (requestBody.required && bodySchema && 'required' in bodySchema) {
            required.push(...((bodySchema as { required: string[] }).required || []));
          }
        } else {
          // Wrap as 'body' parameter
          properties['body'] = bodySchema;
          if (requestBody.required) {
            required.push('body');
          }
        }
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  private convertSchemaToJsonSchema(
    schema?: SchemaObject,
    description?: string
  ): Record<string, unknown> {
    if (!schema) {
      return { type: 'string', description };
    }

    // Handle $ref
    if (schema.$ref) {
      const refName = schema.$ref.split('/').pop();
      const refSchema = this.spec?.components?.schemas?.[refName!];
      if (refSchema) {
        return this.convertSchemaToJsonSchema(refSchema, description);
      }
      return { type: 'object', description };
    }

    const result: Record<string, unknown> = {};

    if (schema.type) {
      result.type = schema.type;
    }

    if (description || schema.description) {
      result.description = description || schema.description;
    }

    if (schema.enum) {
      result.enum = schema.enum;
    }

    if (schema.format) {
      result.format = schema.format;
    }

    if (schema.type === 'object' && schema.properties) {
      result.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        (result.properties as Record<string, unknown>)[key] = this.convertSchemaToJsonSchema(value);
      }
      if (schema.required) {
        result.required = schema.required;
      }
    }

    if (schema.type === 'array' && schema.items) {
      result.items = this.convertSchemaToJsonSchema(schema.items);
    }

    return result;
  }

  private buildResponseMapping(
    responses?: Record<string, ResponseObject>
  ): OpenAPIToolMapping['responseMapping'] {
    if (!responses) return undefined;

    // Use 200 or first 2xx response
    const successResponse = responses['200'] || responses['201'] ||
      Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];

    if (!successResponse?.content) return undefined;

    const jsonContent = successResponse.content['application/json'];
    if (!jsonContent) return undefined;

    return {
      contentType: 'application/json',
    };
  }

  // ===== Tool Access =====

  /**
   * Get all available tools as MCP Tool format.
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values()).map((mapping) => ({
      name: mapping.toolName,
      description: mapping.description,
      inputSchema: mapping.inputSchema as Tool['inputSchema'],
    }));
  }

  /**
   * Get tool mapping by name.
   */
  getToolMapping(toolName: string): OpenAPIToolMapping | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Execute a tool.
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const mapping = this.tools.get(request.toolName);
    if (!mapping) {
      return {
        success: false,
        error: `Tool not found: ${request.toolName}`,
      };
    }

    try {
      // Build URL with path parameters
      let url = this.buildUrl(mapping.path, request.arguments);

      // Add query parameters for GET requests
      if (mapping.method === 'get') {
        url = this.addQueryParams(url, mapping, request.arguments);
      }

      // Build headers
      const headers = this.buildHeaders();

      // Build body for non-GET requests
      let body: unknown;
      if (mapping.method !== 'get') {
        body = this.buildBody(mapping, request.arguments);
      }

      // Execute request
      const response = await this.httpClient.request({
        method: mapping.method.toUpperCase(),
        url,
        headers,
        body,
        timeout: this.config.timeoutMs || 30000,
      });

      // Handle response
      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          data: response.data,
          statusCode: response.status,
          headers: response.headers,
        };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${JSON.stringify(response.data)}`,
          statusCode: response.status,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildUrl(pathTemplate: string, args: Record<string, unknown>): string {
    let url = `${this.config.baseUrl}${pathTemplate}`;

    // Replace path parameters
    const pathParams = pathTemplate.match(/\{(\w+)\}/g) || [];
    for (const param of pathParams) {
      const paramName = param.slice(1, -1);
      const value = args[paramName];
      if (value !== undefined) {
        url = url.replace(param, encodeURIComponent(String(value)));
      }
    }

    return url;
  }

  private addQueryParams(
    url: string,
    mapping: OpenAPIToolMapping,
    args: Record<string, unknown>
  ): string {
    const queryParams: string[] = [];
    const pathParams = mapping.path.match(/\{(\w+)\}/g)?.map((p) => p.slice(1, -1)) || [];

    for (const [key, value] of Object.entries(args)) {
      if (!pathParams.includes(key) && value !== undefined) {
        queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }

    if (queryParams.length > 0) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}${queryParams.join('&')}`;
    }

    return url;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.config.headers,
    };

    // Add authentication
    if (this.config.auth) {
      switch (this.config.auth.type) {
        case 'bearer':
          const token = this.getAuthToken();
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          break;
        case 'api-key':
          const apiKey = this.getAuthToken();
          if (apiKey && this.config.auth.headerName) {
            headers[this.config.auth.headerName] = apiKey;
          }
          break;
        case 'basic':
          const basicAuth = this.getAuthToken();
          if (basicAuth) {
            headers['Authorization'] = `Basic ${basicAuth}`;
          }
          break;
      }
    }

    return headers;
  }

  private getAuthToken(): string | undefined {
    if (this.authToken) {
      return this.authToken;
    }

    if (this.config.auth?.tokenEnvVar) {
      return process.env[this.config.auth.tokenEnvVar];
    }

    return undefined;
  }

  /**
   * Set authentication token.
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  private buildBody(
    mapping: OpenAPIToolMapping,
    args: Record<string, unknown>
  ): unknown {
    const pathParams = mapping.path.match(/\{(\w+)\}/g)?.map((p) => p.slice(1, -1)) || [];

    // If there's a 'body' argument, use it directly
    if (args.body !== undefined) {
      return args.body;
    }

    // Otherwise, create body from non-path parameters
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (!pathParams.includes(key) && value !== undefined) {
        body[key] = value;
      }
    }

    return Object.keys(body).length > 0 ? body : undefined;
  }

  // ===== Status =====

  /**
   * Get server status.
   */
  getStatus(): VirtualServerStatus {
    return {
      name: this.config.name,
      active: this.spec !== undefined && this.errors.length === 0,
      toolCount: this.tools.size,
      lastRefreshed: this.lastRefreshed,
      errors: this.errors.length > 0 ? this.errors : undefined,
    };
  }

  /**
   * Refresh the OpenAPI spec.
   */
  async refresh(): Promise<void> {
    this.tools.clear();
    this.spec = undefined;
    await this.load();
  }

  // ===== Default HTTP Client =====

  private createDefaultHTTPClient(): HTTPClient {
    return {
      request: async (options: HTTPRequestOptions): Promise<HTTPResponse> => {
        // Use native fetch if available
        if (typeof fetch !== 'undefined') {
          const response = await fetch(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
          });

          const contentType = response.headers.get('content-type') || '';
          let data: unknown;

          if (contentType.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });

          return {
            status: response.status,
            headers,
            data,
          };
        }

        // Fallback to node-fetch or http module
        throw new Error('No HTTP client available - please provide a custom HTTPClient');
      },
    };
  }
}

// ============================================================================
// Virtual Server Manager
// ============================================================================

/**
 * Manages multiple virtual MCP servers from OpenAPI specs.
 */
export class VirtualServerManager {
  private logger: Logger;
  private adapters: Map<string, OpenAPIAdapter> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Add a virtual server.
   */
  async addServer(config: VirtualServerConfig, httpClient?: HTTPClient): Promise<void> {
    const adapter = new OpenAPIAdapter(this.logger, config, httpClient);
    await adapter.load();
    this.adapters.set(config.name, adapter);
  }

  /**
   * Remove a virtual server.
   */
  removeServer(name: string): void {
    this.adapters.delete(name);
  }

  /**
   * Get all tools from all virtual servers.
   */
  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const adapter of this.adapters.values()) {
      tools.push(...adapter.getTools());
    }
    return tools;
  }

  /**
   * Execute a tool on the appropriate virtual server.
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    for (const adapter of this.adapters.values()) {
      const mapping = adapter.getToolMapping(toolName);
      if (mapping) {
        return adapter.executeTool({ toolName, arguments: args });
      }
    }

    return {
      success: false,
      error: `Tool not found in any virtual server: ${toolName}`,
    };
  }

  /**
   * Get status of all virtual servers.
   */
  getStatus(): VirtualServerStatus[] {
    return Array.from(this.adapters.values()).map((a) => a.getStatus());
  }

  /**
   * Refresh all virtual servers.
   */
  async refreshAll(): Promise<void> {
    const promises = Array.from(this.adapters.values()).map((a) => a.refresh());
    await Promise.all(promises);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an OpenAPI adapter.
 */
export function createOpenAPIAdapter(
  logger: Logger,
  config: VirtualServerConfig,
  httpClient?: HTTPClient
): OpenAPIAdapter {
  return new OpenAPIAdapter(logger, config, httpClient);
}

/**
 * Create a virtual server manager.
 */
export function createVirtualServerManager(logger: Logger): VirtualServerManager {
  return new VirtualServerManager(logger);
}
