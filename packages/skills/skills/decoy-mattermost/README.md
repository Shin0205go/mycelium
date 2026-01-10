# Decoy Mattermost Handler

## Overview

Handles all Mattermost communication for Decoy-AI. This skill enables:
- Monitoring channels and DMs for messages requiring response
- Generating responses in the user's communication style
- Managing team threads and conversations

## MCP Server Setup

### Using Official Mattermost MCP Server
```json
{
  "mcpServers": {
    "mattermost": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-mattermost"],
      "env": {
        "MATTERMOST_URL": "https://your-team.mattermost.com",
        "MATTERMOST_TOKEN": "your-personal-access-token"
      }
    }
  }
}
```

### Using kakehashi-inc Server
```json
{
  "mcpServers": {
    "mattermost": {
      "command": "npx",
      "args": ["-y", "@kakehashi-inc/mcp-server-mattermost"],
      "env": {
        "MATTERMOST_URL": "https://your-team.mattermost.com",
        "MATTERMOST_ACCESS_TOKEN": "your-personal-access-token"
      }
    }
  }
}
```

## Message Monitoring Workflow

### 1. Check for New Messages
```
mattermost__get_posts({
  channel_id: "channel-id",
  since: "last-check-timestamp"
})
```

### 2. Filter Messages Requiring Response
Skip messages that:
- Are from the user themselves
- Are system messages
- Have already been responded to
- Are in muted channels

Prioritize messages that:
- Mention the user directly (@username)
- Are DMs
- Are in high-priority channels
- Contain questions

### 3. Generate Response
1. Load persona patterns: `recall_memory({ query: "mattermost style" })`
2. Analyze message context and thread
3. Generate response matching user's style
4. Apply appropriate reaction if applicable

### 4. Post Response
```
mattermost__create_post({
  channel_id: "channel-id",
  message: "Generated response",
  root_id: "parent-post-id"  // For thread replies
})
```

## Response Patterns

### Quick Acknowledgments
For simple requests or FYI messages:
- Add reaction (thumbs up, check, etc.)
- Short acknowledgment if needed

### Questions
- Answer if within expertise
- Defer with "Let me check on that" if uncertain
- Escalate if high-stakes

### Action Requests
- Confirm if straightforward
- Request clarification if ambiguous
- Escalate if requires real user judgment

## Data Export for Persona Training

### Export User's Message History
```bash
# Use Mattermost CLI or API to export
mmctl export create --channel team-channel
```

### Extract Patterns
From exported messages, analyze:
1. Response latency patterns
2. Message length distribution
3. Common phrases and vocabulary
4. Thread participation patterns
5. Emoji and reaction usage

## Channels Configuration

Define channel-specific behavior:

```yaml
channels:
  general:
    priority: low
    auto_respond: false
    reactions_only: true

  project-alpha:
    priority: high
    auto_respond: true
    escalate_mentions: true

  random:
    priority: lowest
    ignore: true
```

## Rate Limiting

To avoid suspicious activity patterns:
- Max 20 messages per hour
- Minimum 30 second delay between responses
- Vary response times to seem natural
- Reduce activity during off-hours

## Keywords

mattermost, chat, team, messaging, slack-alternative, collaboration
