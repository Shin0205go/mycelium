/**
 * AEGIS HTTP Server - REST API for Apple Watch and other HTTP clients
 *
 * Endpoints:
 * - GET  /health     - Health check
 * - GET  /api/roles  - List available roles
 * - POST /api/chat   - Send message and get response
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { runQuery, type AgentConfig } from './agent.js';

export interface HttpServerConfig {
  port: number;
  host?: string;
  useApiKey?: boolean;
  model?: string;
  allowedOrigins?: string[];
}

interface ChatRequest {
  prompt: string;
  role?: string;
  model?: string;
}

interface ChatResponse {
  success: boolean;
  result?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
}

interface RolesResponse {
  roles: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
}

// Default roles - in future could be fetched from aegis-router
const DEFAULT_ROLES = [
  { id: 'orchestrator', name: 'Orchestrator', description: 'Default role with full access' },
  { id: 'developer', name: 'Developer', description: 'Development tasks' },
  { id: 'assistant', name: 'Assistant', description: 'General assistance' },
  { id: 'reviewer', name: 'Reviewer', description: 'Code review tasks' },
  { id: 'mentor', name: 'Mentor', description: 'Teaching and guidance' },
];

/**
 * Create and configure the Express app
 */
export function createHttpApp(config: HttpServerConfig) {
  const app = express();

  // Middleware
  app.use(cors({
    origin: config.allowedOrigins || '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // List available roles
  app.get('/api/roles', (_req: Request, res: Response) => {
    const response: RolesResponse = {
      roles: DEFAULT_ROLES,
    };
    res.json(response);
  });

  // Chat endpoint
  app.post('/api/chat', async (req: Request, res: Response) => {
    const { prompt, role, model } = req.body as ChatRequest;

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid "prompt" field',
      } as ChatResponse);
      return;
    }

    console.log(`[Chat] Role: ${role || 'orchestrator'}, Prompt: ${prompt.substring(0, 50)}...`);

    try {
      const agentConfig: AgentConfig = {
        currentRole: role || 'orchestrator',
        model: model || config.model || 'claude-3-5-haiku-20241022',
        useApiKey: config.useApiKey ?? false,
        maxTurns: 10, // Limit turns for watch requests
        persistSession: false, // Stateless for HTTP
        continueSession: false,
      };

      const result = await runQuery(prompt, agentConfig);

      const response: ChatResponse = {
        success: result.success,
        result: result.result,
        error: result.error,
        usage: result.usage,
      };

      res.json(response);
    } catch (error) {
      console.error('[Chat Error]', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ChatResponse);
    }
  });

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not found',
      endpoints: [
        'GET  /health',
        'GET  /api/roles',
        'POST /api/chat',
      ],
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server Error]', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  });

  return app;
}

/**
 * Start the HTTP server
 */
export function startHttpServer(config: HttpServerConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const app = createHttpApp(config);
    const host = config.host || '0.0.0.0';

    const server = app.listen(config.port, host, () => {
      console.log(`
╔════════════════════════════════════════════════════════╗
║           AEGIS HTTP Server                            ║
╠════════════════════════════════════════════════════════╣
║  URL:    http://${host}:${config.port}
║  Model:  ${config.model || 'claude-3-5-haiku-20241022'}
║  Auth:   ${config.useApiKey ? 'API Key' : 'Claude Code'}
╠════════════════════════════════════════════════════════╣
║  Endpoints:                                            ║
║    GET  /health      - Health check                    ║
║    GET  /api/roles   - List available roles            ║
║    POST /api/chat    - Send message                    ║
╚════════════════════════════════════════════════════════╝
`);
      resolve();
    });

    server.on('error', (error) => {
      reject(error);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down server...');
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      console.log('\nReceived SIGTERM, shutting down...');
      server.close(() => {
        process.exit(0);
      });
    });
  });
}
