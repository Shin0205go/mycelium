#!/usr/bin/env node
// ============================================================================
// Mycelium Session MCP Server
// Provides session management tools via Model Context Protocol
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SessionStore, createSessionStore } from './session-store.js';
import type { CompressionStrategy, ExportFormat } from './types.js';

// Get session directory from args or environment
const sessionDir = process.argv[2] || process.env.MYCELIUM_SESSION_DIR || './sessions';

console.error(`Mycelium Session Server starting...`);
console.error(`Session directory: ${sessionDir}`);

// Create session store
const sessionStore = createSessionStore(sessionDir);

// Create MCP Server
const server = new Server(
  {
    name: 'mycelium-session',
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
        name: 'session_save',
        description: 'Save or create a new session. Use to persist the current conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Optional name for the session',
            },
            roleId: {
              type: 'string',
              description: 'Role ID for the session (required for new sessions)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags for organization',
            },
          },
        },
      },
      {
        name: 'session_list',
        description: 'List all saved sessions with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            roleId: {
              type: 'string',
              description: 'Filter by role ID',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags (any match)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 20)',
            },
          },
        },
      },
      {
        name: 'session_load',
        description: 'Load a session by ID to resume the conversation',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to load',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'session_delete',
        description: 'Delete a saved session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to delete',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'session_compress',
        description: 'Compress a session to reduce context size. Useful for long conversations.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to compress',
            },
            strategy: {
              type: 'string',
              enum: ['summarize', 'truncate', 'sliding-window'],
              description: 'Compression strategy (default: summarize)',
            },
            keepRecentMessages: {
              type: 'number',
              description: 'Number of recent messages to keep uncompressed (default: 10)',
            },
            targetTokens: {
              type: 'number',
              description: 'Target token count for sliding-window strategy',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'session_fork',
        description: 'Create a fork (copy) of a session from a specific point',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to fork',
            },
            fromMessageIndex: {
              type: 'number',
              description: 'Message index to fork from (default: end of session)',
            },
            name: {
              type: 'string',
              description: 'Name for the forked session',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'session_export',
        description: 'Export a session to various formats (markdown, json, html)',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to export',
            },
            format: {
              type: 'string',
              enum: ['markdown', 'json', 'html'],
              description: 'Export format (default: markdown)',
            },
            includeToolCalls: {
              type: 'boolean',
              description: 'Include tool call details (default: false)',
            },
            includeThinking: {
              type: 'boolean',
              description: 'Include thinking signatures (default: false)',
            },
            includeMetadata: {
              type: 'boolean',
              description: 'Include session metadata (default: true)',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'session_rename',
        description: 'Rename a session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to rename',
            },
            name: {
              type: 'string',
              description: 'New name for the session',
            },
          },
          required: ['sessionId', 'name'],
        },
      },
      {
        name: 'session_add_tags',
        description: 'Add tags to a session for organization',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to add',
            },
          },
          required: ['sessionId', 'tags'],
        },
      },
      {
        name: 'session_add_message',
        description: 'Add a message to an existing session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID',
            },
            role: {
              type: 'string',
              enum: ['user', 'assistant', 'system'],
              description: 'Message role',
            },
            content: {
              type: 'string',
              description: 'Message content',
            },
          },
          required: ['sessionId', 'role', 'content'],
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
      case 'session_save': {
        const { name: sessionName, roleId, tags } = (args || {}) as {
          name?: string;
          roleId?: string;
          tags?: string[];
        };

        if (!roleId) {
          return {
            content: [{ type: 'text', text: 'Error: roleId is required for new sessions' }],
            isError: true,
          };
        }

        const session = await sessionStore.create(roleId, sessionName, tags);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionId: session.id,
                name: session.name,
                roleId: session.roleId,
                message: `Session created: ${session.name || session.id}`,
              }, null, 2),
            },
          ],
        };
      }

      case 'session_list': {
        const { roleId, tags, limit = 20 } = (args || {}) as {
          roleId?: string;
          tags?: string[];
          limit?: number;
        };

        const sessions = await sessionStore.list({ roleId, tags, limit });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sessions: sessions.map(s => ({
                  id: s.id,
                  name: s.name,
                  roleId: s.roleId,
                  messageCount: s.messageCount,
                  createdAt: s.createdAt,
                  lastModifiedAt: s.lastModifiedAt,
                  tags: s.tags,
                  preview: s.preview,
                  compressed: s.compressed,
                  estimatedTokens: s.estimatedTokens,
                })),
                total: sessions.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'session_load': {
        const { sessionId } = (args || {}) as { sessionId: string };

        const session = await sessionStore.load(sessionId);

        if (!session) {
          return {
            content: [{ type: 'text', text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: session.id,
                name: session.name,
                roleId: session.roleId,
                messageCount: session.messages.length,
                messages: session.messages.map(m => ({
                  role: m.role,
                  content: m.content.slice(0, 200) + (m.content.length > 200 ? '...' : ''),
                  timestamp: m.timestamp,
                })),
                metadata: {
                  createdAt: session.metadata.createdAt,
                  lastModifiedAt: session.metadata.lastModifiedAt,
                  model: session.metadata.model,
                  tags: session.metadata.tags,
                  compressed: session.metadata.compressed,
                  estimatedTokens: session.metadata.estimatedTokens,
                },
              }, null, 2),
            },
          ],
        };
      }

      case 'session_delete': {
        const { sessionId } = (args || {}) as { sessionId: string };

        const deleted = await sessionStore.delete(sessionId);

        if (!deleted) {
          return {
            content: [{ type: 'text', text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Session deleted: ${sessionId}`,
              }, null, 2),
            },
          ],
        };
      }

      case 'session_compress': {
        const {
          sessionId,
          strategy = 'summarize',
          keepRecentMessages = 10,
          targetTokens,
        } = (args || {}) as {
          sessionId: string;
          strategy?: CompressionStrategy;
          keepRecentMessages?: number;
          targetTokens?: number;
        };

        const session = await sessionStore.compress(sessionId, {
          strategy,
          keepRecentMessages,
          targetTokens,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionId: session.id,
                messageCount: session.messages.length,
                originalCount: session.metadata.originalMessageCount,
                estimatedTokens: session.metadata.estimatedTokens,
                message: `Session compressed: ${session.metadata.originalMessageCount} → ${session.messages.length} messages`,
              }, null, 2),
            },
          ],
        };
      }

      case 'session_fork': {
        const { sessionId, fromMessageIndex, name: forkName } = (args || {}) as {
          sessionId: string;
          fromMessageIndex?: number;
          name?: string;
        };

        const forked = await sessionStore.fork(sessionId, fromMessageIndex, forkName);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionId: forked.id,
                name: forked.name,
                parentSessionId: forked.metadata.parentSessionId,
                messageCount: forked.messages.length,
                message: `Session forked: ${forked.name || forked.id}`,
              }, null, 2),
            },
          ],
        };
      }

      case 'session_export': {
        const {
          sessionId,
          format = 'markdown',
          includeToolCalls = false,
          includeThinking = false,
          includeMetadata = true,
        } = (args || {}) as {
          sessionId: string;
          format?: ExportFormat;
          includeToolCalls?: boolean;
          includeThinking?: boolean;
          includeMetadata?: boolean;
        };

        const exported = await sessionStore.export(sessionId, {
          format,
          includeToolCalls,
          includeThinking,
          includeMetadata,
        });

        return {
          content: [
            {
              type: 'text',
              text: exported,
            },
          ],
        };
      }

      case 'session_rename': {
        const { sessionId, name: newName } = (args || {}) as {
          sessionId: string;
          name: string;
        };

        const session = await sessionStore.rename(sessionId, newName);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionId: session.id,
                name: session.name,
                message: `Session renamed to: ${newName}`,
              }, null, 2),
            },
          ],
        };
      }

      case 'session_add_tags': {
        const { sessionId, tags } = (args || {}) as {
          sessionId: string;
          tags: string[];
        };

        const session = await sessionStore.addTags(sessionId, tags);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionId: session.id,
                tags: session.metadata.tags,
                message: `Tags added to session`,
              }, null, 2),
            },
          ],
        };
      }

      case 'session_add_message': {
        const { sessionId, role, content } = (args || {}) as {
          sessionId: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
        };

        const message = await sessionStore.addMessage(sessionId, { role, content });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                messageId: message.id,
                sessionId,
                message: `Message added to session`,
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
  // Initialize session store
  await sessionStore.initialize();

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Mycelium Session Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
