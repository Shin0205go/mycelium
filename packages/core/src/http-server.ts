/**
 * Mycelium HTTP Server - REST API for Apple Watch and other HTTP clients
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
  authToken?: string; // Bearer token for authentication
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

// Fallback roles if mycelium-router is unavailable
const FALLBACK_ROLES = [
  { id: 'orchestrator', name: 'Orchestrator', description: 'Default role with full access' },
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

  // Bearer Token authentication middleware
  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Skip auth if no token configured
    if (!config.authToken) {
      next();
      return;
    }

    // Allow health check without auth
    if (req.path === '/health') {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Missing or invalid Authorization header. Use: Bearer <token>',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (token !== config.authToken) {
      console.log(`[Auth] Invalid token attempt`);
      res.status(403).json({
        success: false,
        error: 'Invalid token',
      });
      return;
    }

    next();
  };

  app.use(authMiddleware);

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // List available roles from mycelium-router
  app.get('/api/roles', async (_req: Request, res: Response) => {
    try {
      console.log('[Roles] Fetching roles from mycelium-router...');
      const result = await runQuery(
        'Use the mycelium-router__list_roles tool to get available roles. Return ONLY the JSON array from the tool result, nothing else.',
        {
          model: 'claude-3-5-haiku-20241022',
          useApiKey: config.useApiKey ?? false,
          maxTurns: 3,
        }
      );

      console.log('[Roles] Result:', JSON.stringify(result, null, 2));

      if (result.success && result.result) {
        // Parse roles from result
        const jsonMatch = result.result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const roles = JSON.parse(jsonMatch[0]);
          console.log('[Roles] Parsed roles:', roles.length);
          res.json({ roles });
          return;
        }
      }
      // Fallback
      console.log('[Roles] Using fallback roles');
      res.json({ roles: FALLBACK_ROLES });
    } catch (error) {
      console.error('[Roles Error]', error);
      res.json({ roles: FALLBACK_ROLES });
    }
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
      const tokenStatus = config.authToken
        ? `Required (${config.authToken.substring(0, 4)}...)`
        : 'None (open access)';
      console.log(`
╔════════════════════════════════════════════════════════╗
║           Mycelium HTTP Server                            ║
╠════════════════════════════════════════════════════════╣
║  URL:    http://${host}:${config.port}
║  Model:  ${config.model || 'claude-3-5-haiku-20241022'}
║  Auth:   ${config.useApiKey ? 'API Key' : 'Claude Code'}
║  Token:  ${tokenStatus}
╠════════════════════════════════════════════════════════╣
║  Endpoints:                                            ║
║    GET  /health      - Health check (no auth)          ║
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
