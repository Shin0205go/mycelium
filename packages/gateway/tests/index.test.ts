/**
 * Unit tests for @mycelium/gateway
 * Tests MCP gateway/proxy functionality
 */

import { describe, it, expect } from 'vitest';
import { GATEWAY_VERSION, TIMEOUTS, SERVER, StdioRouter } from '../src/index.js';
import type { UpstreamServerInfo, MCPServerConfig } from '../src/index.js';

describe('@mycelium/gateway', () => {
  describe('GATEWAY_VERSION', () => {
    it('should be defined', () => {
      expect(GATEWAY_VERSION).toBeDefined();
    });

    it('should be a semver string', () => {
      expect(GATEWAY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should be version 1.0.0', () => {
      expect(GATEWAY_VERSION).toBe('1.0.0');
    });
  });

  describe('Constants', () => {
    it('should export TIMEOUTS', () => {
      expect(TIMEOUTS).toBeDefined();
      expect(TIMEOUTS.UPSTREAM_REQUEST).toBe(60000);
      expect(TIMEOUTS.UPSTREAM_SERVER_INIT).toBe(30000);
      expect(TIMEOUTS.CONTEXT_ENRICHMENT).toBe(5000);
    });

    it('should export SERVER constants', () => {
      expect(SERVER).toBeDefined();
      expect(SERVER.DEFAULT_PORT).toBe(3000);
    });
  });

  describe('StdioRouter export', () => {
    it('should export StdioRouter class', () => {
      expect(StdioRouter).toBeDefined();
      expect(typeof StdioRouter).toBe('function');
    });

    it('should be instantiable with a logger', () => {
      const mockLogger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };

      const router = new StdioRouter(mockLogger);
      expect(router).toBeInstanceOf(StdioRouter);
    });
  });

  describe('Type exports', () => {
    it('should allow UpstreamServerInfo type usage', () => {
      const info: UpstreamServerInfo = {
        name: 'test',
        config: { command: 'node', args: [] },
        connected: false,
        buffer: '',
      };
      expect(info.name).toBe('test');
    });

    it('should allow MCPServerConfig type usage', () => {
      const config: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: { KEY: 'value' },
      };
      expect(config.command).toBe('node');
    });
  });
});
