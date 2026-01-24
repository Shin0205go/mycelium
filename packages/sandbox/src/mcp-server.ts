#!/usr/bin/env node
// ============================================================================
// Mycelium Sandbox MCP Server
// Provides secure code execution tools via Model Context Protocol
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createSandboxManager } from './sandbox-manager.js';
import type { SandboxProfile, SandboxConfig } from './types.js';
import { SANDBOX_PROFILES } from './types.js';

// Get working directory from args or environment
const workingDirectory = process.argv[2] || process.env.MYCELIUM_SANDBOX_DIR || process.cwd();

console.error(`Mycelium Sandbox Server starting...`);
console.error(`Working directory: ${workingDirectory}`);

// Create sandbox manager
const sandboxManager = createSandboxManager();

// Create MCP Server
const server = new Server(
  {
    name: 'mycelium-sandbox',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// Tool Definitions
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'sandbox_exec',
        description: 'Execute a command in a sandboxed environment with OS-level isolation. Supports filesystem, network, and process restrictions.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Command to execute',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command arguments',
            },
            profile: {
              type: 'string',
              enum: ['strict', 'standard', 'permissive'],
              description: 'Sandbox profile (default: standard)',
            },
            workingDirectory: {
              type: 'string',
              description: 'Working directory for execution',
            },
            stdin: {
              type: 'string',
              description: 'Standard input to pass to the command',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in seconds (default: 60)',
            },
            allowNetwork: {
              type: 'boolean',
              description: 'Allow network access (default: false)',
            },
            readPaths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional paths with read access',
            },
            writePaths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional paths with write access',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'sandbox_exec_script',
        description: 'Execute a script file in a sandboxed environment. Automatically detects script type from extension.',
        inputSchema: {
          type: 'object',
          properties: {
            scriptPath: {
              type: 'string',
              description: 'Path to the script file',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Script arguments',
            },
            profile: {
              type: 'string',
              enum: ['strict', 'standard', 'permissive'],
              description: 'Sandbox profile (default: standard)',
            },
            stdin: {
              type: 'string',
              description: 'Standard input to pass to the script',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in seconds (default: 60)',
            },
          },
          required: ['scriptPath'],
        },
      },
      {
        name: 'bash',
        description: 'Execute a bash command. Commands run through the sandbox for security. Use this for shell commands, git operations, npm/yarn commands, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The bash command to execute',
            },
            workingDirectory: {
              type: 'string',
              description: 'Working directory for the command',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 120000)',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'sandbox_capabilities',
        description: 'Get sandbox capabilities for the current platform',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'sandbox_profiles',
        description: 'List available sandbox profiles and their configurations',
        inputSchema: {
          type: 'object',
          properties: {
            profile: {
              type: 'string',
              enum: ['strict', 'standard', 'permissive'],
              description: 'Get details for a specific profile',
            },
          },
        },
      },
    ],
  };
});

// ============================================================================
// Tool Handlers
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'sandbox_exec': {
        const {
          command,
          args: cmdArgs = [],
          profile = 'standard',
          workingDirectory: cwd,
          stdin,
          timeout,
          allowNetwork,
          readPaths = [],
          writePaths = [],
        } = (args || {}) as {
          command: string;
          args?: string[];
          profile?: SandboxProfile;
          workingDirectory?: string;
          stdin?: string;
          timeout?: number;
          allowNetwork?: boolean;
          readPaths?: string[];
          writePaths?: string[];
        };

        // Build custom config overrides
        const overrides: Partial<SandboxConfig> = {
          workingDirectory: cwd || workingDirectory,
        };

        if (timeout) {
          overrides.process = {
            ...SANDBOX_PROFILES[profile].process,
            timeoutSeconds: timeout,
          } as SandboxConfig['process'];
        }

        if (allowNetwork !== undefined) {
          overrides.network = {
            ...SANDBOX_PROFILES[profile].network,
            allowOutbound: allowNetwork,
            allowDns: allowNetwork,
          } as SandboxConfig['network'];
        }

        if (readPaths.length > 0 || writePaths.length > 0) {
          overrides.filesystem = {
            readPaths: [...(SANDBOX_PROFILES[profile].filesystem?.readPaths || []), ...readPaths],
            writePaths: [...(SANDBOX_PROFILES[profile].filesystem?.writePaths || []), ...writePaths],
          };
        }

        const result = await sandboxManager.executeWithProfile(
          command,
          cmdArgs,
          profile,
          overrides,
          stdin
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                durationMs: result.durationMs,
                timedOut: result.timedOut,
                memoryExceeded: result.memoryExceeded,
                violations: result.violations,
              }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case 'sandbox_exec_script': {
        const {
          scriptPath,
          args: scriptArgs = [],
          profile = 'standard',
          stdin,
          timeout,
        } = (args || {}) as {
          scriptPath: string;
          args?: string[];
          profile?: SandboxProfile;
          stdin?: string;
          timeout?: number;
        };

        // Detect script type from extension
        const ext = scriptPath.split('.').pop()?.toLowerCase();
        let command: string;
        let cmdArgs: string[];

        switch (ext) {
          case 'py':
            command = 'python3';
            cmdArgs = [scriptPath, ...scriptArgs];
            break;
          case 'sh':
            command = 'bash';
            cmdArgs = [scriptPath, ...scriptArgs];
            break;
          case 'js':
            command = 'node';
            cmdArgs = [scriptPath, ...scriptArgs];
            break;
          case 'ts':
            command = 'npx';
            cmdArgs = ['tsx', scriptPath, ...scriptArgs];
            break;
          case 'rb':
            command = 'ruby';
            cmdArgs = [scriptPath, ...scriptArgs];
            break;
          default:
            // Try to execute directly
            command = scriptPath;
            cmdArgs = scriptArgs;
        }

        const overrides: Partial<SandboxConfig> = {
          workingDirectory,
        };

        if (timeout) {
          overrides.process = {
            ...SANDBOX_PROFILES[profile].process,
            timeoutSeconds: timeout,
          } as SandboxConfig['process'];
        }

        // Add script directory to read paths
        const scriptDir = scriptPath.substring(0, scriptPath.lastIndexOf('/'));
        overrides.filesystem = {
          readPaths: [...(SANDBOX_PROFILES[profile].filesystem?.readPaths || []), scriptDir || '.'],
          writePaths: SANDBOX_PROFILES[profile].filesystem?.writePaths || [],
        };

        const result = await sandboxManager.executeWithProfile(
          command,
          cmdArgs,
          profile,
          overrides,
          stdin
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                durationMs: result.durationMs,
                timedOut: result.timedOut,
                violations: result.violations,
              }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case 'bash': {
        const {
          command: bashCommand,
          workingDirectory: cwd,
          timeout = 120000,
        } = (args || {}) as {
          command: string;
          workingDirectory?: string;
          timeout?: number;
        };

        // Use permissive profile for bash - similar to normal shell usage
        // but still with sandbox protection (no API keys leaked, etc.)
        const overrides: Partial<SandboxConfig> = {
          workingDirectory: cwd || workingDirectory,
          process: {
            ...SANDBOX_PROFILES.permissive.process,
            timeoutSeconds: Math.ceil(timeout / 1000),
          } as SandboxConfig['process'],
        };

        const result = await sandboxManager.executeWithProfile(
          'bash',
          ['-c', bashCommand],
          'permissive',
          overrides,
          undefined
        );

        // Format output similar to Claude's built-in Bash tool
        let output = '';
        if (result.stdout) {
          output += result.stdout;
        }
        if (result.stderr) {
          if (output && !output.endsWith('\n')) output += '\n';
          output += result.stderr;
        }

        if (result.timedOut) {
          output += `\n[Command timed out after ${timeout}ms]`;
        }

        return {
          content: [
            {
              type: 'text',
              text: output || `(exit code: ${result.exitCode})`,
            },
          ],
          isError: result.exitCode !== 0,
        };
      }

      case 'sandbox_capabilities': {
        const capabilities = sandboxManager.getCapabilities();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                platform: capabilities.platform,
                available: capabilities.available,
                features: capabilities.features,
                executor: capabilities.tool,
                workingDirectory,
              }, null, 2),
            },
          ],
        };
      }

      case 'sandbox_profiles': {
        const { profile } = (args || {}) as { profile?: SandboxProfile };

        if (profile) {
          const profileConfig = SANDBOX_PROFILES[profile];
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  profile,
                  config: profileConfig,
                }, null, 2),
              },
            ],
          };
        }

        // Return all profiles summary
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                profiles: {
                  strict: {
                    description: 'Minimal permissions, no network, limited filesystem',
                    network: 'none',
                    timeout: SANDBOX_PROFILES.strict.process?.timeoutSeconds,
                    memory: SANDBOX_PROFILES.strict.process?.maxMemoryMB,
                  },
                  standard: {
                    description: 'Balanced security with reasonable defaults',
                    network: 'localhost only',
                    timeout: SANDBOX_PROFILES.standard.process?.timeoutSeconds,
                    memory: SANDBOX_PROFILES.standard.process?.maxMemoryMB,
                  },
                  permissive: {
                    description: 'More relaxed for trusted code',
                    network: 'full',
                    timeout: SANDBOX_PROFILES.permissive.process?.timeoutSeconds,
                    memory: SANDBOX_PROFILES.permissive.process?.maxMemoryMB,
                  },
                },
              }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// ============================================================================
// Server Initialization
// ============================================================================

async function main() {
  // Initialize sandbox manager
  await sandboxManager.initialize();

  const capabilities = sandboxManager.getCapabilities();
  console.error(`Sandbox capabilities: ${JSON.stringify(capabilities)}`);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Mycelium Sandbox Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
