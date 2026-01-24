---
id: session-management
displayName: Session Management
description: Save, resume, and compress conversation sessions

allowedRoles:
  - "*"

allowedTools: []

commands:
  - name: save
    description: Save current session
    handlerType: tool
    toolName: session_save
    arguments:
      - name: name
        description: Optional session name
        required: false
    usage: "/save [name]"

  - name: sessions
    description: List saved sessions
    handlerType: tool
    toolName: session_list
    usage: "/sessions"

  - name: resume
    description: Resume a saved session
    handlerType: tool
    toolName: session_resume
    arguments:
      - name: id
        description: Session ID to resume (interactive if omitted)
        required: false
    usage: "/resume [id]"

  - name: compress
    description: Compress current session to save context
    handlerType: tool
    toolName: session_compress
    usage: "/compress"

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
