# Mycelium Architecture Overview

## Core Principles

1. **Skill-Driven RBAC** - Roles are generated from skill definitions (inverted RBAC)
2. **Trust Boundary** - Router implies agent identity; agents don't claim it
3. **Progressive Disclosure** - Load context only when needed
4. **Test-Driven Development** - Write tests before implementation

## Package Structure

```
packages/
├── shared/     - Common types and interfaces
├── rbac/       - Role-Based Access Control
├── a2a/        - Agent-to-Agent Identity
├── audit/      - Audit logging and rate limiting
├── gateway/    - MCP gateway/proxy
├── core/       - Integration layer
├── skills/     - Skill MCP Server
└── cli/        - CLI interface
```

## Key Components

### RoleManager
- Loads roles dynamically from skills
- Checks permissions (server/tool level)
- Supports inheritance and wildcards

### ToolVisibilityManager
- Registers tools from backend servers
- Filters tools by current role
- Always includes set_role system tool

### IdentityResolver (A2A)
- Capability-based role matching
- Skill-based identity resolution
- Zero-trust agent verification

## Data Flow

```
User Request → CLI → MyceliumRouterCore → RoleManager → ToolVisibilityManager → MCP Server
                                    ↓
                              SkillsMCPServer
```

## Self-Improvement Targets

When improving Mycelium, focus on these areas:

1. **Performance** - Tool registration, role switching, skill loading
2. **Usability** - CLI commands, error messages, help text
3. **Reliability** - Error handling, edge cases, validation
4. **Maintainability** - Code organization, documentation, tests
5. **Features** - New capabilities, skill improvements

## Architectural Constraints

- Maintain TypeScript strict mode
- Preserve ESM module system
- Keep packages loosely coupled
- Don't break RBAC security model
- Follow progressive disclosure pattern
