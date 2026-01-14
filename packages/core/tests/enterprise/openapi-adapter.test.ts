// ============================================================================
// AEGIS Enterprise MCP - OpenAPI Adapter Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenAPIAdapter,
  VirtualServerManager,
  createOpenAPIAdapter,
  createVirtualServerManager,
  type HTTPClient,
  type HTTPResponse,
} from '../../src/virtual-server/openapi-adapter.js';
import type { Logger, VirtualServerConfig } from '@aegis/shared';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Mock OpenAPI spec
const mockOpenAPISpec = {
  openapi: '3.0.0',
  info: {
    title: 'Test API',
    version: '1.0.0',
    description: 'A test API',
  },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List all users',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer' },
          },
        ],
        responses: {
          '200': {
            description: 'Success',
            content: { 'application/json': { schema: { type: 'array' } } },
          },
        },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create a user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                },
                required: ['name', 'email'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created' },
        },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        summary: 'Get a user by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Success' },
        },
      },
      delete: {
        operationId: 'deleteUser',
        summary: 'Delete a user',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': { description: 'Deleted' },
        },
      },
    },
  },
};

// Create mock HTTP client
const createMockHTTPClient = (
  responses?: Map<string, HTTPResponse>
): HTTPClient => ({
  request: async (options) => {
    const key = `${options.method} ${options.url}`;

    if (responses?.has(key)) {
      return responses.get(key)!;
    }

    // Default: return spec for GET on spec URL
    if (options.url.includes('openapi') && options.method === 'GET') {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: mockOpenAPISpec,
      };
    }

    // Default success response
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: { success: true },
    };
  },
});

describe('OpenAPIAdapter', () => {
  let logger: Logger;
  let config: VirtualServerConfig;
  let httpClient: HTTPClient;
  let adapter: OpenAPIAdapter;

  beforeEach(() => {
    logger = createMockLogger();
    config = {
      name: 'test-api',
      openApiSpec: 'https://api.example.com/openapi.json',
      baseUrl: 'https://api.example.com',
    };
    httpClient = createMockHTTPClient();
  });

  describe('Initialization', () => {
    it('should load OpenAPI spec', async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should generate tools from operations', async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('test_api__listusers');
      expect(toolNames).toContain('test_api__createuser');
      expect(toolNames).toContain('test_api__getuser');
      expect(toolNames).toContain('test_api__deleteuser');
    });

    it('should use custom tool prefix', async () => {
      config.toolPrefix = 'custom';
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      expect(tools.every((t) => t.name.startsWith('custom__'))).toBe(true);
    });

    it('should include operation descriptions', async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      const listUsers = tools.find((t) => t.name.includes('listusers'));

      expect(listUsers?.description).toBe('List all users');
    });

    it('should generate input schema from parameters', async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      const getUser = tools.find((t) => t.name.includes('getuser'));

      expect(getUser?.inputSchema).toBeDefined();
      expect(getUser?.inputSchema.properties).toHaveProperty('id');
    });

    it('should generate input schema from request body', async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      const createUser = tools.find((t) => t.name.includes('createuser'));

      expect(createUser?.inputSchema).toBeDefined();
      expect(createUser?.inputSchema.properties).toHaveProperty('name');
      expect(createUser?.inputSchema.properties).toHaveProperty('email');
    });
  });

  describe('Include/Exclude Patterns', () => {
    it('should include only matching operations', async () => {
      config.includeOperations = ['*User', 'list*'];
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames.length).toBeGreaterThan(0);
      expect(toolNames.every((n) => n.includes('user') || n.includes('list'))).toBe(true);
    });

    it('should exclude matching operations', async () => {
      config.excludeOperations = ['delete*'];
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const tools = adapter.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames.some((n) => n.includes('delete'))).toBe(false);
    });
  });

  describe('Tool Execution', () => {
    beforeEach(async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();
    });

    it('should execute GET request', async () => {
      const result = await adapter.executeTool({
        toolName: 'test_api__listusers',
        arguments: { limit: 10 },
      });

      expect(result.success).toBe(true);
    });

    it('should execute GET with path parameters', async () => {
      const result = await adapter.executeTool({
        toolName: 'test_api__getuser',
        arguments: { id: '123' },
      });

      expect(result.success).toBe(true);
    });

    it('should execute POST with body', async () => {
      const result = await adapter.executeTool({
        toolName: 'test_api__createuser',
        arguments: { name: 'Test User', email: 'test@example.com' },
      });

      expect(result.success).toBe(true);
    });

    it('should return error for unknown tool', async () => {
      const result = await adapter.executeTool({
        toolName: 'unknown_tool',
        arguments: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool not found');
    });

    it('should handle HTTP errors', async () => {
      const errorClient = createMockHTTPClient(
        new Map([
          [
            'GET https://api.example.com/users',
            {
              status: 500,
              headers: {},
              data: { error: 'Internal Server Error' },
            },
          ],
        ])
      );

      adapter = createOpenAPIAdapter(logger, config, errorClient);
      await adapter.load();

      const result = await adapter.executeTool({
        toolName: 'test_api__listusers',
        arguments: {},
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });
  });

  describe('Authentication', () => {
    it('should add bearer token', async () => {
      config.auth = { type: 'bearer', tokenEnvVar: 'TEST_TOKEN' };
      process.env.TEST_TOKEN = 'test-token-123';

      const capturedHeaders: Record<string, string>[] = [];
      const authClient: HTTPClient = {
        request: async (options) => {
          if (options.headers) {
            capturedHeaders.push(options.headers);
          }
          if (options.url.includes('openapi')) {
            return { status: 200, headers: {}, data: mockOpenAPISpec };
          }
          return { status: 200, headers: {}, data: {} };
        },
      };

      adapter = createOpenAPIAdapter(logger, config, authClient);
      await adapter.load();
      await adapter.executeTool({
        toolName: 'test_api__listusers',
        arguments: {},
      });

      expect(capturedHeaders.some((h) => h['Authorization'] === 'Bearer test-token-123')).toBe(
        true
      );

      delete process.env.TEST_TOKEN;
    });

    it('should add API key header', async () => {
      config.auth = { type: 'api-key', tokenEnvVar: 'API_KEY', headerName: 'X-API-Key' };
      process.env.API_KEY = 'secret-key';

      const capturedHeaders: Record<string, string>[] = [];
      const authClient: HTTPClient = {
        request: async (options) => {
          if (options.headers) {
            capturedHeaders.push(options.headers);
          }
          if (options.url.includes('openapi')) {
            return { status: 200, headers: {}, data: mockOpenAPISpec };
          }
          return { status: 200, headers: {}, data: {} };
        },
      };

      adapter = createOpenAPIAdapter(logger, config, authClient);
      await adapter.load();
      await adapter.executeTool({
        toolName: 'test_api__listusers',
        arguments: {},
      });

      expect(capturedHeaders.some((h) => h['X-API-Key'] === 'secret-key')).toBe(true);

      delete process.env.API_KEY;
    });

    it('should use set auth token', async () => {
      config.auth = { type: 'bearer' };

      const capturedHeaders: Record<string, string>[] = [];
      const authClient: HTTPClient = {
        request: async (options) => {
          if (options.headers) {
            capturedHeaders.push(options.headers);
          }
          if (options.url.includes('openapi')) {
            return { status: 200, headers: {}, data: mockOpenAPISpec };
          }
          return { status: 200, headers: {}, data: {} };
        },
      };

      adapter = createOpenAPIAdapter(logger, config, authClient);
      await adapter.load();
      adapter.setAuthToken('my-custom-token');
      await adapter.executeTool({
        toolName: 'test_api__listusers',
        arguments: {},
      });

      expect(capturedHeaders.some((h) => h['Authorization'] === 'Bearer my-custom-token')).toBe(
        true
      );
    });
  });

  describe('Status', () => {
    it('should report active status after load', async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const status = adapter.getStatus();

      expect(status.active).toBe(true);
      expect(status.toolCount).toBeGreaterThan(0);
      expect(status.lastRefreshed).toBeDefined();
      expect(status.errors).toBeUndefined();
    });

    it('should report errors on failed load', async () => {
      const failingClient: HTTPClient = {
        request: async () => {
          throw new Error('Network error');
        },
      };

      adapter = createOpenAPIAdapter(logger, config, failingClient);

      await expect(adapter.load()).rejects.toThrow();

      const status = adapter.getStatus();
      expect(status.active).toBe(false);
      expect(status.errors).toBeDefined();
      expect(status.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('Refresh', () => {
    it('should refresh spec', async () => {
      adapter = createOpenAPIAdapter(logger, config, httpClient);
      await adapter.load();

      const initialTools = adapter.getTools().length;
      await adapter.refresh();

      expect(adapter.getTools().length).toBe(initialTools);
      expect(adapter.getStatus().lastRefreshed).toBeDefined();
    });
  });
});

describe('VirtualServerManager', () => {
  let logger: Logger;
  let manager: VirtualServerManager;
  let httpClient: HTTPClient;

  beforeEach(() => {
    logger = createMockLogger();
    manager = createVirtualServerManager(logger);
    httpClient = createMockHTTPClient();
  });

  describe('Server Management', () => {
    it('should add virtual server', async () => {
      await manager.addServer(
        {
          name: 'api1',
          openApiSpec: 'https://api1.example.com/openapi.json',
          baseUrl: 'https://api1.example.com',
        },
        httpClient
      );

      const status = manager.getStatus();
      expect(status.length).toBe(1);
      expect(status[0].name).toBe('api1');
    });

    it('should add multiple virtual servers', async () => {
      await manager.addServer(
        {
          name: 'api1',
          openApiSpec: 'https://api1.example.com/openapi.json',
          baseUrl: 'https://api1.example.com',
        },
        httpClient
      );

      await manager.addServer(
        {
          name: 'api2',
          openApiSpec: 'https://api2.example.com/openapi.json',
          baseUrl: 'https://api2.example.com',
        },
        httpClient
      );

      const status = manager.getStatus();
      expect(status.length).toBe(2);
    });

    it('should remove virtual server', async () => {
      await manager.addServer(
        {
          name: 'api1',
          openApiSpec: 'https://api1.example.com/openapi.json',
          baseUrl: 'https://api1.example.com',
        },
        httpClient
      );

      manager.removeServer('api1');

      const status = manager.getStatus();
      expect(status.length).toBe(0);
    });
  });

  describe('Tool Aggregation', () => {
    it('should get tools from all servers', async () => {
      await manager.addServer(
        {
          name: 'api1',
          openApiSpec: 'https://api1.example.com/openapi.json',
          baseUrl: 'https://api1.example.com',
        },
        httpClient
      );

      const tools = manager.getAllTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('Tool Execution', () => {
    it('should execute tool on appropriate server', async () => {
      await manager.addServer(
        {
          name: 'test-api',
          openApiSpec: 'https://api.example.com/openapi.json',
          baseUrl: 'https://api.example.com',
        },
        httpClient
      );

      const result = await manager.executeTool('test_api__listusers', {});

      expect(result.success).toBe(true);
    });

    it('should return error for unknown tool', async () => {
      const result = await manager.executeTool('unknown__tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Refresh', () => {
    it('should refresh all servers', async () => {
      await manager.addServer(
        {
          name: 'api1',
          openApiSpec: 'https://api1.example.com/openapi.json',
          baseUrl: 'https://api1.example.com',
        },
        httpClient
      );

      await expect(manager.refreshAll()).resolves.not.toThrow();
    });
  });
});
