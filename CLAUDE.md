# CLAUDE.md - Mycelium-CLI Codebase Guide

This document provides guidance for AI assistants working with the Mycelium-CLI codebase.

## Project Overview

Mycelium-CLI is a **skill-driven autonomous AI agent system** that integrates Claude Agent SDK with Model Context Protocol (MCP) servers. It provides dynamic role-based tool filtering to improve agent **focus**, **context management**, and **reproducibility**.

### Why Mycelium?

従来のコーディングエージェント（Claude Code、Cursor等）の課題：
- **なんでもできる**: 全ツールにアクセス可能で、タスクに不要なツールも使える
- **コンテキストが汚れる**: 無関係な操作でコンテキストが肥大化
- **再現性が低い**: 同じプロンプトでも異なる結果になりやすい

Myceliumのアプローチ：
- **スキルベースの制限**: エージェントは必要なツールのみにアクセス
- **クリーンなコンテキスト**: タスクに関連する操作のみ実行
- **高い再現性**: 制限されたツールセットで一貫した動作

### Key Concepts

- **MCP (Model Context Protocol)**: Anthropic's protocol for tool/resource integration
- **Skill-Driven RBAC**: Skills declare which roles can use them; roles are dynamically generated from skill definitions
- **Router Proxy**: Routes tool calls from Claude to appropriate backend MCP servers
- **Role-Based Agents**: Agents are spawned with specific roles via `MYCELIUM_CURRENT_ROLE` environment variable
- **Interactive CLI**: REPL interface with Claude Agent SDK for role-aware conversations

## MYCELIUM Design Philosophy

### Core Principles

1. **Workflow優先**: 全タスクはまずWorkflow Agent（制限付き）で実行。Adhocは例外的使用のみ
2. **スキルベース制限**: エージェントは必要最小限のツールのみアクセス可能
3. **コンテキスト保護**: 不要なツール呼び出しを防ぎ、コンテキストをクリーンに保つ
4. **高い再現性**: 同じスキル＋同じプロンプト＝一貫した結果

### Architecture Rules

- **Inverted RBAC**: Roles are NOT defined manually. Skills declare `allowedRoles`.
- **Trust Boundary**: The Router implies the Agent's identity; the Agent does not claim it.
- **Source of Truth**: The MCP Server (@mycelium/skills) is the only source of permission logic.
- **Minimal Access**: Agents should have access only to tools required for their specific task.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 @mycelium/skills (MCP Server)                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skill: docx-handler                                 │   │
│  │  - allowedRoles: [formatter, admin]  ← 明示的ロール  │   │
│  │  - allowedTools: [filesystem__read, docx__parse]     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skill: session-management                           │   │
│  │  - allowedRoles: ["*"]  ← ワイルドカードで全ロール   │   │
│  │  - allowedTools: [mycelium-session__*]               │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ list_skills
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                 @mycelium/core (Router)                        │
│  ├── RoleManager        (スキル→ロール変換)                  │
│  │   └── Two-pass processing for "*" expansion              │
│  ├── ToolVisibilityManager (ロール別ツールフィルタ)         │
│  └── StdioRouter        (MCPサーバー接続管理)               │
│                                                              │
│  Skills → Roles 変換（Inverted RBAC）                       │
│  - allowedRoles: ["*"] → 全ロールに展開                     │
│  - allowedTools: [server__*] → ワイルドカードマッチ          │
└───────────────────────┬─────────────────────────────────────┘
                        │ spawn_sub_agent / MCP tools
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              @mycelium/cli (Interactive REPL)                 │
│  - /roles, /skills, /tools → MCP tools経由                  │
│  - /status → get_context MCP tool                           │
│  - Claude Agent SDK統合                                     │
└─────────────────────────────────────────────────────────────┘
```

### Workflow / Adhoc Agent Architecture

Myceliumは2つの実行モードを提供します：**Workflow**（制限付き）と**Adhoc**（全アクセス）。

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Request                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│               Workflow Agent (orchestrator role)                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Allowed Tools:                                           │  │
│  │  - mycelium-skills__list_skills                           │  │
│  │  - mycelium-skills__get_skill                             │  │
│  │  - mycelium-skills__run_script  ← スキルスクリプトのみ    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  RBAC Enforcement: allowedTools: ['mcp__mycelium-router__*']    │
│  System Role: MYCELIUM_CURRENT_ROLE=orchestrator                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
          Success                      Failure
              │                           │
              ▼                           ▼
┌─────────────────────┐     ┌─────────────────────────────────────┐
│   Task Complete     │     │  Context Saved (.mycelium/context/) │
└─────────────────────┘     │  - skillId, scriptPath, args        │
                            │  - exitCode, stdout, stderr         │
                            │  - conversationSummary              │
                            └───────────────────┬─────────────────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        │                       │                       │
                   --on-failure=            --on-failure=          --on-failure=
                      prompt                   auto                   exit
                        │                       │                       │
                        ▼                       ▼                       ▼
              ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
              │ Show command:   │    │ Auto-escalate   │    │ Exit with       │
              │ mycelium adhoc  │    │ to Adhoc Agent  │    │ error code      │
              │ --context <path>│    │                 │    │                 │
              └─────────────────┘    └─────────────────┘    └─────────────────┘
                        │
                        │ User manually runs
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Adhoc Agent (adhoc role)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Allowed Tools: ALL (via mycelium-router)                 │  │
│  │  - filesystem__read_file, filesystem__write_file          │  │
│  │  - git__*, shell__*, sandbox__exec                        │  │
│  │  - mycelium-skills__*, mycelium-session__*                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Context Injection: 失敗コンテキストをシステムプロンプトに注入  │
│  System Role: MYCELIUM_CURRENT_ROLE=adhoc                       │
└─────────────────────────────────────────────────────────────────┘
```

#### Design Principles

| 原則 | Workflow Agent | Adhoc Agent |
|------|----------------|-------------|
| **ツールアクセス** | スキルスクリプトのみ | 全ツール |
| **用途** | 定型タスク、自動化 | 調査、デバッグ、修正 |
| **RBAC Role** | `orchestrator` | `adhoc` |
| **コンテキスト** | クリーン（制限付き） | 汚れやすい（全アクセス） |
| **再現性** | 高い（制限されたツールセット） | 低い（自由度が高い） |
| **承認フロー** | 不要 | 危険操作時に必要 |

**Workflow優先の設計思想**:
- 通常タスクは必ずWorkflow Agentで実行（制限付き、再現性高い）
- Adhoc Agentは調査・デバッグ専用（例外的な使用）
- 失敗時のみAdhocにエスカレーション（段階的アクセス拡大）

#### Workflow → Adhoc Handoff

When a workflow script fails, context is saved for Adhoc agent investigation:

```typescript
// packages/cli/src/lib/context.ts
interface WorkflowContext {
  /** Skill ID that was executed */
  skillId: string;

  /** Path to the script within the skill */
  scriptPath: string;

  /** Arguments passed to the script */
  args?: string[];

  /** Error details from the failed execution */
  error: {
    message: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  };

  /** ISO8601 timestamp of when the failure occurred */
  timestamp: string;

  /** Optional summary of the conversation before failure */
  conversationSummary?: string;

  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
}
```

**Context File Operations**:
```typescript
import { writeContext, readContext, formatContextForDisplay } from '@mycelium/cli';

// Save context on workflow failure
const contextPath = await writeContext(context, './workflow-context.json');

// Load context in adhoc agent
const context = await readContext(contextPath);

// Display context to user
console.log(formatContextForDisplay(context));
```

このパターンにより：
1. **最小権限の原則**: 通常タスクは制限付きWorkflowで実行
2. **段階的エスカレーション**: 失敗時のみAdhocで調査
3. **コンテキスト継続**: 失敗情報を引き継いで効率的なデバッグ

## Directory Structure

Mycelium is organized as a monorepo with modular packages:

```
packages/
├── cli/                  # @mycelium/cli - Command-Line Interface
│   └── src/
│       ├── index.ts              # CLI entry point (mycelium command)
│       ├── commands/
│       │   ├── init.ts           # mycelium init - project scaffolding
│       │   ├── skill.ts          # mycelium skill add/list/templates
│       │   ├── policy.ts         # mycelium policy check/roles
│       │   ├── mcp.ts            # mycelium mcp start/status/stop
│       │   ├── workflow.ts       # mycelium workflow - skill-based workflows
│       │   └── adhoc.ts          # mycelium adhoc - full tool access
│       ├── agents/
│       │   ├── workflow-agent.ts # Skill-restricted workflow agent
│       │   └── adhoc-agent.ts    # Unrestricted adhoc agent with approval workflow
│       └── lib/
│           ├── interactive-cli.ts # REPL with dynamic command generation
│           ├── mcp-client.ts      # MCP client wrapper
│           ├── context.ts         # Workflow → Adhoc context handoff
│           ├── agent.ts           # Agent utilities
│           └── ui.ts              # UI utilities (chalk formatting)
│
├── shared/               # @mycelium/shared - Common types and interfaces
│   └── src/
│       └── index.ts      # Role, ToolPermissions, SkillManifest types
│
├── core/                 # @mycelium/core - Integration Layer (RBAC + MCP Proxy)
│   ├── src/
│   │   ├── index.ts              # Re-exports all packages
│   │   ├── mcp-server.ts         # MCP server entry point
│   │   ├── mcp-client.ts         # MCP client implementation
│   │   ├── agent.ts              # Agent SDK integration
│   │   ├── sub-agent.ts          # Sub-agent spawning utilities
│   │   ├── rbac/
│   │   │   ├── role-manager.ts           # Role definitions and permissions
│   │   │   ├── tool-visibility-manager.ts # Tool filtering by role
│   │   │   └── role-memory.ts            # Role-based memory store
│   │   ├── router/
│   │   │   ├── mycelium-core.ts          # Central routing system (司令塔)
│   │   │   ├── router-adapter.ts         # Router adapter for MCP server
│   │   │   └── remote-prompt-fetcher.ts  # Fetch prompts from remote servers
│   │   ├── mcp/
│   │   │   ├── stdio-router.ts           # Stdio-based MCP routing
│   │   │   ├── tool-discovery.ts         # Tool discovery
│   │   │   └── dynamic-tool-discovery.ts # Dynamic tool discovery
│   │   ├── types/
│   │   │   ├── index.ts                  # Type re-exports
│   │   │   ├── mcp-types.ts              # MCP-specific types
│   │   │   └── router-types.ts           # Router-specific types
│   │   ├── constants/
│   │   │   └── index.ts                  # Shared constants
│   │   └── utils/
│   │       └── logger.ts                 # Winston logger
│   └── tests/
│       ├── mycelium-core.test.ts
│       ├── router-adapter.test.ts
│       ├── stdio-router.test.ts
│       ├── mcp-server.test.ts
│       ├── mcp-client.test.ts
│       ├── agent.test.ts
│       ├── sub-agent.test.ts
│       └── ...
│
├── orchestrator/         # @mycelium/orchestrator - Worker Agent Management
│   ├── src/
│   │   ├── index.ts              # Package exports
│   │   ├── orchestrator.ts       # Worker lifecycle management
│   │   └── types.ts              # Worker, Task, Result types
│   └── tests/
│       └── orchestrator.test.ts
│
├── adhoc/                # @mycelium/adhoc - Unrestricted Agent for Edge Cases
│   ├── src/
│   │   ├── index.ts              # Package exports
│   │   ├── adhoc-agent.ts        # Adhoc agent with approval workflow
│   │   └── types.ts              # Adhoc types, DANGEROUS_TOOL_CATEGORIES
│   └── tests/
│       └── adhoc-agent.test.ts
│
├── skills/               # @mycelium/skills - Skill MCP Server
│   └── src/
│       └── index.ts      # Skill definition loading and serving
│
├── session/              # @mycelium/session - Session Management
│   └── src/
│       ├── index.ts              # Package exports
│       ├── mcp-server.ts         # Session MCP server
│       ├── session-store.ts      # Session persistence store
│       └── types.ts              # Session types
│
└── sandbox/              # @mycelium/sandbox - Sandboxed Execution
    └── src/
        ├── index.ts              # Package exports
        ├── mcp-server.ts         # Sandbox MCP server
        ├── sandbox-manager.ts    # Sandbox lifecycle management
        ├── executor.ts           # Command executor interface
        ├── linux-executor.ts     # Linux sandbox (bubblewrap)
        ├── darwin-executor.ts    # macOS sandbox (sandbox-exec)
        ├── docker-executor.ts    # Docker-based sandbox
        └── types.ts              # Sandbox types
```

## Packages

| Package | Description | 設計思想との関係 |
|---------|-------------|-----------------|
| `@mycelium/cli` | Command-line interface with workflow/adhoc modes | **エントリーポイント**: Workflow優先の実行フロー |
| `@mycelium/shared` | Common types and interfaces | 型定義の一元管理 |
| `@mycelium/core` | Integration layer with RBAC, MCP proxy | **中核**: ツールフィルタリングによるコンテキスト保護 |
| `@mycelium/orchestrator` | Worker agent management | **並列実行**: スキル単位でワーカーを分離 |
| `@mycelium/adhoc` | Unrestricted agent for edge cases | **例外処理**: 調査・デバッグ専用 |
| `@mycelium/skills` | Skill MCP Server | **ツール定義**: 最小限のツールセットを宣言 |
| `@mycelium/session` | Session persistence | 会話状態の保存・復元 |
| `@mycelium/sandbox` | OS-level sandboxed execution | 安全なコード実行環境 |

## Key Components

### 1. RoleManager (`packages/core/src/rbac/role-manager.ts`)
Handles role definitions and permission checking:
- Loads roles dynamically from skill manifests
- Generates roles from skill definitions (inverted RBAC)
- **Two-pass processing** for `allowedRoles: ["*"]` wildcard expansion
- Checks server/tool permissions for roles
- Supports wildcard (`*`) and pattern matching for tools (`server__*`)
- Role inheritance with `getEffectiveServers()`, `getEffectiveToolPermissions()`
- Memory permission inheritance with `getEffectiveMemoryPermission()`

### 2. ToolVisibilityManager (`packages/core/src/rbac/tool-visibility-manager.ts`)
Manages tool discovery and role-based visibility:
- Registers tools from backend servers
- Filters visible tools based on current role
- Includes system tools for context and role management
- Checks tool access before allowing calls

### 3. RoleMemoryStore (`packages/core/src/rbac/role-memory.ts`)
Transparent Markdown-based memory system per role:
- Role-isolated memory (each role has separate memory)
- Human-readable Markdown files for transparency
- Memory types: fact, preference, context, episode, learned
- Search and recall functionality
- Inspired by Claude's file-based memory approach

### 4. Orchestrator (`packages/orchestrator/src/orchestrator.ts`)
Worker agent management with skill-based restrictions:
- Spawn workers with specific skill constraints
- Workers only access tools permitted by their skill
- Task delegation and result collection
- Worker lifecycle management (spawn, execute, terminate)
- Parallel worker execution support

### 5. AdhocAgent (`packages/cli/src/agents/adhoc-agent.ts`)
Unrestricted agent for edge cases with approval workflow:
- Full tool access through mycelium-router with `adhoc` role
- Interactive approval workflow for dangerous operations
- Risk level classification: `low`, `medium`, `high`, `critical`
- Session-based approval caching (`always`/`never` options)
- Context injection from failed workflow execution
- For investigation, debugging, and one-off fixes

**Dangerous Tool Categories**:
```typescript
const DANGEROUS_TOOL_CATEGORIES = {
  FILE_WRITE: ['filesystem__write_file', 'filesystem__delete_file'],
  SHELL_EXEC: ['shell__exec', 'bash__run', 'sandbox__exec'],
  NETWORK: ['http__request', 'fetch__url'],
  DATABASE: ['postgres__execute', 'database__write'],
};
```

**Approval Options**:
- `y/yes` - Approve once
- `n/no` - Deny once
- `always` - Always approve this tool in this session
- `never` - Never approve this tool in this session

### 6. MyceliumCore (`packages/core/src/router/mycelium-core.ts`)
Central routing system (司令塔) that orchestrates all components:
- Manages connections to multiple sub-MCP servers via StdioRouter
- Maintains virtual tool table filtered by current role
- Integrates RoleManager, ToolVisibilityManager, and RoleMemoryStore
- Loads roles dynamically from mycelium-skills server
- Provides router-level tools: `get_context`, `list_roles`, `spawn_sub_agent`
- Handles memory tools: `save_memory`, `recall_memory`, `list_memories`

### 7. WorkflowContext (`packages/cli/src/lib/context.ts`)
Handles Workflow → Adhoc agent handoff:
- Saves failure context when workflow scripts fail
- Provides context to Adhoc agent for investigation
- Includes error details, stdout/stderr, and conversation summary

### 8. InteractiveCLI (`packages/cli/src/lib/interactive-cli.ts`)
REPL interface with MCP-driven command system:
- Connects to MYCELIUM Router via MCP
- **Built-in commands use MCP tools**:
  - `/skills` → `mycelium-skills__list_skills` MCP tool (with fallback to `list_roles`)
  - `/status` → `mycelium-router__get_context` MCP tool
  - `/roles` → `mycelium-router__list_roles` MCP tool
- Dynamic skill commands loaded via `loadSkillCommands()`
- Auto-generated tool commands via `registerToolCommands()`
- Role selection with arrow-key navigation
- Model switching (Haiku, Sonnet, Opus)
- Claude Agent SDK integration for streaming responses

### 9. MCPClient (`packages/cli/src/lib/mcp-client.ts`)
MCP client wrapper for Router communication:
- JSON-RPC over stdio communication
- **Double-nested response unwrapping** via `unwrapToolResponse()`
- Tool call methods: `listTools()`, `callTool()`, `listSkills()`, `listCommands()`
- Role management: `listRoles()`, `switchRole()`, `getContext()`
- Automatic initialization with `initialized` notification

### 10. Shared Types (`packages/shared/src/index.ts`)
Common types used across all packages:
- `Role`, `ToolPermissions`, `RoleMetadata`
- `BaseSkillDefinition`, `SkillManifest`, `SkillGrants`
- `Logger` interface for dependency injection
- Error classes: `RoleNotFoundError`, `ToolNotAccessibleError`

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

The MYCELIUM CLI (`@mycelium/cli`) provides multiple commands for project management and interactive use.

### Project Management Commands

```bash
# Initialize a new MYCELIUM project
mycelium init [directory]
mycelium init --minimal          # Without example skills

# Manage skills
mycelium skill add <name>                    # Add new skill from template
mycelium skill add <name> --template <tpl>   # Use specific template
mycelium skill list                          # List all skills
mycelium skill templates                     # Show available templates

# Available skill templates:
#   basic, browser-limited, code-reviewer, data-analyst,
#   flight-booking, personal-assistant

# Policy verification
mycelium policy check --role <role>          # Check permissions for role
mycelium policy roles                        # List all available roles

# MCP server management
mycelium mcp start                           # Start MCP server
mycelium mcp start --dev                     # Development mode (tsx)
mycelium mcp start --background              # Run in background
mycelium mcp status                          # Check server status (PID, port)
mycelium mcp stop                            # Stop running MCP server
```

### Workflow Mode (Skill-Restricted)
```bash
# Run skill-based workflows (limited to skill scripts)
mycelium workflow                    # Start interactive workflow mode
mycelium workflow "task"             # Execute a single workflow task
mycelium workflow --list             # List available skills
mycelium workflow --on-failure=auto  # Auto-escalate to adhoc on failure
mycelium workflow --on-failure=exit  # Exit on failure (for CI)

# On failure, context is saved for adhoc investigation
# mycelium adhoc --context <file>
```

### Adhoc Mode (Full Access)
```bash
# Full tool access for investigation and fixes
mycelium adhoc                       # Start interactive adhoc mode
mycelium adhoc "investigate"         # Execute a single task
mycelium adhoc --context <file>      # Load context from workflow failure
```

### Interactive Mode (Default)
```bash
mycelium                          # Start interactive chat
mycelium --role developer         # Start with specific role
mycelium --model claude-sonnet-4-5-20250929  # Use specific model
```

REPL Commands:
- `/roles` - Select and switch roles (with arrow-key navigation)
- `/skills` - List skills available for current role (uses MCP tool)
- `/tools` - List available tools for current role
- `/model <name>` - Change Claude model
- `/status` - Show current status via MCP (role, model, tools count)
- `/help` - Show help
- `/quit` - Exit

Session Management Commands:
- `/save [name]` - Save current session
- `/sessions` - List saved sessions
- `/resume <id>` - Resume a saved session
- `/compress <id>` - Compress session to reduce size
- `/fork <id>` - Fork session from a point
- `/export <id>` - Export session (markdown, JSON, HTML)

### Sub-Agent Mode
```bash
# Simple query
mycelium-cli "What is 2+2?"

# With specific role
mycelium-cli --role mentor "Review this code"

# JSON output for orchestration
mycelium-cli --role frontend --json "Create a button"

# Read from stdin
echo "Explain this" | mycelium-cli --role mentor
```

## Key Type Definitions

### Role (`packages/shared/src/index.ts`)
```typescript
interface Role {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  description: string;           // Role description
  inherits?: string;             // Parent role ID for inheritance
  allowedServers: string[];      // Allowed MCP servers (* for all)
  systemInstruction: string;     // System prompt for this role
  toolPermissions?: ToolPermissions;
  metadata?: RoleMetadata;
}
```

### SkillDefinition (`packages/shared/src/index.ts`)
```typescript
interface BaseSkillDefinition {
  id: string;                   // Skill identifier
  displayName: string;          // Display name
  description: string;          // Skill description
  allowedRoles: string[];       // Roles that can use this skill
  allowedTools: string[];       // Tools this skill requires
  grants?: SkillGrants;         // Capability grants (memory, etc.)
  metadata?: SkillMetadata;
}

interface SkillGrants {
  memory?: 'none' | 'isolated' | 'team' | 'all';  // Memory access policy
  memoryTeamRoles?: string[];   // Team roles for 'team' policy
}
```

## Configuration

### Server Configuration (`config.json`)
```json
{
  "mcpServers": {
    "mycelium-skills": {
      "command": "node",
      "args": ["packages/skills/dist/index.js", "packages/skills/skills"],
      "comment": "Skill MCP Server - provides list_skills tool"
    },
    "mycelium-session": {
      "command": "node",
      "args": ["packages/session/dist/mcp-server.js", "sessions"],
      "comment": "Session MCP Server - save, resume, compress conversations"
    },
    "mycelium-sandbox": {
      "command": "node",
      "args": ["packages/sandbox/dist/mcp-server.js"],
      "comment": "Sandbox MCP Server - secure code execution with OS-level isolation"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "comment": "Filesystem server - defaults to project root"
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    }
  },
  "roles": {
    "defaultRole": "default"
  }
}
```

### MCP Integration (`.mcp.json`)
```json
{
  "mcpServers": {
    "mycelium-router": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "config.json"
      }
    }
  }
}
```

## Environment Variables

- `MYCELIUM_ROUTER_PATH` - Path to MCP server (default: `packages/core/dist/mcp-server.js`)
- `MYCELIUM_CONFIG_PATH` - Path to config file (default: `config.json`)
- `MYCELIUM_CURRENT_ROLE` - Role to activate on startup (e.g., `orchestrator`, `adhoc`)
- `MYCELIUM_CLI_PATH` - Path to CLI for sub-agent spawning
- `ANTHROPIC_API_KEY` - API key for direct API usage (optional)

## Testing

Tests use Vitest and are distributed across packages:

| Package | Test Files | Description |
|---------|------------|-------------|
| `@mycelium/core` | 15+ | Router (mycelium-core, router-adapter), MCP (stdio-router, mcp-server, mcp-client), tool discovery, agent integration |
| `@mycelium/orchestrator` | 1 | Worker management, task delegation, skill-based restrictions |
| `@mycelium/adhoc` | 1 | Approval workflow, dangerous tool detection, event emission |
| `@mycelium/cli` | 4 | CLI commands, workflow-agent, adhoc-agent, context handling |
| `@mycelium/shared` | 1 | Error classes, type exports |
| `@mycelium/skills` | 1 | YAML/MD parsing, skill filtering, MCP tool definitions |
| `@mycelium/session` | 1 | Session persistence (session-store) |
| `@mycelium/sandbox` | 1 | OS-level sandboxing, profile validation |

**Key Test Files in Core**:
- `mycelium-core.test.ts`: Central routing system tests
- `router-adapter.test.ts`: MCP server adapter tests
- `stdio-router.test.ts`: Stdio-based MCP routing tests
- `mcp-server.test.ts`: MCP server initialization and request handling
- `agent.test.ts`: Agent SDK integration tests
- `sub-agent.test.ts`: Sub-agent spawning tests
- `tool-discovery.test.ts`: Tool discovery from backend servers
- `dynamic-tool-discovery.test.ts`: Dynamic tool registration tests
- `remote-prompt-fetcher.test.ts`: Remote prompt fetching tests

```bash
# Run all tests (from root)
npm test

# Or directly with vitest
npx vitest run

# Run tests for specific package
npx vitest run packages/rbac/tests/
npx vitest run packages/core/tests/

# Run specific test file
npx vitest run packages/rbac/tests/role-manager.test.ts

# Watch mode
npx vitest --watch
```

### Test-Driven Development (TDD)

このプロジェクトではテスト駆動開発を採用しています：

- **1:1 テストファイル対応**: 各 `.ts` ソースファイルに対応する `.test.ts` ファイルを作成
- **新機能追加時**: まずテストを書いてから実装する
- **バグ修正時**: 再現テストを書いてから修正する
- **リファクタリング時**: 既存テストが通ることを確認しながら進める

### Test Categories
- **Unit tests**: Router, MCP client/server, tool discovery, agent utilities
- **Integration tests**: Skill integration, role assignment, memory permissions
- **E2E tests**: Full flow with mycelium-skills server (`packages/core/tests/real-e2e.test.ts`)
- **CLI tests**: Workflow/Adhoc agents, context handling (`packages/cli/tests/`)

### RBAC Enforcement Testing

MYCELIUMのスキルベース制限が正しく機能することを確認するテストパターン：

**原則**: ロールに許可されていないツールが正しくフィルタリングされ、エージェントの動作が制限されることを確認する

**推奨テストケース**:

| Category | Description | Example Test |
|----------|-------------|--------------|
| Tool Filtering | スキルに定義されていないツールへのアクセス制限 | `orchestrator → filesystem__write_file` |
| Memory Isolation | メモリ権限のないロールがメモリ操作できない | `guest → save_memory` |
| Server Restriction | 許可されていないサーバーのツールへのアクセス制限 | `frontend → database__query` |
| Skill Boundary | ワークフローエージェントがスキルスクリプトのみ実行可能 | `workflow → shell__exec` |

**RBAC制限テストの例**:
```typescript
// Test: Workflow agent can only use skill tools
it('should restrict workflow agent to skill tools only', async () => {
  // Workflow agent with orchestrator role
  const visibleTools = toolVisibility.getVisibleTools();

  // Should only see mycelium-skills tools
  expect(visibleTools.every(t => t.name.startsWith('mycelium-skills__'))).toBe(true);

  // Should NOT see filesystem tools
  expect(visibleTools.find(t => t.name.startsWith('filesystem__'))).toBeUndefined();
});
```

## Important Patterns

### Tool Name Format
Tools are prefixed with their server name:
- `filesystem__read_file` (from filesystem server)
- `mycelium-skills__list_skills` (from mycelium-skills server)

### Double-Nested Response Handling

When the Router proxies requests to sub-MCP servers, responses may be double-wrapped:

```
Router → Sub-server → { content: [{ text: '{ content: [{ text: "actual data" }] }' }] }
```

The MCPClient handles this with `unwrapToolResponse()`:

```typescript
// In mcp-client.ts
unwrapToolResponse(text: string): unknown {
  let parsed = JSON.parse(text);
  // Recursively unwrap nested content arrays
  while (parsed?.content?.[0]?.text) {
    try {
      parsed = JSON.parse(parsed.content[0].text);
    } catch {
      break;  // Inner text is not JSON, return as-is
    }
  }
  return parsed;
}
```

Used by `listSkills()` and `listCommands()` to properly extract skill data.

### Role Assignment Flow
Roles are assigned at agent spawn time via environment variables:

1. Agent spawned with `MYCELIUM_CURRENT_ROLE=<role_id>` environment variable
2. Router validates role exists and loads role configuration
3. Router starts required servers if needed (lazy loading)
4. Router sets `currentRole` and filters tools based on role
5. Agent receives filtered tool list via `tools/list`

**Example: Workflow Agent**
```bash
MYCELIUM_CURRENT_ROLE=orchestrator  # Can only use mycelium-skills tools
```

**Example: Adhoc Agent**
```bash
MYCELIUM_CURRENT_ROLE=adhoc  # Full access to all tools
```

### Permission Checking
1. Check if server is allowed for role
2. Check tool-level permissions (allow/deny patterns)
3. Memory tools require skill grant (see Role Memory section)

### Wildcard Handling in allowedRoles

Skills can use `allowedRoles: ["*"]` to apply to all roles. The RoleManager handles this with two-pass processing:

```typescript
// In role-manager.ts generateRoleManifest()
// First pass: collect all explicit role IDs
const allRoleIds = new Set<string>();
for (const skill of manifest.skills) {
  for (const roleId of skill.allowedRoles) {
    if (roleId !== '*') {
      allRoleIds.add(roleId);
    }
  }
}

// Second pass: expand wildcards
for (const skill of manifest.skills) {
  let targetRoles: string[];
  if (skill.allowedRoles.includes('*')) {
    // Apply to ALL known roles
    targetRoles = Array.from(allRoleIds);
  } else {
    targetRoles = skill.allowedRoles;
  }
  // Process skill for each target role...
}
```

**Example: Session Management for All Roles**:
```yaml
# skills/session-management/SKILL.yaml
id: session-management
displayName: Session Management
allowedRoles:
  - "*"  # Applies to admin, developer, guest, etc.
allowedTools:
  - mycelium-session__*  # All session tools
```

This ensures skills like session-management and sandbox are available to all roles.

### Role Memory
Memory is a **skill-granted capability** (default: OFF). Roles must be granted memory access via skill definitions.

#### Memory Policies
| Policy | Description |
|--------|-------------|
| `none` | No memory access (default) |
| `isolated` | Own role's memory only |
| `team` | Own + specified team roles' memories |
| `all` | Access all roles' memories (admin) |

#### Granting Memory via Skills
In your skill's `SKILL.md`, add the `grants.memory` field:

```yaml
# skills/memory-basic/SKILL.md
---
id: memory-basic
displayName: Basic Memory
description: Grants isolated memory access
allowedRoles: [developer, tester]
allowedTools: []
grants:
  memory: isolated  # Can only access own memories
---
```

```yaml
# skills/memory-admin/SKILL.md
---
id: memory-admin
displayName: Admin Memory
description: Full memory access for admins
allowedRoles: [admin]
allowedTools: []
grants:
  memory: all  # Can access all roles' memories
---
```

```yaml
# skills/memory-team/SKILL.md
---
id: memory-team
displayName: Team Memory
description: Team lead can see team members' memories
allowedRoles: [lead]
allowedTools: []
grants:
  memory: team
  memoryTeamRoles: [frontend, backend, qa]  # Can access these roles' memories
---
```

#### Policy Priority
When a role has multiple skills with different memory grants, the highest privilege wins:
`all` > `team` > `isolated` > `none`

For `team` policies, team roles are merged across skills.

#### Memory Permission Inheritance

Memory permissions are also inherited through role hierarchy. Use `getEffectiveMemoryPermission()` to get resolved permissions:

```typescript
// Get effective memory permission (including inherited)
const permission = roleManager.getEffectiveMemoryPermission('child-role');
// Returns: { policy: 'team', teamRoles: ['frontend', 'backend'] }
```

**Inheritance Rules**:
- Highest privilege in chain wins: `all` > `team` > `isolated` > `none`
- Team roles are merged from all `team` policies in the chain
- Circular inheritance returns `none` (safe fallback)

### Role Inheritance

Roles can inherit permissions from parent roles, enabling hierarchical access control.

#### Defining Role Inheritance

Set the `inherits` field on a role to specify its parent:

```typescript
// In role definition or dynamically
const seniorRole = roleManager.getRole('senior');
if (seniorRole) {
  seniorRole.inherits = 'base';  // Inherit from 'base' role
}
```

#### Inheritance Chain Resolution

```typescript
// Get the full inheritance chain (child → parent → grandparent)
const chain = roleManager.getInheritanceChain('senior');
// Returns: ['senior', 'base', 'root']

// Get effective servers (merged from all ancestors)
const servers = roleManager.getEffectiveServers('senior');
// Returns: ['filesystem', 'git', 'database']  // Merged from chain

// Get effective tool permissions (merged from all ancestors)
const perms = roleManager.getEffectiveToolPermissions('senior');
// Returns merged allowPatterns, denyPatterns, etc.
```

#### Multi-Level Inheritance Example

```
root (servers: [filesystem])
  └── base (servers: [git], inherits: root)
        └── senior (servers: [database], inherits: base)
              └── admin (servers: [*], inherits: senior)

admin's effective servers = [filesystem, git, database, *]
```

#### Circular Inheritance Protection

The system detects and handles circular inheritance:

```typescript
roleA.inherits = 'roleB';
roleB.inherits = 'roleA';  // Circular!

const chain = roleManager.getInheritanceChain('roleA');
// Returns: [] (empty chain on circular reference)
// Warning logged: "Circular inheritance detected for role: roleA"
```

#### Memory Storage
Memory is stored in Markdown files per role (`memory/{role_id}.memory.md`):
```markdown
# Memory: frontend

> Last modified: 2025-01-01T10:00:00.000Z
> Total entries: 3

## Preferences

### [mem_abc123]
User prefers React over Vue for frontend projects.
<!-- {"createdAt":"...", "type":"preference"} -->

## Facts

### [mem_def456]
API endpoint is at /api/v2/
<!-- {"createdAt":"...", "type":"fact"} -->
```

#### Memory Tools
When granted, these tools become available:
- `save_memory` - Save content to current role's memory
- `recall_memory` - Search and retrieve memories (with `all_roles=true` for admin)
- `list_memories` - Get memory statistics

### Orchestrator-Worker Pattern

The Orchestrator manages skill-restricted worker agents:

```typescript
import { Orchestrator, createOrchestrator } from '@mycelium/orchestrator';

const orchestrator = createOrchestrator({
  logger,
  maxConcurrentWorkers: 5,
});

// Load skills from MCP server
await orchestrator.loadSkills(skills);

// Spawn a worker with skill restrictions
const worker = orchestrator.spawnWorker({
  skillId: 'frontend-dev',
  taskId: 'task-123',
});

// Worker can ONLY use tools allowed by 'frontend-dev' skill
const result = await orchestrator.executeTask(worker.id, {
  prompt: 'Create a React component',
});
```

### Adhoc Agent Usage

The Adhoc agent handles unrestricted tasks with approval workflow:

```typescript
import { AdhocAgent, createAdhocAgent } from '@mycelium/adhoc';

const adhoc = createAdhocAgent({
  logger,
  requireApproval: true,  // Require approval for dangerous ops
});

// Set approval callback
adhoc.setApprovalCallback(async (request) => {
  console.log(`Approval needed: ${request.toolName} (${request.riskLevel})`);
  // Return approval decision
  return { requestId: request.id, approved: true, respondedAt: new Date() };
});

// Execute task
const result = await adhoc.execute({
  prompt: 'Fix the deployment script',
});
```

#### Dangerous Tool Categories and Risk Levels

The Adhoc Agent classifies tools by risk level for approval workflow:

| Category | Tools | Risk Level |
|----------|-------|------------|
| `SHELL_EXEC` | `shell__exec`, `bash__run`, `sandbox__exec` | **critical** |
| `FILE_WRITE` | `filesystem__write_file`, `filesystem__delete_file` | **high** |
| `DATABASE` | `postgres__execute`, `database__write` | **high** |
| `NETWORK` | `http__request`, `fetch__url` | **medium** |

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

- [Mycelium-skills](https://github.com/Shin0205go/Mycelium-skills) - Skill MCP Server that provides skill definitions
- [Claude Agent SDK](https://github.com/anthropics/claude-code) - Anthropic's agent SDK

## Common Tasks

### タスク実行の基本フロー

```
[1] スキルを確認
    $ mycelium workflow --list

[2] Workflowで実行（推奨）
    $ mycelium workflow "run tests"

[3] 失敗した場合のみAdhocで調査
    $ mycelium adhoc --context ./workflow-context.json
```

### Creating a New MYCELIUM Project
```bash
# Initialize with example skills
mycelium init my-project
cd my-project

# Or minimal setup
mycelium init my-project --minimal

# This creates:
#   config.json         - MCP server configuration
#   skills/             - Skill definitions directory
#   skills/guest-access/SKILL.md
#   skills/developer-tools/SKILL.md
#   skills/admin-access/SKILL.md
```

### Adding a New Skill（スキル追加）

新しいタスクを自動化したい場合、スキルを作成します：

```bash
# Add from template
mycelium skill add my-skill --template code-reviewer

# Edit the generated skill
# skills/my-skill/SKILL.md
```

**スキル作成のチェックリスト**:
- [ ] `allowedTools` は必要最小限か？
- [ ] 単一のタスクに集中しているか？
- [ ] 説明は明確か？

### Adding a New Backend Server
1. Add configuration to `config.json` under `mcpServers`
2. Server will be auto-discovered on router startup
3. Tools will be prefixed with server name

### Creating a New Role
Roles are auto-generated from skill definitions. To add a new role:
1. Create/modify skill with `allowedRoles` including the new role
2. Use `mycelium skill add <name>` or create `skills/<name>/SKILL.md` manually
3. Restart router to reload skill manifest
4. Role will be available for agents spawned with `MYCELIUM_CURRENT_ROLE=<role_id>`

### Verifying Policies
```bash
# Check what a role can access
mycelium policy check --role developer

# List all roles derived from skills
mycelium policy roles
```

### Debugging（デバッグ）

**Workflow失敗時の調査手順**:
1. コンテキストファイルを確認: `cat ./workflow-context.json`
2. Adhocで調査: `mycelium adhoc --context ./workflow-context.json`
3. 根本原因を特定したら、スキルを修正
4. Workflowで再実行して確認

**その他のデバッグオプション**:
- Set log level in Logger constructor
- Check `logs/` directory for output
- Use `--json` flag for structured output in sub-agent mode
- Use `mycelium mcp status` to check server status

### Using Role Memory
Agents can use memory tools to persist knowledge across sessions:

```typescript
// Agent saves a memory
await router.routeRequest({
  method: 'tools/call',
  params: {
    name: 'save_memory',
    arguments: {
      content: 'User prefers dark mode',
      type: 'preference',
      tags: ['ui', 'settings']
    }
  }
});

// Agent recalls memories
await router.routeRequest({
  method: 'tools/call',
  params: {
    name: 'recall_memory',
    arguments: {
      query: 'user preference',
      type: 'preference',
      limit: 5
    }
  }
});
```

Memory files are stored at `memory/{role_id}.memory.md` and can be directly edited.

## Best Practices

### Workflow優先の開発

**原則**: 全てのタスクはまずWorkflow Agentで実行を試みる

```bash
# ✅ 推奨: Workflowで実行
mycelium workflow "run tests and fix failures"

# ⚠️ 例外: 調査が必要な場合のみAdhoc
mycelium adhoc --context ./workflow-context.json
```

### スキル設計のガイドライン

**最小限のツールを宣言する**

```yaml
# ✅ 良い例: 必要最小限のツール
id: code-formatter
allowedTools:
  - filesystem__read_file
  - filesystem__write_file

# ❌ 悪い例: 不要なツールを含む
id: code-formatter
allowedTools:
  - filesystem__*      # 削除操作も含まれてしまう
  - shell__exec        # フォーマットに不要
```

**タスク単位でスキルを分離する**

```yaml
# ✅ 良い例: 単一責任のスキル
id: test-runner
description: Run tests and report results
allowedTools:
  - shell__exec  # テスト実行のみ
  - filesystem__read_file

# ❌ 悪い例: 複数責任を持つスキル
id: dev-all
description: Everything for development
allowedTools:
  - filesystem__*
  - shell__*
  - git__*
```

### コンテキスト管理

**Workflowでコンテキストをクリーンに保つ**

| モード | コンテキスト | 推奨用途 |
|--------|-------------|----------|
| Workflow | クリーン（スキルツールのみ） | 定型タスク、自動化、CI/CD |
| Adhoc | 汚れやすい（全ツール） | 調査、デバッグ、一時的な修正 |

**段階的エスカレーション**

```
[1] Workflow実行 → 成功 → 完了
         ↓
      失敗
         ↓
[2] コンテキスト保存 → Adhocで調査 → 根本原因特定
         ↓
[3] スキル修正 → Workflowで再実行
```

### 再現性の確保

**同じ結果を得るために**

1. **スキルを固定**: 同じスキルIDを使用
2. **ツールセットを制限**: 不要なツールへのアクセスを削除
3. **モデルを固定**: `--model` オプションで指定
4. **プロンプトを標準化**: スキルのSKILL.mdにテンプレートを定義

```bash
# 再現性の高い実行例
mycelium workflow --model claude-sonnet-4-5-20250929 "run lint check"
```

### アンチパターン

| パターン | 問題点 | 解決策 |
|----------|--------|--------|
| 全てAdhocで実行 | コンテキスト汚染、再現性低下 | Workflow優先に切り替え |
| `allowedTools: ["*"]` | 不要なツールにアクセス | 必要なツールのみ列挙 |
| 1つのスキルで全部やる | 責任が曖昧、デバッグ困難 | タスク単位でスキル分割 |
| Adhocで本番修正 | 監査証跡なし、再現不可 | Workflowスキルを作成して実行 |
