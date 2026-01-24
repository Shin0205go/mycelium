// ============================================================================
// AEGIS Gateway - MCP Proxy Layer
// Manages connections to upstream MCP servers
// ============================================================================

export const GATEWAY_VERSION = '1.0.0';

// Re-export StdioRouter and related types
export { StdioRouter, type UpstreamServerInfo } from './stdio-router.js';

// Re-export constants
export { TIMEOUTS, SERVER } from './constants.js';

// Re-export shared types for convenience
export type { MCPServerConfig, DesktopConfig } from '@mycelium/shared';
