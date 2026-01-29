#!/usr/bin/env node
// ============================================================================
// MYCELIUM Router - MCP Server Entry Point
// stdio-based MCP server for Claude Desktop / Claude Code integration
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './utils/logger.js';
import { MyceliumCore, createMyceliumCore, ROUTER_TOOLS } from './router/mycelium-core.js';

// Get the directory of this script (works with ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from dist/ -> packages/core/ -> packages/ -> project root
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

const logger = new Logger('info');

async function main() {
  logger.info('Starting MYCELIUM Router MCP Server...', { projectRoot: PROJECT_ROOT });

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

  // Initialize Router Core with explicit paths
  const routerCore = createMyceliumCore(logger, {
    rolesDir: join(PROJECT_ROOT, 'roles'),
    cwd: PROJECT_ROOT,
  });

  // Load server configuration from environment or default config file
  const configPath = process.env.MYCELIUM_CONFIG_PATH || join(PROJECT_ROOT, 'config.json');
  logger.info(`Loading backend servers from: ${configPath}`);

  try {
    const fs = await import('fs/promises');
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        logger.info(`Adding backend server: ${name}`);
        await routerCore.addServer(name, serverConfig as any);
      }
      logger.info(`Loaded ${Object.keys(config.mcpServers).length} backend server configurations`);
    }
  } catch (error) {
    logger.warn(`Failed to load config from ${configPath}:`, error);
  }

  // Initialize router FIRST (sets default role for filtering)
  await routerCore.initialize();

  // Start all backend servers AFTER role is set (so filtering works)
  logger.info('Starting all backend servers...');
  await routerCore.startServers();
  logger.info('All backend servers started');

  // Load roles from mycelium-skills server
  logger.info('Loading roles from mycelium-skills...');
  await routerCore.loadRolesFromSkillsServer();
  logger.info('Roles loaded');

  // Set initial role if MYCELIUM_CURRENT_ROLE is set
  const currentRoleEnv = process.env.MYCELIUM_CURRENT_ROLE;
  if (currentRoleEnv) {
    logger.info(`Switching to role from env: ${currentRoleEnv}`);
    try {
      await routerCore.setRole({ role: currentRoleEnv });
      logger.info(`Role switched to: ${currentRoleEnv}`);
    } catch (error) {
      logger.warn(`Failed to switch to role '${currentRoleEnv}':`, error);
    }
  }

  // Set initial skill if MYCELIUM_CURRENT_SKILL is set
  const currentSkillEnv = process.env.MYCELIUM_CURRENT_SKILL;
  if (currentSkillEnv) {
    logger.info(`Using skill from env: ${currentSkillEnv}`);
  }

  // List Tools Handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info('ListTools request received');

    // Get tools from backend servers via router
    let backendTools: any[] = [];
    try {
      const response = await routerCore.routeRequest({ method: 'tools/list' });
      const rawTools = response?.result?.tools || response?.tools || [];
      backendTools = rawTools;
      logger.info(`Got ${backendTools.length} tools from backend servers`);
    } catch (error) {
      logger.warn('Failed to get tools from backend servers:', error);
    }

    // Build tools list from backend and router tools
    const allTools = [...backendTools];

    // Track existing tool names to avoid duplicates
    const existingToolNames = new Set(backendTools.map((t: any) => t.name));

    // Add router-level system tools (always visible, no access check)
    // These are management tools that should always be available
    for (const tool of ROUTER_TOOLS) {
      if (existingToolNames.has(tool.name)) {
        continue;  // Already included from backendTools
      }
      allTools.push(tool);
    }

    logger.info(`Returning ${allTools.length} total tools`);

    return {
      tools: allTools,
    };
  });

  // Call Tool Handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.info(`📥 Tool call received: "${name}"`);

    // Check tool access (skip for router system tools - always available)
    const ROUTER_SYSTEM_TOOLS = [
      'mycelium-router__get_context',
      'mycelium-router__list_roles',
      'mycelium-router__set_active_skills',
      'mycelium-router__get_active_skills',
      'mycelium-router__list_skills',
      'mycelium-router__suggest_skills',
      'mycelium-router__set_role'
    ];
    // Also skip check if tool name ends with system tool suffix
    const isSystemTool = ROUTER_SYSTEM_TOOLS.includes(name) ||
      ROUTER_SYSTEM_TOOLS.some(t => name.endsWith(`__${t.replace('mycelium-router__', '')}`));
    if (!isSystemTool) {
      try {
        routerCore.checkToolAccess(name);
      } catch (error: any) {
        logger.warn(`🚫 Tool access denied: ${name}`);
        return {
          content: [{ type: 'text', text: `Access denied: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle get_context
    if (name === 'mycelium-router__get_context' || name.endsWith('__get_context')) {
      logger.info(`✅ Handling get_context`);
      try {
        const context = routerCore.getContext();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(context, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error(`Failed to get context:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle list_roles
    if (name === 'mycelium-router__list_roles' || name.endsWith('__list_roles')) {
      logger.info(`✅ Handling list_roles`);
      try {
        const roles = routerCore.listRoles();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(roles, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error(`Failed to list roles:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle set_active_skills
    if (name === 'mycelium-router__set_active_skills' || name.endsWith('__set_active_skills')) {
      logger.info(`✅ Handling set_active_skills`);
      try {
        const skillArgs = args as { skills: string[] };
        const result = routerCore.setActiveSkills(skillArgs.skills || []);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (error: any) {
        logger.error(`Failed to set active skills:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle get_active_skills
    if (name === 'mycelium-router__get_active_skills' || name.endsWith('__get_active_skills')) {
      logger.info(`✅ Handling get_active_skills`);
      try {
        const result = routerCore.getActiveSkills();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        logger.error(`Failed to get active skills:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle list_skills
    if (name === 'mycelium-router__list_skills' || name.endsWith('__list_skills')) {
      logger.info(`✅ Handling list_skills`);
      try {
        const skills = routerCore.listSkills();
        return {
          content: [{ type: 'text', text: JSON.stringify(skills, null, 2) }],
        };
      } catch (error: any) {
        logger.error(`Failed to list skills:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle suggest_skills
    if (name === 'mycelium-router__suggest_skills' || name.endsWith('__suggest_skills')) {
      logger.info(`✅ Handling suggest_skills`);
      try {
        const suggestArgs = args as { intent: string };
        if (!suggestArgs.intent) {
          return {
            content: [{ type: 'text', text: 'Error: intent parameter is required' }],
            isError: true,
          };
        }
        const suggestions = routerCore.suggestSkills(suggestArgs.intent);
        return {
          content: [{ type: 'text', text: JSON.stringify(suggestions, null, 2) }],
        };
      } catch (error: any) {
        logger.error(`Failed to suggest skills:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle set_role
    if (name === 'mycelium-router__set_role' || name.endsWith('__set_role')) {
      logger.info(`✅ Handling set_role`);
      try {
        const roleArgs = args as { role: string };
        if (!roleArgs.role) {
          return {
            content: [{ type: 'text', text: 'Error: role parameter is required' }],
            isError: true,
          };
        }
        const manifest = await routerCore.setRole({ role: roleArgs.role });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            role: manifest.role,
            toolCount: manifest.availableTools?.length || 0,
            availableServers: manifest.availableServers,
          }, null, 2) }],
        };
      } catch (error: any) {
        logger.error(`Failed to set role:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Route to backend server
    try {
      const result = await routerCore.executeToolCall(name, args as Record<string, unknown>);
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List Prompts Handler
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'current_role',
          description: 'Get information about the current active role',
        },
      ],
    };
  });

  // Get Prompt Handler
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === 'current_role') {
      const state = routerCore.getState();
      return {
        description: 'Current role information',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Current Role: ${state.currentRole || 'default'}\n\nSystem Instruction:\n${state.systemInstruction || 'No instruction set'}`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MYCELIUM Router MCP Server running on stdio');
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
