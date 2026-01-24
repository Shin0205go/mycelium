---
id: session-management
displayName: Session Management
description: Save, resume, and compress conversation sessions

allowedRoles:
  - "*"

allowedTools:
  - mycelium-session__*

commands:
  - name: save
    description: Save current session
    handlerType: tool
    toolName: mycelium-session__session_save
    arguments:
      - name: name
        description: Optional session name
        required: false
      - name: roleId
        description: Role ID for the session
        required: true
        default: orchestrator
    usage: "/save [name]"

  - name: sessions
    description: List saved sessions
    handlerType: tool
    toolName: mycelium-session__session_list
    usage: "/sessions"

  - name: resume
    description: Resume a saved session
    handlerType: tool
    toolName: mycelium-session__session_load
    arguments:
      - name: sessionId
        description: Session ID to resume
        required: true
    usage: "/resume <id>"

  - name: compress
    description: Compress current session to save context
    handlerType: tool
    toolName: mycelium-session__session_compress
    arguments:
      - name: sessionId
        description: Session ID to compress
        required: true
    usage: "/compress <id>"

  - name: fork
    description: Create a fork of a session
    handlerType: tool
    toolName: mycelium-session__session_fork
    arguments:
      - name: sessionId
        description: Session ID to fork
        required: true
      - name: name
        description: Name for the forked session
        required: false
    usage: "/fork <id> [name]"

  - name: export
    description: Export a session to file
    handlerType: tool
    toolName: mycelium-session__session_export
    arguments:
      - name: sessionId
        description: Session ID to export
        required: true
      - name: format
        description: Export format (markdown, json, html)
        required: false
        default: markdown
    usage: "/export <id> [format]"

metadata:
  version: "1.0.0"
  category: system
  author: mycelium
  tags:
    - session
    - persistence
    - context
---

# Session Management

This skill provides commands for managing conversation sessions.

## Features

- **Save sessions** - Persist the current conversation for later
- **Resume sessions** - Continue a previous conversation
- **List sessions** - Browse saved sessions with previews
- **Compress sessions** - Reduce context size by summarizing older messages

## Usage

### Save a session
```
/save                  # Save with auto-generated name
/save my-project-chat  # Save with custom name
```

### List sessions
```
/sessions              # Shows all saved sessions
```

### Resume a session
```
/resume                # Interactive session selector
/resume ses_abc123     # Resume specific session by ID
```

### Compress a session
```
/compress              # Summarizes older messages, keeps recent 10
```

## Session Storage

Sessions are stored as human-readable Markdown files in the `sessions/` directory.
Each session includes:
- Full message history
- Role and model information
- Tool call records
- Thinking signatures (if available)
