# CLAUDE.md - Aegis-CLI Codebase Guide

This document provides guidance for AI assistants working with the Aegis-CLI codebase.

## Project Overview

Aegis-CLI is a **skill-driven Role-Based Access Control (RBAC) MCP proxy router** that integrates Claude Agent SDK with Model Context Protocol (MCP) servers. It provides dynamic role-based tool filtering and access control for AI agents.

### Key Concepts

- **MCP (Model Context Protocol)**: Anthropic's protocol for tool/resource integration
- **Skill-Driven RBAC**: Skills declare which roles can use them; roles are dynamically generated from skill definitions
- **Router Proxy**: Routes tool calls from Claude to appropriate backend MCP servers
- **Dynamic Role Switching**: Agents can switch roles at runtime via `set_role` tool
- **Interactive CLI**: REPL interface with Claude Agent SDK for role-aware conversations

## AEGIS Architecture Rules

- **Inverted RBAC**: Roles are NOT defined manually. Skills declare `allowedRoles`.
- **Trust Boundary**: The Router implies the Agent's identity; the Agent does not claim it.
- **Source of Truth**: The MCP Server (@aegis/skills) is the only source of permission logic.

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

Aegis is organized as a monorepo with modular packages:

```
packages/
├── cli/                  # @aegis/cli - Command-Line Interface
│   └── src/
│       ├── index.ts              # CLI entry point (aegis command)
│       ├── commands/
│       │   ├── init.ts           # aegis init - project scaffolding
│       │   ├── skill.ts          # aegis skill add/list/templates (interactive)
│       │   ├── policy.ts         # aegis policy check/test/roles
│       │   └── mcp.ts            # aegis mcp start/status
│       └── lib/
│           ├── interactive-cli.ts # REPL with role switching
│           ├── mcp-client.ts      # MCP client wrapper
│           └── agent.ts           # Claude Agent SDK integration
│
├── shared/               # @aegis/shared - Common types and interfaces
│   └── src/
│       └── index.ts      # Role, ToolPermissions, SkillManifest types
│
├── rbac/                 # @aegis/rbac - Role-Based Access Control
│   ├── src/
│   │   ├── role-manager.ts           # Role definitions and permissions
│   │   ├── tool-visibility-manager.ts # Tool filtering by role
│   │   └── role-memory.ts            # Role-based memory store
│   └── tests/
│       ├── role-manager.test.ts
│       ├── tool-visibility-manager.test.ts
│       ├── tool-filtering.test.ts
│       ├── role-memory.test.ts
│       ├── memory-permission.test.ts
│       ├── role-switching.test.ts
│       ├── skill-integration.test.ts
│       ├── aegis-skills-access.test.ts
│       └── red-team-verification.test.ts  # Security verification loop
│
├── a2a/                  # @aegis/a2a - Agent-to-Agent Identity
│   ├── src/
│   │   ├── identity-resolver.ts  # A2A capability-based identity resolution
│   │   └── types.ts              # A2A-specific types
│   └── tests/
│       ├── identity-resolver.test.ts
│       └── types.test.ts
│
├── audit/                # @aegis/audit - Audit and Rate Limiting
│   └── src/
│       ├── index.ts          # Re-exports all audit components
│       ├── audit-logger.ts   # AuditLogger for compliance logging
│       └── rate-limiter.ts   # RateLimiter for quota management
│
├── gateway/              # @aegis/gateway - MCP Gateway/Proxy
│   └── src/
│       ├── index.ts          # Re-exports gateway components
│       ├── stdio-router.ts   # StdioRouter for MCP server connections
│       └── constants.ts      # Gateway constants and timeouts
│
├── core/                 # @aegis/core - Integration Layer
│   ├── src/
│   │   ├── index.ts              # Re-exports all packages
│   │   ├── mcp-server.ts         # MCP server entry point
│   │   ├── mcp-client.ts         # MCP client implementation
│   │   ├── agent.ts              # Claude Agent SDK wrapper
│   │   ├── cli.ts                # CLI utilities
│   │   ├── cli-entry.ts          # CLI entry point
│   │   ├── sub-agent.ts          # Sub-agent spawning
│   │   ├── router/
│   │   │   ├── aegis-router-core.ts    # Central routing system (司令塔)
│   │   │   ├── router-adapter.ts       # Router adapter for MCP
│   │   │   └── remote-prompt-fetcher.ts # Remote prompt handling
│   │   ├── mcp/
│   │   │   ├── tool-discovery.ts       # Tool discovery
│   │   │   └── dynamic-tool-discovery.ts # Dynamic tool loading
│   │   ├── types/
│   │   │   ├── index.ts          # Type exports
│   │   │   ├── mcp-types.ts      # MCP protocol types
│   │   │   └── router-types.ts   # Router-specific types
│   │   └── utils/
│   │       └── logger.ts         # Winston logger
│   └── tests/                    # 18 test files
│       ├── aegis-router-core.test.ts
│       ├── real-e2e.test.ts      # E2E tests with aegis-skills server
│       └── ...
│
└── skills/               # @aegis/skills - Skill MCP Server
    ├── src/
    │   └── index.ts      # Skill definition loading and serving
    └── skills/           # Skill definitions directory
        └── {skill-name}/
            ├── SKILL.yaml      # Skill metadata and RBAC config
            ├── SKILL.md        # Skill instructions (optional)
            ├── scripts/        # Executable scripts (optional)
            ├── references/     # Reference documentation (optional)
            └── assets/         # Asset files (optional)
```

## Packages

| Package | Description |
|---------|-------------|
| `@aegis/cli` | Command-line interface with interactive mode, project scaffolding, and policy verification |
| `@aegis/shared` | Common types and interfaces used across all packages |
| `@aegis/rbac` | Role-Based Access Control (RoleManager, ToolVisibilityManager, RoleMemoryStore) |
| `@aegis/a2a` | Agent-to-Agent identity resolution based on A2A Agent Card skills |
| `@aegis/audit` | Audit logging (AuditLogger) and rate limiting (RateLimiter) for compliance and quotas |
| `@aegis/gateway` | MCP gateway/proxy with StdioRouter for managing upstream MCP server connections |
| `@aegis/core` | Integration layer with MCP server/client and AegisRouterCore implementation |
| `@aegis/skills` | Skill MCP Server for loading and serving skill definitions (SKILL.yaml/SKILL.md) |

## Key Components

### 1. RoleManager (`packages/rbac/src/role-manager.ts`)
Handles role definitions and permission checking:
- Loads roles dynamically from skill manifests
- Generates roles from skill definitions (inverted RBAC)
- Checks server/tool permissions for roles
- Supports wildcard (`*`) and pattern matching
- Role inheritance with `getEffectiveServers()`, `getEffectiveToolPermissions()`
- Memory permission inheritance with `getEffectiveMemoryPermission()`

### 2. ToolVisibilityManager (`packages/rbac/src/tool-visibility-manager.ts`)
Manages tool discovery and role-based visibility:
- Registers tools from backend servers
- Filters visible tools based on current role
- Always includes `set_role` system tool
- Checks tool access before allowing calls

### 3. RoleMemoryStore (`packages/rbac/src/role-memory.ts`)
Transparent Markdown-based memory system per role:
- Role-isolated memory (each role has separate memory)
- Human-readable Markdown files for transparency
- Memory types: fact, preference, context, episode, learned
- Search and recall functionality
- Inspired by Claude's file-based memory approach

### 4. IdentityResolver (`packages/a2a/src/identity-resolver.ts`)
A2A Zero-Trust identity resolution for agent-to-agent communication:
- Capability-based role matching (A2A Agent Card skills)
- `requiredSkills` (AND logic) and `anySkills` (OR logic) matching
- `forbiddenSkills` for negative matching (block specific agents)
- Context conditions for time-based access control (timezone support)
- `strictValidation` mode for fail-close error handling
- Priority-based rule ordering
- Loads patterns from skills (skill-driven identity)
- Trusted prefix detection for agent trust levels

### 5. AegisRouterCore (`packages/core/src/router/aegis-router-core.ts`)
Central routing system (司令塔) that orchestrates all components:
- Manages connections to multiple sub-MCP servers via StdioRouter (@aegis/gateway)
- Maintains virtual tool table filtered by current role
- Handles role switching via `set_role` tool
- Integrates RoleManager, ToolVisibilityManager, AuditLogger, RateLimiter
- Supports A2A mode for automatic role assignment
- Loads roles dynamically from aegis-skills server
- Provides router-level tools: `aegis-router__list_roles`, `aegis-router__spawn_sub_agent`

### 5a. StdioRouter (`packages/gateway/src/stdio-router.ts`)
MCP server connection manager:
- Spawns and manages child processes for upstream MCP servers
- Handles MCP protocol initialization handshake
- Routes requests to appropriate servers based on tool prefixes
- Aggregates `tools/list` and `resources/list` from all connected servers
- Automatic server restart on exit
- Supports lazy server loading (start servers on demand)

### 6. InteractiveCLI (`packages/cli/src/lib/interactive-cli.ts`)
REPL interface for role-aware conversations:
- Connects to AEGIS Router via MCP
- Role selection with arrow-key navigation
- Model switching (Haiku, Sonnet, Opus)
- Tool listing per role
- Claude Agent SDK integration for streaming responses

### 7. Shared Types (`packages/shared/src/index.ts`)
Common types used across all packages:
- `Role`, `ToolPermissions`, `RoleMetadata`
- `BaseSkillDefinition`, `SkillManifest`, `SkillGrants`
- `Logger` interface for dependency injection
- Error classes: `RoleNotFoundError`, `ToolNotAccessibleError`

### 8. Skills Server (`packages/skills/src/index.ts`)
MCP server that provides skill definitions to AEGIS:
- Loads skills from `SKILL.yaml` (metadata) and `SKILL.md` (instructions)
- Provides tools for skill management:
  - `list_skills` - List all skills, optionally filtered by role
  - `get_skill` - Get detailed information about a specific skill
  - `list_resources` - List resources in a skill directory (scripts, references, assets)
  - `get_resource` - Read a resource file from a skill directory
  - `reload_skills` - Hot-reload skills from disk

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

The AEGIS CLI (`@aegis/cli`) provides multiple commands for project management and interactive use.

### Project Management Commands

```bash
# Initialize a new AEGIS project
aegis init [directory]
aegis init --minimal          # Without example skills

# Manage skills
aegis skill add <name>                    # Add new skill from template
aegis skill add <name> --template <tpl>   # Use specific template
aegis skill list                          # List all skills
aegis skill templates                     # Show available templates

# Available skill templates:
#   basic, browser-limited, code-reviewer, data-analyst,
#   flight-booking, personal-assistant

# Policy verification
aegis policy check --role <role>          # Check permissions for role
aegis policy test --agent <name> --skills <skills>  # Test A2A resolution
aegis policy roles                        # List all available roles

# MCP server management
aegis mcp start                           # Start MCP server
aegis mcp start --dev                     # Development mode (tsx)
aegis mcp start --background              # Run in background
aegis mcp status                          # Check server status
```

### Interactive Mode (Default)
```bash
aegis                          # Start interactive chat
aegis --role developer         # Start with specific role
aegis --model claude-sonnet-4-5-20250929  # Use specific model
```

REPL Commands:
- `/roles` - Select and switch roles (with arrow-key navigation)
- `/tools` - List available tools for current role
- `/model <name>` - Change Claude model
- `/status` - Show current status (role, model, auth, tools)
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

## Skill File Format

Skills use a two-file structure following Claude Skills best practices with AEGIS RBAC extensions:

### SKILL.yaml - Metadata and RBAC Configuration
```yaml
# Official Claude Skills fields
name: code-reviewer
description: Code review and best practices suggestions

# AEGIS RBAC extensions
allowedRoles:
  - developer
  - senior-developer
  - admin
allowedTools:
  - filesystem__read_file
  - filesystem__list_directory
  - git__diff
  - git__log
grants:
  memory: team
  memoryTeamRoles:
    - developer
    - frontend

# Optional A2A identity configuration
identity:
  skillMatching:
    - role: reviewer
      anySkills:
        - code_review
        - static_analysis
      priority: 50
```

### SKILL.md - Instructions and Documentation
```markdown
# Code Reviewer

Professional code review with git history analysis.

## When to Use This Skill

Use this skill when:
- Reviewing pull requests or code changes
- Analyzing code quality and best practices
- Identifying security vulnerabilities

## Instructions

1. Read the code using `filesystem__read_file`
2. Check history with `git__log` and `git__diff`
3. Provide actionable feedback

## Examples

### Example 1: Review a Pull Request

\`\`\`bash
git diff main...feature-branch
\`\`\`
```

### Skill Directory Structure
```
skills/{skill-name}/
├── SKILL.yaml      # Required: metadata and RBAC config
├── SKILL.md        # Optional: detailed instructions
├── scripts/        # Optional: executable automation scripts
├── references/     # Optional: reference documentation
└── assets/         # Optional: templates and resources
```

### Interactive Skill Creation
```bash
# Create a new skill interactively
aegis skill add my-skill

# This prompts for:
# - Description
# - Allowed roles (comma-separated)
# - Allowed tools (comma-separated, supports wildcards)
# - Memory policy (none/isolated/team/all)

# Creates the full skill structure with TODO placeholders
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

### SkillDefinition (`packages/a2a/src/types.ts`)
```typescript
interface SkillDefinition {
  id: string;                   // Skill identifier
  displayName: string;          // Display name
  description: string;          // Skill description
  allowedRoles: string[];       // Roles that can use this skill
  allowedTools: string[];       // Tools this skill requires
  grants?: SkillGrants;         // Capability grants (memory, etc.)
  identity?: SkillIdentityConfig; // A2A skill-based identity
  metadata?: SkillMetadata;
}

interface SkillIdentityConfig {
  skillMatching?: SkillMatchRule[];  // Capability-based role matching
  trustedPrefixes?: string[];        // Trusted agent prefixes
}

interface SkillMatchRule {
  role: string;                 // Role to assign when matched
  requiredSkills?: string[];    // ALL must be present (AND logic)
  anySkills?: string[];         // At least minSkillMatch present (OR logic)
  minSkillMatch?: number;       // Min anySkills matches (default: 1)
  forbiddenSkills?: string[];   // Skills that MUST NOT be present
  context?: RuleContext;        // Time-based access control
  description?: string;         // Optional description
  priority?: number;            // Priority (higher = checked first)
}

// Time-based access control conditions
interface RuleContext {
  allowedTime?: string;         // Time range (e.g., "09:00-18:00")
  allowedDays?: number[];       // Days of week (0=Sunday, 6=Saturday)
  timezone?: string;            // IANA timezone (e.g., "Asia/Tokyo")
}

// Agent Card skills from A2A protocol
interface A2AAgentSkill {
  id: string;                   // Skill identifier (e.g., "react", "coding")
  name?: string;                // Human-readable name
  description?: string;         // Skill description
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

Tests use Vitest and are distributed across packages (34 test files):

| Package | Test Files | Description |
|---------|------------|-------------|
| `@aegis/core` | 18 | Router, MCP client, tool discovery, rate limiting, audit logging, agent |
| `@aegis/rbac` | 9 | RoleManager, ToolVisibility, Memory, Skill integration, **Red Team** |
| `@aegis/a2a` | 2 | IdentityResolver, types for A2A capability-based matching |
| `@aegis/cli` | 1 | CLI command tests |
| `@aegis/shared` | 1 | Error classes, type exports |
| `@aegis/skills` | 1 | YAML/MD parsing, skill filtering, MCP tool definitions |
| `@aegis/gateway` | 1 | Gateway constants |
| `@aegis/audit` | 1 | Audit constants |

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
- **E2E tests**: Full flow with aegis-skills server (`packages/core/tests/real-e2e.test.ts`)
- **Red Team tests**: Security verification loop (`packages/rbac/tests/red-team-verification.test.ts`)

### Red Team Verification Loop (検証ループ)

セキュリティ製品であるAEGISでは、「自分で自分の成果物をテストさせる」検証ループを採用しています。

**原則**: Routerのコードを書いた後、許可されていないロールで危険なツールを呼び出し、正しく拒否されることを確認する

**Red Team テストスイート** (`packages/rbac/tests/red-team-verification.test.ts`):

| Suite | Description | Example Attack |
|-------|-------------|----------------|
| Unauthorized Role Access | 権限のないロールが危険なツールにアクセス | `guest → delete_database` |
| Memory Access Bypass | メモリ権限のないロールがメモリ操作 | `guest → save_memory` |
| Pattern Matching Exploits | ツール名の操作による権限バイパス | `read_file_and_delete`, `query\u0000drop` |
| Privilege Escalation | 存在しないロールへの切り替え試行 | `admin; DROP TABLE users` |
| A2A Mode Security | A2Aモードでの`set_role`無効化確認 | `set_role` in A2A mode |
| Server Access Control | 許可されていないサーバーへのアクセス | `filesystem_user → database__query` |
| Tool Visibility Consistency | ロール切り替え時のツール漏洩確認 | Admin → Guest downgrade |

```bash
# Run Red Team tests
npx vitest run packages/rbac/tests/red-team-verification.test.ts

# Run with verbose output
npx vitest run packages/rbac/tests/red-team-verification.test.ts --reporter=verbose
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
- `aegis-skills__list_skills` (from aegis-skills server)
- `aegis-router__list_roles` (router-provided tool)
- `aegis-router__spawn_sub_agent` (router-provided tool)

### Router-Level Tools
AEGIS Router provides built-in tools that don't require a backend server:

| Tool | Description |
|------|-------------|
| `aegis-router__list_roles` | List all available roles with their skills and capabilities |
| `aegis-router__spawn_sub_agent` | Spawn a sub-agent with a specific role to handle a task |

The `spawn_sub_agent` tool accepts:
```typescript
{
  role: string;        // Role for the sub-agent (required)
  task: string;        // Task/prompt to send (required)
  model?: string;      // Model to use (default: claude-3-5-haiku-20241022)
  interactive?: boolean; // Open new terminal window (macOS only)
}
```

### Skills Server Tools
The aegis-skills MCP server provides tools for skill management:

| Tool | Description |
|------|-------------|
| `aegis-skills__list_skills` | List all skills, optionally filtered by role |
| `aegis-skills__get_skill` | Get detailed information about a specific skill |
| `aegis-skills__list_resources` | List resources in a skill directory (scripts, references, assets) |
| `aegis-skills__get_resource` | Read a resource file from a skill directory |
| `aegis-skills__reload_skills` | Hot-reload skills from disk |

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
In your skill's `SKILL.yaml`, add the `grants.memory` field:

```yaml
# skills/memory-basic/SKILL.yaml
name: memory-basic
description: Grants isolated memory access
allowedRoles:
  - developer
  - tester
allowedTools: []
grants:
  memory: isolated  # Can only access own memories
```

```yaml
# skills/memory-admin/SKILL.yaml
name: memory-admin
description: Full memory access for admins
allowedRoles:
  - admin
allowedTools: []
grants:
  memory: all  # Can access all roles' memories
```

```yaml
# skills/memory-team/SKILL.yaml
name: memory-team
description: Team lead can see team members' memories
allowedRoles:
  - lead
allowedTools: []
grants:
  memory: team
  memoryTeamRoles:
    - frontend
    - backend
    - qa  # Can access these roles' memories
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

### A2A Identity Resolution (Agent-to-Agent Zero-Trust)

The A2A Identity Resolution feature enables automatic role assignment based on agent capabilities (A2A Agent Card skills), eliminating the need for the `set_role` tool in agent-to-agent communication.

#### How It Works

When A2A mode is enabled:
1. Agents connect and declare their capabilities via A2A Agent Card `skills`
2. The router matches agent skills against configured rules
3. A role is automatically assigned based on capability matching
4. The `set_role` tool is hidden from the tools list

```
┌─────────────────────────────────────────────────────────────────┐
│  Agent Card (A2A Protocol)          Aegis Skill Definition      │
│  ┌─────────────────────────┐        ┌─────────────────────────┐ │
│  │ name: "react-builder"   │        │ identity:               │ │
│  │ skills:                 │   →    │   skillMatching:        │ │
│  │   - id: "react"         │   →    │     - role: frontend    │ │
│  │   - id: "typescript"    │        │       anySkills:        │ │
│  └─────────────────────────┘        │         - react         │ │
│                                     │         - vue           │ │
│  Capability-based matching          └─────────────────────────┘ │
│  (not name pattern matching)                                    │
└─────────────────────────────────────────────────────────────────┘
```

#### Skill-Based Identity Configuration

Skills define capability-based role matching rules:

```yaml
# skills/admin-access/SKILL.yaml
id: admin-access
displayName: Admin Access
description: Full administrative access

allowedRoles:
  - admin

allowedTools:
  - "*"

grants:
  memory: all

# A2A Capability-based Identity
identity:
  skillMatching:
    - role: admin
      requiredSkills:           # ALL must be present (AND logic)
        - admin_access
        - system_management
      priority: 100
      description: "Full admin requires both skills"

  trustedPrefixes:
    - "claude-"
    - "aegis-"
```

```yaml
# skills/frontend-dev/SKILL.yaml
id: frontend-dev
displayName: Frontend Development
description: Frontend component development tools

allowedRoles:
  - frontend

allowedTools:
  - filesystem__read_file
  - filesystem__write_file

grants:
  memory: isolated

identity:
  skillMatching:
    - role: frontend
      anySkills:                # At least 1 must be present (OR logic)
        - react
        - vue
        - angular
        - svelte
      minSkillMatch: 1          # Minimum matches required
      priority: 50
```

#### Matching Logic

| Field | Logic | Description |
|-------|-------|-------------|
| `requiredSkills` | AND | ALL listed skills must be in Agent Card |
| `anySkills` | OR | At least `minSkillMatch` skills must match |
| `minSkillMatch` | threshold | Minimum anySkills matches (default: 1) |
| `forbiddenSkills` | REJECT | Any forbidden skill blocks matching |
| `context` | TIME | Time-based access restrictions |

When both `requiredSkills` and `anySkills` are specified, **both conditions** must be satisfied.

#### Forbidden Skills (Negative Matching)

Use `forbiddenSkills` to block agents with specific skills:

```yaml
identity:
  skillMatching:
    - role: admin
      requiredSkills: [admin_access]
      forbiddenSkills:              # Block these agents
        - trial_user                # Trial users can't be admin
        - sandbox_mode              # Sandbox agents can't be admin
        - deprecated_agent          # Old agents are blocked
```

**Behavior**:
- Checked FIRST before `requiredSkills`/`anySkills`
- Any single forbidden skill blocks the entire rule
- Agent falls through to next rule or default role

#### Time-Based Access Control (Context Conditions)

Restrict access by day of week, time range, and timezone:

```yaml
identity:
  skillMatching:
    - role: office-worker
      anySkills: [coding]
      context:
        allowedDays: [1, 2, 3, 4, 5]    # Monday-Friday only
        allowedTime: "09:00-18:00"      # Business hours
        timezone: "Asia/Tokyo"          # In Tokyo timezone
```

**Time Range Formats**:
- Normal range: `"09:00-18:00"` (9 AM to 6 PM)
- Overnight range: `"22:00-06:00"` (10 PM to 6 AM next day)

**Timezone Support**:
- Uses IANA timezone names (e.g., `America/New_York`, `Europe/London`)
- Falls back to system timezone if not specified
- Invalid timezone falls back to system time (fail-open)

#### Strict Validation Mode

Control error handling for invalid configurations:

```typescript
const resolver = createIdentityResolver(logger, {
  version: '1.0.0',
  defaultRole: 'guest',
  skillRules: [],
  strictValidation: true  // Throw on invalid config
});
```

| Mode | Behavior |
|------|----------|
| `strictValidation: false` (default) | Invalid config logged and skipped (fail-open) |
| `strictValidation: true` | Invalid config throws error (fail-close) |

Use `strictValidation: true` in production to catch configuration errors early.

#### Benefits of Capability-Based Identity

| Aspect | Benefit |
|--------|---------|
| Self-describing | Agents declare what they CAN DO, not who they ARE |
| No prior knowledge | Agents don't need to know naming conventions |
| A2A Compatible | Follows Google's A2A Agent Card standard |
| Flexible matching | Combine AND/OR logic for complex rules |

#### Rule Aggregation

When multiple skills define matching rules:
1. All rules are aggregated from all skills
2. Rules are sorted by priority (higher first)
3. First matching rule determines the role
4. Trusted prefixes are merged from all skills

#### Enabling A2A Mode

```typescript
// In AegisRouterCore constructor
const router = new AegisRouterCore(logger, {
  a2aMode: true
});

// Or enable dynamically
router.enableA2AMode();

// Set role from agent identity (with A2A Agent Card skills)
const manifest = await router.setRoleFromIdentity({
  name: 'react-builder',
  version: '1.0.0',
  skills: [
    { id: 'react' },
    { id: 'typescript' },
    { id: 'testing' }
  ]
});

// Get identity statistics
const stats = router.getIdentityStats();
// { totalRules: 3, rulesByRole: { admin: 1, frontend: 1, backend: 1 }, ... }
```

#### Resolution Result

```typescript
interface IdentityResolution {
  roleId: string;              // Resolved role
  agentName: string;           // Original agent name
  matchedRule: SkillMatchRule | null;  // Rule that matched
  matchedSkills: string[];     // Skills that contributed to match
  isTrusted: boolean;          // Based on trustedPrefixes
  resolvedAt: Date;            // Resolution timestamp
}
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

- [Aegis-skills](https://github.com/Shin0205go/Aegis-skills) - Skill MCP Server that provides skill definitions
- [Claude Agent SDK](https://github.com/anthropics/claude-code) - Anthropic's agent SDK

## Common Tasks

### Creating a New AEGIS Project
```bash
# Initialize with example skills
aegis init my-project
cd my-project

# Or minimal setup
aegis init my-project --minimal

# This creates:
#   config.json         - MCP server configuration
#   skills/             - Skill definitions directory
#   skills/guest-access/SKILL.md
#   skills/developer-tools/SKILL.md
#   skills/admin-access/SKILL.md
```

### Adding a New Skill
```bash
# Add a new skill interactively (recommended)
aegis skill add my-skill

# View available templates
aegis skill templates

# List existing skills
aegis skill list
aegis skill list --verbose  # Show details

# Edit the generated files
# skills/my-skill/SKILL.yaml  - Metadata and RBAC
# skills/my-skill/SKILL.md    - Instructions
```

### Adding a New Backend Server
1. Add configuration to `config.json` under `mcpServers`
2. Server will be auto-discovered on router startup
3. Tools will be prefixed with server name

### Creating a New Role
Roles are auto-generated from skill definitions (inverted RBAC). To add a new role:
1. Create a new skill or modify an existing skill's `SKILL.yaml`
2. Add the new role to `allowedRoles` list
3. Use `aegis skill add <name>` for interactive creation or create files manually
4. Restart router to reload skill manifest (or use `reload_skills` tool)
5. Role will be available via `set_role` or in interactive mode

Example: Adding a "qa-tester" role
```yaml
# skills/testing/SKILL.yaml
name: testing
description: QA testing tools
allowedRoles:
  - qa-tester    # New role created automatically
  - developer
allowedTools:
  - testing__run_tests
  - testing__coverage
```

### Verifying Policies
```bash
# Check what a role can access
aegis policy check --role developer

# Test A2A identity resolution
aegis policy test --agent my-agent --skills react,typescript

# List all roles derived from skills
aegis policy roles
```

### Debugging
- Set log level in Logger constructor
- Check `logs/` directory for output
- Use `--json` flag for structured output in sub-agent mode
- Use `aegis mcp status` to check server status

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
