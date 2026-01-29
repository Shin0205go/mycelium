// ============================================================================
// mycelium server - MCP Server standalone mode
// ============================================================================

import { Command } from 'commander';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

// Import from @mycelium/core
import { createMyceliumCore, ROUTER_TOOLS, type MyceliumCore } from '@mycelium/core';

interface ServerOptions {
  config: string;
  role?: string;
  verbose?: boolean;
}

/**
 * Simple logger for server mode
 */
class ServerLogger {
  constructor(private verbose: boolean = false) {}

  info(message: string, data?: unknown): void {
    if (this.verbose) {
      const dataStr = data ? ` ${JSON.stringify(data)}` : '';
      console.error(chalk.blue(`[INFO] ${message}${dataStr}`));
    }
  }

  warn(message: string, data?: unknown): void {
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.error(chalk.yellow(`[WARN] ${message}${dataStr}`));
  }

  error(message: string, data?: unknown): void {
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.error(chalk.red(`[ERROR] ${message}${dataStr}`));
  }

  ready(message: string): void {
    console.error(chalk.green(`[READY] ${message}`));
  }
}

/**
 * Start MCP Server in standalone mode
 */
async function startServer(options: ServerOptions): Promise<void> {
  const logger = new ServerLogger(options.verbose);
  const projectRoot = process.cwd();

  logger.info('Starting MYCELIUM MCP Server...', { projectRoot });

  // Load config
  const configPath = join(projectRoot, options.config);
  logger.info(`Loading config from: ${configPath}`);

  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    await access(configPath);
    const configContent = await readFile(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch (error) {
    logger.warn(`Config file not found or invalid: ${configPath}`);
  }

  // Create MCP Server
  const server = new Server(
    {
      name: 'mycelium-router',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    }
  );

  // Create Router Core
  const routerCore = createMyceliumCore(logger as any, {
    rolesDir: join(projectRoot, 'roles'),
    cwd: projectRoot,
  });

  // Add backend servers from config
  if (config.mcpServers) {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      logger.info(`Adding backend server: ${name}`);
      await routerCore.addServer(name, serverConfig as any);
    }
    logger.info(`Loaded ${Object.keys(config.mcpServers).length} backend servers`);
  }

  // Initialize router
  await routerCore.initialize();

  // Start backend servers
  logger.info('Starting backend servers...');
  await routerCore.startServers();
  logger.info('Backend servers started');

  // Load roles from skills server
  logger.info('Loading roles from skills...');
  await routerCore.loadRolesFromSkillsServer();
  logger.info('Roles loaded');

  // Set initial role
  const initialRole = options.role || process.env.MYCELIUM_CURRENT_ROLE || 'default';
  logger.info(`Setting initial role: ${initialRole}`);
  try {
    await routerCore.setRole({ role: initialRole });
    logger.info(`Role set to: ${initialRole}`);
  } catch (error) {
    logger.warn(`Failed to set role '${initialRole}', using default`);
  }

  // Setup request handlers
  setupRequestHandlers(server, routerCore, logger);

  // Setup graceful shutdown
  setupGracefulShutdown(server, logger);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.ready('MYCELIUM MCP Server running on stdio');
  logger.ready(`Role: ${initialRole}`);
  logger.ready('Waiting for connections...');
}

/**
 * Setup MCP request handlers
 */
function setupRequestHandlers(
  server: Server,
  routerCore: MyceliumCore,
  logger: ServerLogger
): void {
  // List Tools Handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info('ListTools request received');

    let backendTools: any[] = [];
    try {
      const response = await routerCore.routeRequest({ method: 'tools/list' });
      backendTools = response?.result?.tools || response?.tools || [];
      logger.info(`Got ${backendTools.length} tools from backend`);
    } catch (error) {
      logger.warn('Failed to get tools from backend:', error);
    }

    const allTools = [...backendTools];
    const existingToolNames = new Set(backendTools.map((t: any) => t.name));

    // Add router tools if accessible
    for (const tool of ROUTER_TOOLS) {
      if (existingToolNames.has(tool.name)) continue;
      try {
        routerCore.checkToolAccess(tool.name);
        allTools.push(tool);
      } catch {
        // No access
      }
    }

    logger.info(`Returning ${allTools.length} tools`);
    return { tools: allTools };
  });

  // Call Tool Handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info(`Tool call: ${name}`);

    // System tools (always allowed)
    const SYSTEM_TOOLS = [
      'mycelium-router__get_context',
      'mycelium-router__list_roles',
      'mycelium-router__set_active_skills',
      'mycelium-router__get_active_skills',
      'mycelium-router__list_skills'
    ];
    const isSystemTool = SYSTEM_TOOLS.includes(name) ||
      SYSTEM_TOOLS.some(t => name.endsWith(`__${t.replace('mycelium-router__', '')}`));

    // Check access
    if (!isSystemTool) {
      try {
        routerCore.checkToolAccess(name);
      } catch (error: any) {
        logger.warn(`Access denied: ${name}`);
        return {
          content: [{ type: 'text', text: `Access denied: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle get_context
    if (name === 'mycelium-router__get_context' || name.endsWith('__get_context')) {
      try {
        const context = routerCore.getContext();
        return {
          content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle list_roles
    if (name === 'mycelium-router__list_roles' || name.endsWith('__list_roles')) {
      try {
        const roles = routerCore.listRoles();
        return {
          content: [{ type: 'text', text: JSON.stringify(roles, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle set_active_skills
    if (name === 'mycelium-router__set_active_skills' || name.endsWith('__set_active_skills')) {
      try {
        const skillArgs = args as { skills: string[] };
        const result = routerCore.setActiveSkills(skillArgs.skills || []);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle get_active_skills
    if (name === 'mycelium-router__get_active_skills' || name.endsWith('__get_active_skills')) {
      try {
        const result = routerCore.getActiveSkills();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle list_skills
    if (name === 'mycelium-router__list_skills' || name.endsWith('__list_skills')) {
      try {
        const skills = routerCore.listSkills();
        return {
          content: [{ type: 'text', text: JSON.stringify(skills, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Route to backend
    try {
      const result = await routerCore.executeToolCall(name, args as Record<string, unknown>);
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  // List Prompts Handler
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [{
        name: 'current_role',
        description: 'Get information about the current active role',
      }],
    };
  });

  // Get Prompt Handler
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    if (name === 'current_role') {
      const state = routerCore.getState();
      return {
        description: 'Current role information',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Current Role: ${state.currentRole || 'default'}\n\nSystem Instruction:\n${state.systemInstruction || 'No instruction set'}`,
          },
        }],
      };
    }
    throw new Error(`Unknown prompt: ${name}`);
  });
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(server: Server, logger: ServerLogger): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    try {
      await server.close();
      logger.info('Server closed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Command definition
export const serverCommand = new Command('server')
  .description('Start MYCELIUM as a standalone MCP server')
  .option('-c, --config <path>', 'Config file path', 'config.json')
  .option('-r, --role <role>', 'Default role for the server')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options: ServerOptions) => {
    try {
      await startServer(options);
    } catch (error) {
      console.error(chalk.red('Fatal error:'), error);
      process.exit(1);
    }
  });
