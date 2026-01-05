#!/usr/bin/env node
// ============================================================================
// AEGIS Router - MCP Server Entry Point
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
import { spawn } from 'child_process';
import { Logger } from './utils/logger.js';
import { AegisRouterCore, createAegisRouterCore, ROUTER_TOOLS } from './router/aegis-router-core.js';

// Get the directory of this script (works with ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from dist/ -> packages/core/ -> packages/ -> project root
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

// Path to aegis-cli for sub-agent spawning
const AEGIS_CLI_PATH = process.env.AEGIS_CLI_PATH ||
  join(PROJECT_ROOT, 'packages', 'core', 'dist', 'cli-entry.js');

const logger = new Logger('info');

/**
 * Spawn a sub-agent with a specific role
 * Streams progress to logger for visibility
 */
async function spawnSubAgent(
  role: string,
  task: string,
  model?: string
): Promise<{
  success: boolean;
  role: string;
  result?: string;
  error?: string;
  toolsUsed?: string[];
  usage?: { inputTokens: number; outputTokens: number; costUSD: number };
  streamedOutput?: string;
}> {
  return new Promise((resolve, reject) => {
    // Don't use --json so we can stream output
    const args = ['--role', role];
    if (model) {
      args.push('--model', model);
    }
    args.push(task);

    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`🤖 Sub-Agent [${role}] Starting...`);
    logger.info(`📝 Task: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`);
    logger.info(`${'='.repeat(60)}\n`);

    const child = spawn('node', [AEGIS_CLI_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AEGIS_CURRENT_ROLE: role  // Pass role to sub-agent's aegis-router
      },
    });

    let stdout = '';
    let stderr = '';
    const toolsUsed: string[] = [];

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // Stream output with prefix
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          // Check for tool usage
          const toolMatch = line.match(/⚙️\s+Using:\s+(\S+)/);
          if (toolMatch) {
            toolsUsed.push(toolMatch[1]);
          }
          logger.info(`[${role}] ${line}`);
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log errors/warnings from sub-agent
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim() && !line.includes('[aegis]')) {
          logger.info(`[${role}:err] ${line.trim()}`);
        }
      }
    });

    child.on('close', (code) => {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`🏁 Sub-Agent [${role}] Completed (exit: ${code})`);
      logger.info(`${'='.repeat(60)}\n`);

      // Extract the actual response (after "Claude: ")
      const claudeMatch = stdout.match(/Claude:\s*([\s\S]*?)(?:\n\s*📊|$)/);
      const result = claudeMatch ? claudeMatch[1].trim() : stdout.trim();

      // Extract usage info
      const usageMatch = stdout.match(/Tokens:\s*(\d+)\s*in\s*\/\s*(\d+)\s*out.*\$([0-9.]+)/);
      const usage = usageMatch ? {
        inputTokens: parseInt(usageMatch[1]),
        outputTokens: parseInt(usageMatch[2]),
        costUSD: parseFloat(usageMatch[3])
      } : undefined;

      resolve({
        success: code === 0,
        role,
        result,
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
        usage,
        streamedOutput: stdout
      });
    });

    child.on('error', (error) => {
      reject(error);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      child.kill();
      reject(new Error('Sub-agent timeout (5 minutes)'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Spawn an interactive sub-agent in a new terminal window (macOS)
 * Reuses existing terminal window for the same role if available.
 * Terminal windows are identified by custom title: "AEGIS: <role>"
 */
async function spawnInteractiveSubAgent(
  role: string,
  initialPrompt: string,
  model?: string
): Promise<void> {
  const { exec } = await import('child_process');
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');

  // Create a temporary script file to run in the terminal
  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `aegis-subagent-${role}-${Date.now()}.sh`);

  // Escape for shell
  const escapeForShell = (s: string) => s.replace(/'/g, "'\\''");
  const escapedPrompt = escapeForShell(initialPrompt);
  const modelArg = model ? `--model '${escapeForShell(model)}'` : '';

  // Window title for this role - used to identify and reuse windows
  const windowTitle = `AEGIS: ${role}`;

  // Create a shell script that runs the prompt
  // Note: Uses printf to set window title
  const shellScript = `#!/bin/bash
# Set terminal window title
printf '\\033]0;${windowTitle}\\007'

clear
echo '🤖 AEGIS Sub-Agent [${role}]'
echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo ''
echo 'Task: ${escapedPrompt.substring(0, 100)}${escapedPrompt.length > 100 ? '...' : ''}'
echo ''
echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo ''

# Run the one-shot query first
AEGIS_CONFIG_PATH="${process.env.AEGIS_CONFIG_PATH || 'config.json'}" \\
AEGIS_CURRENT_ROLE='${role}' \\
node "${AEGIS_CLI_PATH}" ${modelArg} '${escapedPrompt}'

echo ''
echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo 'Task completed. Starting interactive session...'
echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo ''

# Then start interactive mode for follow-up
AEGIS_CONFIG_PATH="${process.env.AEGIS_CONFIG_PATH || 'config.json'}" \\
AEGIS_CURRENT_ROLE='${role}' \\
node "${AEGIS_CLI_PATH}" ${modelArg}
`;

  await fs.writeFile(scriptPath, shellScript, { mode: 0o755 });

  // AppleScript to find existing window or create new one
  // Searches for window with matching custom title
  const appleScript = `
tell application "Terminal"
    activate

    -- Try to find existing window for this role by custom title
    set foundWindow to missing value
    repeat with w in windows
        try
            if name of w contains "${windowTitle}" then
                set foundWindow to w
                exit repeat
            end if
        end try
    end repeat

    if foundWindow is not missing value then
        -- Reuse existing window
        set frontmost of foundWindow to true

        -- Send Ctrl+C to interrupt any running process
        tell application "System Events"
            keystroke "c" using control down
        end tell
        delay 0.3

        -- Run new task in same window
        do script "bash '${scriptPath}'" in foundWindow
    else
        -- Create new window with the script
        do script "bash '${scriptPath}'"
    end if
end tell
`;

  return new Promise((resolve, reject) => {
    exec(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, (error, stdout, stderr) => {
      if (error) {
        // Clean up on error
        fs.unlink(scriptPath).catch(() => {});
        logger.error('Failed to open Terminal window:', error);
        reject(error);
      } else {
        logger.info(`Interactive sub-agent window for role: ${role} (reusing if exists)`);
        // Don't delete the script immediately - Terminal needs it
        setTimeout(() => fs.unlink(scriptPath).catch(() => {}), 30000);
        resolve();
      }
    });
  });
}

async function main() {
  logger.info('Starting AEGIS Router MCP Server...', { projectRoot: PROJECT_ROOT });

  // Create MCP Server
  const server = new Server(
    {
      name: 'aegis-router',
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
  const routerCore = createAegisRouterCore(logger, {
    rolesDir: join(PROJECT_ROOT, 'roles'),
    cwd: PROJECT_ROOT,
  });

  // Load server configuration from environment or default config file
  const configPath = process.env.AEGIS_CONFIG_PATH || join(PROJECT_ROOT, 'config.json');
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

  // Load roles from aegis-skills server
  logger.info('Loading roles from aegis-skills...');
  await routerCore.loadRolesFromSkillsServer();
  logger.info('Roles loaded');

  // Auto-switch to role if AEGIS_CURRENT_ROLE is set
  // Use routerCore.setRole() directly (not via tools/call) since set_role may be disabled
  const currentRoleEnv = process.env.AEGIS_CURRENT_ROLE;
  if (currentRoleEnv) {
    logger.info(`Auto-switching to role from env: ${currentRoleEnv}`);
    try {
      await routerCore.startServersForRole(currentRoleEnv);
      await routerCore.setRole({ role: currentRoleEnv });
      logger.info(`Successfully switched to role: ${currentRoleEnv}`);
    } catch (error) {
      logger.warn(`Failed to switch to role ${currentRoleEnv}:`, error);
    }
  }

  // List Tools Handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info('ListTools request received');

    // set_role is hidden by default (sub-agent based design)
    // Enable with AEGIS_EXPOSE_SET_ROLE=true for legacy/testing
    const exposeSetRole = process.env.AEGIS_EXPOSE_SET_ROLE === 'true';

    const setRoleTool = {
      name: 'set_role',
      description: 'Switch agent role and get the manifest with available tools and system instruction',
      inputSchema: {
        type: 'object' as const,
        properties: {
          role_id: {
            type: 'string',
            description: 'The role ID to switch to',
          },
        },
        required: ['role_id'],
      },
    };

    // Get tools from backend servers via router
    let backendTools: any[] = [];
    try {
      const response = await routerCore.routeRequest({ method: 'tools/list' });
      const rawTools = response?.result?.tools || response?.tools || [];
      // Filter out set_role from backend to avoid duplicates
      backendTools = rawTools.filter((t: any) => t.name !== 'set_role');
      logger.info(`Got ${backendTools.length} tools from backend servers`);
    } catch (error) {
      logger.warn('Failed to get tools from backend servers:', error);
    }

    // Build tools list: set_role only if explicitly enabled, others based on RBAC
    const allTools = exposeSetRole ? [setRoleTool, ...backendTools] : [...backendTools];

    // Add router-level tools if current role has access (defined in ROUTER_TOOLS)
    // Only add if not already in backendTools (avoid duplicates)
    const existingToolNames = new Set(allTools.map(t => t.name));
    for (const tool of ROUTER_TOOLS) {
      if (existingToolNames.has(tool.name)) continue;
      try {
        routerCore.checkToolAccess(tool.name);
        allTools.push(tool);
      } catch {
        // Role doesn't have access to this tool
      }
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

    // Check tool access (skip for system tools - only set_role is always available)
    const SYSTEM_TOOLS = ['set_role'];
    if (!SYSTEM_TOOLS.includes(name)) {
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

    // Handle spawn_sub_agent
    if (name === 'aegis-router__spawn_sub_agent' || name.endsWith('__spawn_sub_agent')) {
      logger.info(`🚀 Spawning sub-agent`);
      const { role, task, model, interactive = true } = args as {
        role: string;
        task: string;
        model?: string;
        interactive?: boolean;
      };

      if (!role || !task) {
        return {
          content: [{ type: 'text', text: 'Error: role and task are required' }],
          isError: true,
        };
      }

      try {
        if (interactive) {
          // Open in new terminal window
          await spawnInteractiveSubAgent(role, task, model);
          return {
            content: [{
              type: 'text',
              text: `Opened interactive sub-agent in new terminal window with role: ${role}`,
            }],
          };
        } else {
          const result = await spawnSubAgent(role, task, model);

          // Format output to show sub-agent activity
          let output = `\n${'═'.repeat(50)}\n`;
          output += `🤖 Sub-Agent [${result.role}] Result\n`;
          output += `${'═'.repeat(50)}\n\n`;

          if (result.toolsUsed && result.toolsUsed.length > 0) {
            output += `🔧 Tools Used: ${result.toolsUsed.join(', ')}\n\n`;
          }

          output += result.result || '(no output)';

          if (result.usage) {
            output += `\n\n📊 Usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out | $${result.usage.costUSD.toFixed(4)}`;
          }

          output += `\n${'═'.repeat(50)}\n`;

          return {
            content: [{ type: 'text', text: output }],
          };
        }
      } catch (error: any) {
        logger.error('Sub-agent spawn failed:', error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Handle list_roles
    if (name === 'aegis-router__list_roles' || name.endsWith('__list_roles')) {
      logger.info(`✅ Handling list_roles`);
      const roles = routerCore.listRoles();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(roles, null, 2),
          },
        ],
      };
    }

    // Handle set_role (check both exact match and suffix)
    if (name === 'set_role' || name.endsWith('__set_role')) {
      // Reject if set_role is not exposed (sub-agent design default)
      const exposeSetRole = process.env.AEGIS_EXPOSE_SET_ROLE === 'true';
      if (!exposeSetRole) {
        logger.warn(`set_role called but not exposed (use AEGIS_EXPOSE_SET_ROLE=true to enable)`);
        return {
          content: [{
            type: 'text',
            text: 'Error: set_role is disabled. Use spawn_sub_agent to delegate tasks to specific roles.',
          }],
          isError: true,
        };
      }

      logger.info(`✅ Handling set_role (matched: ${name})`);
      logger.info(`📋 Arguments: ${JSON.stringify(args)}`);
      const roleId = (args as any)?.role_id;
      logger.info(`🎭 Role ID: ${roleId}`);

      try {
        // Start required servers for this role (lazy loading)
        logger.info(`Switching to role: ${roleId}, starting required servers...`);
        await routerCore.startServersForRole(roleId);

        // Get manifest (this updates currentRole and visibleTools)
        const manifest = await routerCore.setRole({ role: roleId });

        // Notify client that tools have changed AFTER role is updated
        try {
          await server.sendToolListChanged();
          logger.info('Sent tools/list_changed notification');
        } catch (notifyError) {
          logger.warn('Failed to send tools/list_changed notification:', notifyError);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(manifest, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error(`Failed to switch to role ${roleId}:`, error);
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
    }

    // Route to backend server
    try {
      const result = await routerCore.routeToolCall(name, args as Record<string, unknown>);
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

  logger.info('AEGIS Router MCP Server running on stdio');
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
