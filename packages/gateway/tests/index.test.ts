/**
 * Unit tests for @aegis/gateway
 * Tests MCP gateway/proxy constants
 */

import { describe, it, expect } from 'vitest';
import { GATEWAY_VERSION } from '../src/index.js';

describe('@aegis/gateway', () => {
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

  describe('Future exports (placeholder)', () => {
    it('should document planned StdioRouter export', () => {
      // StdioRouter will be migrated from @aegis/router
      // Expected interface:
      // - addServerFromConfig(name: string, config: MCPServerConfig): void
      // - loadServersFromDesktopConfig(config: object): void
      // - startServers(): Promise<void>
      // - stopServers(): Promise<void>
      // - isServerConnected(name: string): boolean
      // - getAvailableServers(): UpstreamServerInfo[]
      expect(true).toBe(true);
    });

    it('should document planned UpstreamServerInfo export', () => {
      // UpstreamServerInfo type:
      // - name: string
      // - connected: boolean
      // - tools: Tool[]
      // - lastError?: string
      expect(true).toBe(true);
    });

    it('should document planned MCPServerConfig export', () => {
      // MCPServerConfig type:
      // - command: string
      // - args: string[]
      // - env?: Record<string, string>
      // - cwd?: string
      expect(true).toBe(true);
    });
  });
});
