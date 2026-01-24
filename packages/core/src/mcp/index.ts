// ============================================================================
// MYCELIUM Router - MCP Module Exports
// ============================================================================

// Re-export StdioRouter from @mycelium/gateway for backward compatibility
export { StdioRouter, type UpstreamServerInfo } from '@mycelium/gateway';

export * from './tool-discovery.js';
export * from './dynamic-tool-discovery.js';
