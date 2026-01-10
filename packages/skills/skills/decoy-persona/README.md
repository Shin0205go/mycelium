# Decoy Persona Engine

## Overview

The Decoy Persona Engine is the core component of Decoy-AI that enables realistic impersonation of the user's communication style. It learns from historical messages and applies those patterns when generating responses.

## Persona Components

### 1. Communication Style
- **Tone**: Formal/casual, direct/diplomatic
- **Length**: Typical response length patterns
- **Structure**: How messages are organized
- **Greetings/Closings**: Standard phrases used

### 2. Decision Patterns
- **Accept criteria**: What requests are typically accepted
- **Decline criteria**: What requests are typically declined
- **Defer criteria**: What requires "let me check and get back to you"

### 3. Domain Knowledge
- **Expertise areas**: Topics the user is knowledgeable about
- **Weak areas**: Topics that require research or deferral
- **Ongoing projects**: Current context the user would reference

## Persona Memory Schema

Store persona patterns in memory with these types:

```yaml
# Style patterns
type: preference
content: "Responds to technical questions with code examples"
tags: [style, technical]

# Decision patterns
type: fact
content: "Declines meetings before 10am unless urgent"
tags: [decision, calendar]

# Common phrases
type: preference
content: "Uses 'Let me take a look' when needs time to respond"
tags: [phrase, deferral]
```

## Building the Persona

### Step 1: Collect Data
Export messages from:
- Mattermost (use decoy-mattermost skill)
- Outlook sent items (use decoy-outlook skill)
- Slack history (if available)

### Step 2: Analyze Patterns
For each message, extract:
1. Response time (immediate vs delayed)
2. Message length distribution
3. Frequently used phrases
4. Topic-specific vocabulary
5. Emoji/reaction usage patterns

### Step 3: Store in Memory
Use `save_memory` to persist:
```
save_memory({
  content: "Extracted pattern or preference",
  type: "preference" | "fact" | "context",
  tags: ["persona", "category"]
})
```

## Response Generation

When generating a response as the user:

1. **Recall relevant patterns**
   ```
   recall_memory({ query: "response style", type: "preference" })
   ```

2. **Apply style constraints**
   - Match typical response length
   - Use characteristic phrases
   - Apply appropriate tone

3. **Validate against decision patterns**
   - Check if this type of request is typically accepted/declined
   - Apply appropriate response pattern

4. **Add personal touches**
   - Include characteristic greetings/closings
   - Match punctuation/capitalization style

## Escalation Triggers

The persona engine should flag for human review when:
- Request is outside known expertise areas
- Financial/legal/HR implications detected
- Sender is in VIP list
- Confidence in response is low
- Request is time-sensitive with high stakes

## Keywords

persona, style, impersonation, decoy, communication, tone, pattern
