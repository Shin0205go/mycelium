# CLAUDE.md - Aegis-CLI Codebase Guide

This document provides guidance for AI assistants working with the Aegis-CLI codebase.

## Project Overview

Aegis-CLI is a **skill-driven Role-Based Access Control (RBAC) MCP proxy router** that integrates Claude Agent SDK with Model Context Protocol (MCP) servers. It provides dynamic role-based tool filtering and access control for AI agents.

### Key Concepts

- **MCP (Model Context Protocol)**: Anthropic's protocol for tool/resource integration
- **Skill-Driven RBAC**: Skills declare which roles can use them; roles are dynamically generated from skill definitions
- **Router Proxy**: Routes tool calls from Claude to appropriate backend MCP servers
- **Dynamic Role Switching**: Agents can switch roles at runtime via `set_role` tool

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Aegis-skills (MCP Server)                │
│  list_skills → スキル一覧を提供                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skill: docx-handler                                 │   │
│  │  - allowedRoles: [formatter, admin]                  │   │
│  │  - allowedTools: [filesystem__read, docx__parse]     │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼ list_skills
┌─────────────────────────────────────────────────────────────┐
│                    AegisRouterCore (司令塔)                  │
│  ├── StdioRouter (MCP server connection management)        │
│  ├── RoleManager (role definitions and permission checks)  │
│  └── ToolVisibilityManager (tool filtering)                │
│                                                             │
│  loadFromSkillManifest() → dynamic role generation         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼ set_role
┌─────────────────────────────────────────────────────────────┐
│                    Agent (Claude)                           │
│  - Role selection → available tools change                  │
│  - Operates with skill-based permissions                    │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── index.ts              # CLI entry point (interactive/sub-agent modes)
├── mcp-server.ts         # MCP server entry point (stdio-based)
├── cli.ts                # Interactive REPL CLI implementation
├── sub-agent.ts          # Non-interactive sub-agent mode
├── agent.ts              # Claude Agent SDK integration
├── mcp-client.ts         # MCP client for connecting to router
├── args.ts               # CLI argument parsing
├── router/
│   ├── aegis-router-core.ts      # Central routing system (司令塔)
│   ├── role-manager.ts           # Role definitions and permissions
│   ├── tool-visibility-manager.ts # Tool filtering by role
│   ├── router-adapter.ts         # Bridge for MCP proxy integration
│   └── remote-prompt-fetcher.ts  # Remote prompt fetching
├── mcp/
│   ├── stdio-router.ts           # Manages upstream MCP server connections
│   ├── tool-discovery.ts         # Tool discovery from servers
│   └── dynamic-tool-discovery.ts # Dynamic tool loading
├── types/
│   ├── index.ts          # Type exports
│   ├── router-types.ts   # Router-related types (Role, Skill, etc.)
│   └── mcp-types.ts      # MCP-related types
├── utils/
│   └── logger.ts         # Winston-based logger
└── constants/
    └── index.ts          # Timeout and server constants

tests/
├── role-manager.test.ts          # RoleManager unit tests
├── tool-visibility-manager.test.ts # ToolVisibilityManager tests
├── tool-filtering.test.ts        # Role-based tool filtering tests
├── skill-integration.test.ts     # Skill integration tests
├── role-switching.test.ts        # Role switching tests
├── aegis-skills-access.test.ts   # Skills access tests
└── real-e2e.test.ts              # E2E tests with aegis-skills server
```

## Key Components

### 1. AegisRouterCore (`src/router/aegis-router-core.ts`)
The central "司令塔" (command center) that:
- Manages connections to multiple MCP backend servers
- Maintains a virtual tool table filtered by current role
- Handles role switching via `set_role`
- Emits `tools/list_changed` notifications when tools change

### 2. RoleManager (`src/router/role-manager.ts`)
Handles role definitions and permission checking:
- Loads roles dynamically from skill manifests
- Generates roles from skill definitions (inverted RBAC)
- Checks server/tool permissions for roles
- Supports wildcard (`*`) and pattern matching

### 3. ToolVisibilityManager (`src/router/tool-visibility-manager.ts`)
Manages tool discovery and role-based visibility:
- Registers tools from backend servers
- Filters visible tools based on current role
- Always includes `set_role` system tool
- Checks tool access before allowing calls

### 4. StdioRouter (`src/mcp/stdio-router.ts`)
Manages stdio-based MCP server connections:
- Spawns and manages child processes
- Handles MCP initialization handshake
- Routes requests to appropriate servers
- Aggregates tool lists from multiple servers
- Prefixes tool names with server name (e.g., `filesystem__read_file`)

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in interactive CLI mode
npm start

# Run as MCP server (stdio)
npm run start:mcp

# Development mode (with tsx)
npm run dev
npm run dev:mcp

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## CLI Usage

### Interactive Mode (Default)
```bash
npm start
# or
aegis-cli
```

Commands:
- `/roles` - Select and switch roles
- `/tools` - List available tools for current role
- `/model <name>` - Change Claude model
- `/status` - Show current status
- `/help` - Show help
- `/quit` - Exit

### Sub-Agent Mode
```bash
# Simple query
aegis-cli "What is 2+2?"

# With specific role
aegis-cli --role mentor "Review this code"

# JSON output for orchestration
aegis-cli --role frontend --json "Create a button"

# Read from stdin
echo "Explain this" | aegis-cli --role mentor
```

## Key Type Definitions

### Role (`src/types/router-types.ts`)
```typescript
interface Role {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  description: string;           // Role description
  allowedServers: string[];      // Allowed MCP servers (* for all)
  systemInstruction: string;     // System prompt for this role
  toolPermissions?: ToolPermissions;
  metadata?: RoleMetadata;
}
```

### SkillDefinition (`src/types/router-types.ts`)
```typescript
interface SkillDefinition {
  id: string;                   // Skill identifier
  displayName: string;          // Display name
  description: string;          // Skill description
  allowedRoles: string[];       // Roles that can use this skill
  allowedTools: string[];       // Tools this skill requires
  metadata?: SkillMetadata;
}
```

## Configuration

### Server Configuration (`config.json`)
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"]
    },
    "aegis-skills": {
      "command": "node",
      "args": ["node_modules/aegis-skills/index.js", "..."]
    }
  }
}
```

### MCP Integration (`.mcp.json`)
```json
{
  "mcpServers": {
    "aegis-router": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "env": {
        "AEGIS_CONFIG_PATH": "config.json"
      }
    }
  }
}
```

## Environment Variables

- `AEGIS_ROUTER_PATH` - Path to MCP server (default: `dist/mcp-server.js`)
- `AEGIS_CONFIG_PATH` - Path to config file (default: `config.json`)
- `AEGIS_CLI_PATH` - Path to CLI for sub-agent spawning
- `ANTHROPIC_API_KEY` - API key for direct API usage (optional)

## Testing

Tests use Vitest and are located in `tests/`:

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/role-manager.test.ts

# Watch mode
npm run test:watch
```

### Test Categories
- **Unit tests**: RoleManager, ToolVisibilityManager
- **Integration tests**: Skill integration, role switching
- **E2E tests**: Full flow with aegis-skills server

## Important Patterns

### Tool Name Format
Tools are prefixed with their server name:
- `filesystem__read_file` (from filesystem server)
- `aegis-skills__list_skills` (from aegis-skills server)

### Role Switching Flow
1. Agent calls `set_role` with `role_id`
2. Router validates role exists
3. Router starts required servers if needed (lazy loading)
4. Router updates `currentRole` and filters tools
5. Router sends `tools/list_changed` notification
6. Agent receives new tool list

### Permission Checking
1. Check if server is allowed for role
2. Check tool-level permissions (allow/deny patterns)
3. System tools (`set_role`) always allowed

## Code Style and Conventions

- **TypeScript**: Strict mode enabled, ES2022 target
- **Module system**: ESM (NodeNext resolution)
- **Imports**: Use `.js` extension for local imports
- **Naming**:
  - Classes: PascalCase (e.g., `RoleManager`)
  - Functions: camelCase (e.g., `createRoleManager`)
  - Constants: UPPER_SNAKE_CASE (e.g., `TIMEOUTS`)
- **Comments**: JSDoc for public APIs, Japanese comments in architecture docs

## Related Projects

- [Aegis-skills](https://github.com/Shin0205go/Aegis-skills) - Skill MCP Server that provides skill definitions
- [Claude Agent SDK](https://github.com/anthropics/claude-code) - Anthropic's agent SDK

## Common Tasks

### Adding a New Backend Server
1. Add configuration to `config.json` under `mcpServers`
2. Server will be auto-discovered on router startup
3. Tools will be prefixed with server name

### Creating a New Role
Roles are auto-generated from skill definitions. To add a new role:
1. Create/modify skill in aegis-skills with `allowedRoles` including new role
2. Restart router to reload skill manifest
3. Role will be available via `set_role`

### Debugging
- Set log level in Logger constructor
- Check `logs/` directory for output
- Use `--json` flag for structured output in sub-agent mode
