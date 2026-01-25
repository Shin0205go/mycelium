# CLAUDE.md - Mycelium-CLI Codebase Guide

This document provides guidance for AI assistants working with the Mycelium-CLI codebase.

## Project Overview

Mycelium-CLI is a **skill-driven Role-Based Access Control (RBAC) MCP proxy router** that integrates Claude Agent SDK with Model Context Protocol (MCP) servers. It provides dynamic role-based tool filtering and access control for AI agents.

### Key Concepts

- **MCP (Model Context Protocol)**: Anthropic's protocol for tool/resource integration
- **Skill-Driven RBAC**: Skills declare which roles can use them; roles are dynamically generated from skill definitions
- **Router Proxy**: Routes tool calls from Claude to appropriate backend MCP servers
- **Dynamic Role Switching**: Agents can switch roles at runtime via `set_role` tool
- **Interactive CLI**: REPL interface with Claude Agent SDK for role-aware conversations

## MYCELIUM Architecture Rules

- **Inverted RBAC**: Roles are NOT defined manually. Skills declare `allowedRoles`.
- **Trust Boundary**: The Router implies the Agent's identity; the Agent does not claim it.
- **Source of Truth**: The MCP Server (@mycelium/skills) is the only source of permission logic.

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
                        │ set_role / MCP tools
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
| **リスク** | 低（制限付き） | 高（全アクセス） |
| **承認フロー** | 不要 | 将来的に危険操作で必要 |

#### Workflow → Adhoc Handoff

```typescript
// Workflow失敗時のコンテキスト構造
interface WorkflowContext {
  skillId: string;           // 失敗したスキルID
  scriptPath: string;        // 実行したスクリプトパス
  args?: string[];           // スクリプト引数
  error: {
    message: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  timestamp: string;
  conversationSummary?: string;  // LLMとの会話要約
}
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
│       │   ├── mcp.ts            # mycelium mcp start/status
│       │   ├── workflow.ts       # mycelium workflow - skill-based workflows
│       │   └── adhoc.ts          # mycelium adhoc - full tool access
│       ├── agents/
│       │   ├── workflow-agent.ts # Skill-restricted workflow agent
│       │   └── adhoc-agent.ts    # Unrestricted adhoc agent
│       └── lib/
│           ├── interactive-cli.ts # REPL with dynamic command generation
│           └── mcp-client.ts      # MCP client wrapper
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
│   │   ├── rbac/
│   │   │   ├── role-manager.ts           # Role definitions and permissions
│   │   │   ├── tool-visibility-manager.ts # Tool filtering by role
│   │   │   └── role-memory.ts            # Role-based memory store
│   │   ├── router/
│   │   │   ├── mycelium-router-core.ts  # Central routing system (司令塔)
│   │   │   ├── rate-limiter.ts       # Rate limiting
│   │   │   └── audit-logger.ts       # Audit logging
│   │   ├── mcp/
│   │   │   ├── stdio-router.ts       # Stdio-based MCP routing
│   │   │   └── tool-discovery.ts     # Tool discovery
│   │   └── utils/
│   │       └── logger.ts             # Winston logger
│   └── tests/
│       ├── mycelium-router-core.test.ts
│       ├── role-manager.test.ts
│       ├── tool-visibility-manager.test.ts
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
│       └── index.ts      # Session persistence via MCP
│
└── sandbox/              # @mycelium/sandbox - Sandboxed Execution
    └── src/
        └── index.ts      # OS-level sandbox for command execution
```

## Packages

| Package | Description |
|---------|-------------|
| `@mycelium/cli` | Command-line interface with workflow/adhoc modes, dynamic command generation |
| `@mycelium/shared` | Common types and interfaces used across all packages |
| `@mycelium/core` | Integration layer with RBAC, MCP proxy, and MyceliumRouterCore |
| `@mycelium/orchestrator` | Worker agent management with skill-based tool restrictions |
| `@mycelium/adhoc` | Unrestricted agent for edge cases with approval workflow |
| `@mycelium/skills` | Skill MCP Server for loading and serving skill definitions |
| `@mycelium/session` | Session persistence and management via MCP |
| `@mycelium/sandbox` | OS-level sandboxed command execution |

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
- Always includes `set_role` system tool
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

### 5. AdhocAgent (`packages/adhoc/src/adhoc-agent.ts`)
Unrestricted agent for edge cases:
- Full tool access (not skill-restricted)
- Approval workflow for dangerous operations
- Risk level classification (low, medium, high, critical)
- Parallel to Orchestrator (not hierarchical)
- For bash execution, file editing, one-off tasks

### 7. MyceliumRouterCore (`packages/core/src/router/mycelium-router-core.ts`)
Central routing system (司令塔) that orchestrates all components:
- Manages connections to multiple sub-MCP servers via StdioRouter
- Maintains virtual tool table filtered by current role
- Handles role switching via `set_role` tool
- Integrates RoleManager, ToolVisibilityManager, AuditLogger, RateLimiter
- Loads roles dynamically from mycelium-skills server

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
mycelium mcp status                          # Check server status
```

### Workflow Mode (Skill-Restricted)
```bash
# Run skill-based workflows (limited to skill scripts)
mycelium workflow                    # Start interactive workflow mode
mycelium workflow "task"             # Execute a single workflow task
mycelium workflow --list             # List available skills

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
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"]
    },
    "mycelium-skills": {
      "command": "node",
      "args": ["node_modules/mycelium-skills/index.js", "..."]
    }
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

- `MYCELIUM_ROUTER_PATH` - Path to MCP server (default: `dist/mcp-server.js`)
- `MYCELIUM_CONFIG_PATH` - Path to config file (default: `config.json`)
- `MYCELIUM_CLI_PATH` - Path to CLI for sub-agent spawning
- `ANTHROPIC_API_KEY` - API key for direct API usage (optional)

## Testing

Tests use Vitest and are distributed across packages:

| Package | Test Files | Description |
|---------|------------|-------------|
| `@mycelium/core` | 18+ | Router, MCP client, RBAC, tool discovery, rate limiting, audit logging, wildcard handling |
| `@mycelium/orchestrator` | 1 | Worker management, task delegation, skill-based restrictions |
| `@mycelium/adhoc` | 1 | Approval workflow, dangerous tool detection, event emission |
| `@mycelium/cli` | 1 | CLI command tests |
| `@mycelium/shared` | 1 | Error classes, type exports |
| `@mycelium/skills` | 1 | YAML/MD parsing, skill filtering, MCP tool definitions |
| `@mycelium/session` | 1 | Session persistence, compression, export |
| `@mycelium/sandbox` | 6 | OS-level sandboxing, profile validation |

**Key Test Areas**:
- `role-manager.test.ts`: Includes tests for `allowedRoles: ["*"]` wildcard expansion
- `tool-visibility-manager.test.ts`: Tests for `allowedTools` pattern matching (`server__*`)
- `red-team-verification.test.ts`: Security tests for permission bypass attempts

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
- **Unit tests**: RoleManager, ToolVisibilityManager, IdentityResolver, types
- **Integration tests**: Skill integration, role switching, memory permissions
- **E2E tests**: Full flow with mycelium-skills server (`packages/core/tests/real-e2e.test.ts`)
- **Red Team tests**: Security verification loop (`packages/rbac/tests/red-team-verification.test.ts`)

### Red Team Verification Loop (検証ループ)

セキュリティ製品であるMYCELIUMでは、「自分で自分の成果物をテストさせる」検証ループを採用しています。

**原則**: Routerのコードを書いた後、許可されていないロールで危険なツールを呼び出し、正しく拒否されることを確認する

**Red Team テストスイート** (`packages/core/tests/red-team-verification.test.ts`):

| Suite | Description | Example Attack |
|-------|-------------|----------------|
| Unauthorized Role Access | 権限のないロールが危険なツールにアクセス | `guest → delete_database` |
| Memory Access Bypass | メモリ権限のないロールがメモリ操作 | `guest → save_memory` |
| Pattern Matching Exploits | ツール名の操作による権限バイパス | `read_file_and_delete`, `query\u0000drop` |
| Privilege Escalation | 存在しないロールへの切り替え試行 | `admin; DROP TABLE users` |
| Server Access Control | 許可されていないサーバーへのアクセス | `filesystem_user → database__query` |
| Tool Visibility Consistency | ロール切り替え時のツール漏洩確認 | Admin → Guest downgrade |

```bash
# Run Red Team tests
npx vitest run packages/core/tests/red-team-verification.test.ts

# Run with verbose output
npx vitest run packages/core/tests/red-team-verification.test.ts --reporter=verbose
```

**検証ループの実行例**:
```typescript
// Attack: Guest tries to access delete_database
it('MUST deny guest access to delete_database', () => {
  const guestRole = roleManager.getRole('guest');
  toolVisibility.setCurrentRole(guestRole!);

  // Verify the tool is not visible
  expect(toolVisibility.isVisible('database__delete_database')).toBe(false);

  // Verify checkAccess throws an error
  expect(() => {
    toolVisibility.checkAccess('database__delete_database');
  }).toThrow(/not accessible for role 'guest'/);
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
3. System tools always allowed: `set_role`
4. Memory tools require skill grant (see Role Memory section)

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

#### Dangerous Tool Categories

```typescript
const DANGEROUS_TOOL_CATEGORIES = {
  FILE_WRITE: ['filesystem__write_file', 'filesystem__delete_file'],
  SHELL_EXEC: ['shell__exec', 'bash__run', 'sandbox__exec'],
  NETWORK: ['http__request', 'fetch__url'],
  DATABASE: ['postgres__execute', 'database__write'],
};
```

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

### Adding a New Skill
```bash
# Add from template
mycelium skill add my-skill --template code-reviewer

# Edit the generated skill
# skills/my-skill/SKILL.md
```

### Adding a New Backend Server
1. Add configuration to `config.json` under `mcpServers`
2. Server will be auto-discovered on router startup
3. Tools will be prefixed with server name

### Creating a New Role
Roles are auto-generated from skill definitions. To add a new role:
1. Create/modify skill with `allowedRoles` including the new role
2. Use `mycelium skill add <name>` or create `skills/<name>/SKILL.md` manually
3. Restart router to reload skill manifest
4. Role will be available via `set_role` or in interactive mode

### Verifying Policies
```bash
# Check what a role can access
mycelium policy check --role developer

# List all roles derived from skills
mycelium policy roles
```

### Debugging
- Set log level in Logger constructor
- Check `logs/` directory for output
- Use `--json` flag for structured output in sub-agent mode
- Use `mycelium mcp status` to check server status

### Configuring Rate Limits
```typescript
// Set quota for a role
router.setRoleQuota('guest', {
  maxCallsPerMinute: 10,
  maxCallsPerHour: 100,
  maxConcurrent: 3,
  toolLimits: {
    'expensive_tool': { maxCallsPerMinute: 2 }
  }
});
```

### Accessing Audit Logs
```typescript
// Get statistics
const stats = router.getAuditStats();

// Get recent denials
const denials = router.getRecentDenials(10);

// Export for compliance
const csv = router.exportAuditLogsCsv();
const json = router.exportAuditLogs();
```

### Thinking Signature (Extended Thinking Transparency)

MYCELIUM supports capturing the "thinking" process from Claude Opus 4.5 and other models with extended thinking. This provides complete transparency about "why" an operation was performed.

#### What is Thinking Signature?

When Claude Opus 4.5 uses extended thinking, the model's reasoning process is captured and stored in the audit log alongside each tool call. This enables:

- **Transparency**: Complete visibility into the model's decision-making
- **Compliance**: Auditable records of why operations were performed
- **Debugging**: Understanding unexpected behavior through reasoning analysis
- **Security**: Detecting suspicious reasoning patterns

#### ThinkingSignature Interface

```typescript
interface ThinkingSignature {
  /** The full thinking content from the model */
  thinking: string;

  /** Model that produced this thinking (e.g., 'claude-opus-4-5-20251101') */
  modelId?: string;

  /** Number of thinking tokens used */
  thinkingTokens?: number;

  /** Timestamp when thinking was captured */
  capturedAt: Date;

  /** Optional summarized version */
  summary?: string;

  /** Type: 'extended_thinking', 'chain_of_thought', or 'reasoning' */
  type: 'extended_thinking' | 'chain_of_thought' | 'reasoning';

  /** Cache metrics from the API call */
  cacheMetrics?: {
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}
```

#### Capturing Thinking in Tool Calls

```typescript
// Method 1: Set thinking context before tool call
router.setThinkingContext({
  thinking: "I need to read the file to understand the code structure...",
  type: 'extended_thinking',
  modelId: 'claude-opus-4-5-20251101',
  capturedAt: new Date(),
});
await router.executeToolCall('filesystem__read_file', { path: '/src/index.ts' });

// Method 2: Pass thinking directly to executeToolCall
await router.executeToolCall(
  'filesystem__write_file',
  { path: '/src/config.ts', content: '...' },
  {
    thinking: "The user wants to update the configuration...",
    type: 'extended_thinking',
    capturedAt: new Date(),
  }
);
```

#### Extracting Thinking from Agent SDK Messages

```typescript
import {
  extractThinkingFromMessage,
  createThinkingSignature,
  hasThinkingContent
} from '@mycelium/core';

for await (const message of queryResult) {
  // Check if message has thinking blocks
  if (hasThinkingContent(message)) {
    const extracted = extractThinkingFromMessage(message, 'claude-opus-4-5-20251101');

    if (extracted && extracted.hasToolUse) {
      // Capture thinking before tool call is executed
      router.setThinkingContext(createThinkingSignature(extracted, thinkingTokens));
    }
  }
}
```

#### Accessing Thinking in Audit Logs

```typescript
// Get entries with thinking signatures
const entriesWithThinking = router.getEntriesWithThinking(50);

// Get thinking statistics
const thinkingStats = router.getThinkingStats();
// Returns: {
//   entriesWithThinking: 42,
//   thinkingCoverageRate: 0.75,
//   totalThinkingTokens: 15000,
//   avgThinkingTokens: 357,
//   byType: { extended_thinking: 40, chain_of_thought: 2, reasoning: 0 }
// }

// Export detailed thinking report for audits
const report = router.exportThinkingReport();
```

#### Query Audit Logs by Thinking

```typescript
// Query entries with thinking
const withThinking = auditLogger.query({
  hasThinking: true,
  result: 'allowed',
  limit: 100
});

// Query by thinking type
const extendedThinking = auditLogger.query({
  thinkingType: 'extended_thinking'
});
```

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
