/**
 * Aegis API Server
 * REST API wrapper for Agent SDK integration
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { runQuery, createQuery, extractTextFromMessage, getToolUseInfo, type AgentConfig } from './agent.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('info');
const app = new Hono();

// CORS for app access
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// List available roles
app.get('/api/roles', async (c) => {
  try {
    const result = await runQuery('set_role(role_id: "list")を実行して、利用可能なロール一覧をJSON形式で返して');
    return c.json({
      success: result.success,
      data: result.result,
      usage: result.usage
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Chat endpoint (main)
app.post('/api/chat', async (c) => {
  try {
    const body = await c.req.json();
    const { prompt, role, config } = body as {
      prompt: string;
      role?: string;
      config?: AgentConfig;
    };

    if (!prompt) {
      return c.json({ success: false, error: 'prompt is required' }, 400);
    }

    // Build full prompt with role switch if specified
    let fullPrompt = prompt;
    if (role) {
      fullPrompt = `まずset_role(role_id: "${role}")を実行してロールを切り替えてから、次のタスクを実行してください:\n\n${prompt}`;
    }

    const result = await runQuery(fullPrompt, config || {});

    return c.json({
      success: result.success,
      result: result.result,
      error: result.error,
      usage: result.usage
    });
  } catch (error: any) {
    logger.error('Chat error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Streaming chat endpoint
app.post('/api/chat/stream', async (c) => {
  try {
    const body = await c.req.json();
    const { prompt, role, config } = body as {
      prompt: string;
      role?: string;
      config?: AgentConfig;
    };

    if (!prompt) {
      return c.json({ success: false, error: 'prompt is required' }, 400);
    }

    // Build full prompt with role switch if specified
    let fullPrompt = prompt;
    if (role) {
      fullPrompt = `まずset_role(role_id: "${role}")を実行してロールを切り替えてから、次のタスクを実行してください:\n\n${prompt}`;
    }

    const query = createQuery(fullPrompt, config || {});

    // Server-Sent Events
    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          try {
            for await (const message of query) {
              const text = extractTextFromMessage(message);
              const tools = getToolUseInfo(message);

              const event = {
                type: message.type,
                text,
                tools: tools.length > 0 ? tools : undefined,
                ...(message.type === 'result' ? {
                  subtype: (message as any).subtype,
                  usage: (message as any).usage
                } : {})
              };

              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
              );
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error: any) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`)
            );
            controller.close();
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      }
    );
  } catch (error: any) {
    logger.error('Stream error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Set role directly
app.post('/api/role', async (c) => {
  try {
    const { roleId } = await c.req.json();

    if (!roleId) {
      return c.json({ success: false, error: 'roleId is required' }, 400);
    }

    const result = await runQuery(`set_role(role_id: "${roleId}")を実行して、結果を返して`);

    return c.json({
      success: result.success,
      result: result.result,
      usage: result.usage
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Start server
const port = parseInt(process.env.AEGIS_API_PORT || '3000');

logger.info(`Starting Aegis API Server on port ${port}...`);

serve({
  fetch: app.fetch,
  port
}, (info) => {
  logger.info(`Aegis API Server running at http://localhost:${info.port}`);
  logger.info('Endpoints:');
  logger.info('  GET  /health       - Health check');
  logger.info('  GET  /api/roles    - List available roles');
  logger.info('  POST /api/chat     - Chat with agent');
  logger.info('  POST /api/chat/stream - Streaming chat (SSE)');
  logger.info('  POST /api/role     - Switch role');
});

export { app };
