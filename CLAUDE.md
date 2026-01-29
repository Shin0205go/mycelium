# CLAUDE.md - Mycelium-CLI Codebase Guide

This document provides guidance for AI assistants working with the Mycelium-CLI codebase.

## Project Overview

Mycelium-CLI is a **skill-driven autonomous AI agent system** that integrates Claude Agent SDK with Model Context Protocol (MCP) servers. It provides **session-based dynamic skill management** with **policy-in-the-loop** security.

### Why Mycelium?

Problems with traditional coding agents (Claude Code, Cursor, etc.):
- **Too much access**: All tools available, even those unnecessary for the task
- **Context pollution**: Context grows with irrelevant operations
- **Approval fatigue**: Human-in-the-loop requires confirmation for every action

Mycelium's approach:
- **Policy-in-the-loop**: Policies automatically control tool access (no approval needed)
- **Dynamic skill management**: Enable only the skills needed, when needed
- **Clean context**: Only task-relevant tools are visible

### Key Concepts

- **MCP (Model Context Protocol)**: Anthropic's protocol for tool/resource integration
- **Skill**: A combination of tool set + system prompt
- **Policy-in-the-loop**: Policies automatically control access without human approval
- **Session-based Skill Management**: Dynamically add/remove skills during a session

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Claude Desktop / Cursor                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Uses mycelium-router as MCP server                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ stdio (MCP protocol)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    @mycelium/core (MCP Server)                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  MyceliumCore (packages/core/src/router/mycelium-core.ts)    │   │
│  │  - Routes tool calls to backend MCP servers                  │   │
│  │  - Provides 7 system tools (ROUTER_TOOLS)                    │   │
│  │  - Manages roles, skills, and tool visibility                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ToolVisibilityManager (packages/core/src/rbac/)             │   │
│  │  - Filters tools based on active skills and roles            │   │
│  │  - Unauthorized tools are completely hidden (not rejected)   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ spawns & routes to
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Backend MCP Servers                             │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐              │
│  │ mycelium-     │ │ mycelium-     │ │ mycelium-     │              │
│  │ skills        │ │ session       │ │ sandbox       │              │
│  │ (31 skills)   │ │ (persistence) │ │ (execution)   │              │
│  └───────────────┘ └───────────────┘ └───────────────┘              │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐              │
│  │ filesystem    │ │ playwright    │ │ shell         │              │
│  │ (MCP stdlib)  │ │ (browser)     │ │ (commands)    │              │
│  └───────────────┘ └───────────────┘ └───────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

### System Tools (ROUTER_TOOLS)

The MyceliumCore router provides 7 built-in system tools:

| Tool | Description |
|------|-------------|
| `mycelium-router__get_context` | Get current role, skills, and visible tools |
| `mycelium-router__list_roles` | List all available roles |
| `mycelium-router__set_role` | Switch the current role |
| `mycelium-router__list_skills` | List all skill definitions |
| `mycelium-router__get_active_skills` | Get currently active skills |
| `mycelium-router__set_active_skills` | Activate/filter skills |
| `mycelium-router__suggest_skills` | Suggest skills based on intent |

## Directory Structure

```
mycelium/
├── packages/
│   ├── cli/                      # @mycelium/cli - Command-Line Interface
│   │   └── src/
│   │       ├── index.ts          # CLI entry (Commander.js)
│   │       ├── commands/
│   │       │   ├── server.ts     # mycelium server (standalone MCP)
│   │       │   └── client.ts     # mycelium client (thin client)
│   │       └── lib/
│   │           ├── config.ts     # Configuration loading
│   │           ├── mcp-client.ts # MCP client utilities
│   │           └── ui.ts         # UI helpers (chalk, ora)
│   │
│   ├── core/                     # @mycelium/core - MCP Router & RBAC
│   │   └── src/
│   │       ├── mcp-server.ts     # Main MCP server entry point
│   │       ├── router/
│   │       │   ├── mycelium-core.ts      # Central routing engine
│   │       │   ├── router-adapter.ts     # Tool adapter layer
│   │       │   └── remote-prompt-fetcher.ts
│   │       ├── rbac/
│   │       │   ├── tool-visibility-manager.ts  # Skill-based filtering
│   │       │   ├── role-manager.ts       # Role management
│   │       │   └── role-memory.ts        # Role persistence
│   │       ├── mcp/
│   │       │   ├── stdio-router.ts       # Backend communication
│   │       │   ├── tool-discovery.ts     # Tool discovery
│   │       │   └── dynamic-tool-discovery.ts
│   │       ├── types/
│   │       │   ├── router-types.ts
│   │       │   └── mcp-types.ts
│   │       └── utils/
│   │           └── logger.ts
│   │
│   ├── skills/                   # @mycelium/skills - Skill MCP Server
│   │   ├── src/
│   │   │   └── index.ts          # MCP server (get_skill, run_script)
│   │   └── skills/               # 31 skill definitions
│   │       ├── common/SKILL.yaml
│   │       ├── code-modifier/SKILL.yaml
│   │       ├── git-workflow/SKILL.yaml
│   │       ├── test-runner/SKILL.yaml
│   │       └── ... (27 more)
│   │
│   ├── session/                  # @mycelium/session - Session Persistence
│   │   └── src/
│   │       ├── mcp-server.ts
│   │       ├── session-store.ts  # Markdown-based storage
│   │       └── types.ts
│   │
│   ├── sandbox/                  # @mycelium/sandbox - Sandboxed Execution
│   │   └── src/
│   │       ├── mcp-server.ts
│   │       ├── sandbox-manager.ts
│   │       ├── executor.ts       # Base interface
│   │       ├── linux-executor.ts # bwrap/firejail
│   │       ├── darwin-executor.ts # sandbox-exec
│   │       └── docker-executor.ts
│   │
│   └── shared/                   # @mycelium/shared - Common Types
│       └── src/
│           ├── index.ts          # Role, Skill, Tool types
│           └── config/
│               └── env-loader.ts
│
├── docs/                         # Integration documentation
├── .claude/                      # Claude Desktop settings
├── config.json                   # MCP server configuration
├── .mcp.json                     # MCP router test configuration
├── package.json                  # Monorepo root
├── setup-env.sh                  # Environment setup
├── CLAUDE.md                     # This file
└── README.md
```

## CLI Usage

### Starting the MCP Server (for Claude Desktop/Cursor)

```bash
# Start standalone MCP server (stdio mode)
mycelium server

# Or via npm
npm run start:mcp
```

### Configuration for Claude Desktop

Add to Claude Desktop's MCP configuration:

```json
{
  "mcpServers": {
    "mycelium-router": {
      "command": "node",
      "args": ["/path/to/mycelium/packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "/path/to/mycelium/config.json"
      }
    }
  }
}
```

## Configuration

### config.json

Main configuration file for backend MCP servers:

```json
{
  "mcpServers": {
    "mycelium-skills": {
      "command": "node",
      "args": ["packages/skills/dist/index.js", "packages/skills/skills"]
    },
    "mycelium-session": {
      "command": "node",
      "args": ["packages/session/dist/mcp-server.js", "sessions"]
    },
    "mycelium-sandbox": {
      "command": "node",
      "args": ["packages/sandbox/dist/mcp-server.js"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "shell": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-shell"]
    }
  },
  "roles": {
    "defaultRole": "default"
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Claude (required for agent mode) |
| `MYCELIUM_CONFIG_PATH` | Path to config.json |
| `MYCELIUM_CURRENT_ROLE` | Initial role to set on startup |

## Development Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Start CLI in development mode
npm run dev

# Start MCP server in development mode
npm run dev:mcp

# Run production MCP server
npm run start:mcp

# Direct invocation
npm run myc
```

### Package-Specific Scripts

```bash
# Core package
npm run dev:mcp --workspace=@mycelium/core
npm test --workspace=@mycelium/core

# Skills package
npm run dev --workspace=@mycelium/skills

# CLI package
npm run dev --workspace=@mycelium/cli
```

## Skill Definition Format

Skills are defined in YAML files (`packages/skills/skills/*/SKILL.yaml`):

```yaml
name: skill-id
description: What this skill enables

# Roles that can use this skill
allowedRoles:
  - developer
  - admin

# MCP tools granted by this skill (format: server__tool)
allowedTools:
  - filesystem__read_file
  - filesystem__write_file
  - mycelium-sandbox__bash

# Keywords for auto-detection (optional)
triggers:
  - edit
  - modify
  - refactor

# Capability grants (optional)
grants:
  - memory:read
  - memory:write

# Agent identity rules (optional)
identity:
  - pattern: "*.developer"
```

### Available Skills (31 total)

**Core Skills:**
- `common` - Base tools for all roles
- `orchestrator` - Task coordination
- `adhoc-tools` - Full access for investigation

**Development Skills:**
- `code-modifier` - Read/write code, refactor
- `code-reviewer` - Code review analysis
- `git-workflow` - Git operations
- `build-check` - Build verification
- `test-runner` - Run vitest tests

**Content & Document Skills:**
- `doc-coauthoring` - Document collaboration
- `doc-updater` - Update documentation
- `docx` / `docx-handler` - DOCX operations
- `pdf` - PDF manipulation
- `pptx` - PowerPoint handling
- `xlsx` - Excel/spreadsheet handling

**Design & Creative Skills:**
- `algorithmic-art` - Algorithmic art generation
- `brand-guidelines` - Brand compliance
- `canvas-design` - Canvas-based design
- `frontend-design` - UI/UX design
- `theme-factory` - Theme generation
- `web-artifacts-builder` - Web component creation

**Testing & Analysis Skills:**
- `data-analyst` / `data-analyzer` - Data analysis
- `browser-testing` / `webapp-testing` - Browser/web app testing

**Admin Skills:**
- `session-management` - Session handling
- `skill-admin` - Skill administration
- `skill-creator` - Create new skills
- `mcp-builder` - Build MCP servers

## Design Philosophy

### Core Principles

1. **Policy-in-the-loop**: No approval prompts; policies auto-decide
2. **Least privilege**: Minimal tools by default, escalate when needed
3. **Transparency**: Notify on skill changes
4. **Reversibility**: Skills can be escalated and de-escalated

### Tool Visibility Strategy

```
AI Request
    │
    ▼
┌─────────────────────────────────────┐
│  ToolVisibilityManager              │
│  - Check current role               │
│  - Get active skills                │
│  - Filter tools by allowedTools     │
│  - Hidden tools = don't exist       │
└─────────────────────────────────────┘
    │
    ▼
Only allowed tools visible to AI
(Not "rejected" - they simply don't exist)
```

**Key insight**: Unauthorized tools are not rejected - they are completely hidden. The AI cannot even attempt to use them because it doesn't know they exist.

### Skill-Based RBAC: Total Non-Existence

1. **Declaration is the Single Source of Truth**: Only tools explicitly listed in `allowedTools` exist in the system
2. **Total Non-Existence for Unauthorized Tools**: Tools not in the whitelist have no ID, no description, no parameters visible
3. **No Bypass by Design**: All tool calls go through the router; undeclared tools are immediately rejected
4. **Fail-Safe by Ignorance**: Invalid skill declarations are silently dropped; no information leaks to AI
5. **Least Privilege by Construction**: Roles use intersection of skill declarations, not union

## Testing

The project uses **Vitest** for testing:

```bash
# Run all tests
npm test

# Run tests with watch mode
npm test -- --watch

# Run specific package tests
npm test --workspace=@mycelium/core
```

### Test Files

```
packages/core/tests/
├── mycelium-core.test.ts        # Integration tests
├── tool-discovery.test.ts       # Tool discovery
├── stdio-router.test.ts         # Backend communication
├── router-adapter.test.ts       # Adapter layer
├── mcp-server.test.ts           # MCP server
└── ...

packages/cli/tests/cli.test.ts
packages/skills/tests/index.test.ts
packages/session/tests/session-store.test.ts
packages/sandbox/tests/index.test.ts
packages/shared/tests/index.test.ts
```

## Code Style

- **TypeScript**: Strict mode, ES2022
- **Module**: ESM (NodeNext)
- **Naming**: PascalCase (classes), camelCase (functions/variables)
- **Testing**: Vitest with globals enabled

### Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | 0.1.76 | Claude Agent integration |
| `@modelcontextprotocol/sdk` | 1.0.0 | MCP protocol implementation |
| `commander` | 12.0.0 | CLI framework |
| `chalk` | 5.3.0 | Terminal colors |
| `ora` | 8.2.0 | Spinners |
| `yaml` / `js-yaml` | 2.3.4 / 4.1.1 | YAML parsing |
| `zod` | 4.2.1 | Schema validation |
| `winston` | 3.11.0 | Logging |

## Implementation Status

### Completed
- [x] MCP router with tool routing (`@mycelium/core`)
- [x] 31 skill definitions (`@mycelium/skills`)
- [x] Skill-based tool filtering (`ToolVisibilityManager`)
- [x] Role management and switching
- [x] Standalone MCP server mode for Claude Desktop
- [x] Sandbox execution (Linux/macOS/Docker)
- [x] Session persistence (Markdown format)
- [x] Protected skills (prevent de-escalation)
- [x] Dynamic skill loading from disk

### In Progress / Planned
- [ ] Intent-based automatic skill detection
- [ ] Skill load-time strict validation (invalidate unknown tools)
- [ ] `preview skill` command (show diff before activation)
- [ ] File watcher + auto-reload
- [ ] Statistics display (hidden tools count, active skills)

## Best Practices

### Skill Design

```yaml
# Good: Minimal required tools
name: reader
allowedTools:
  - filesystem__read_file
  - filesystem__list_directory

# Bad: Overly broad permissions
name: file-all
allowedTools:
  - filesystem__*  # Wildcards not supported; list explicitly
```

### Security Guidelines

1. **Default to minimal access**: Base skills should be read-only
2. **Limit roles**: Restrict which skills each role can use
3. **Use de-escalation**: Remove skills when no longer needed
4. **Log changes**: Track skill activation/deactivation history

### Adding a New Skill

1. Create directory: `packages/skills/skills/<skill-name>/`
2. Add `SKILL.yaml` with name, description, allowedRoles, allowedTools
3. Optionally add triggers for auto-detection
4. Rebuild: `npm run build --workspace=@mycelium/skills`
5. Test: Verify skill appears in `mycelium-router__list_skills`

### Adding a New Backend MCP Server

1. Add server configuration to `config.json` under `mcpServers`
2. Specify command and args to start the server
3. Tools from the server become available (prefix: `server-name__tool-name`)
4. Create skills that reference the new tools
