# Decoy Outlook Handler

## Overview

Manages all Microsoft Outlook operations for Decoy-AI:
- Email monitoring and response
- Calendar management and scheduling
- Meeting invitations handling

## MCP Server Setup

### Using MS-365-MCP-Server (Recommended)
```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["-y", "@softeria/ms-365-mcp-server"],
      "env": {
        "AZURE_CLIENT_ID": "your-azure-app-client-id",
        "AZURE_TENANT_ID": "your-azure-tenant-id",
        "AZURE_CLIENT_SECRET": "your-azure-client-secret"
      }
    }
  }
}
```

### Azure AD App Registration
1. Go to Azure Portal > Azure Active Directory > App registrations
2. Create new registration
3. Add API permissions:
   - Mail.Read, Mail.Send
   - Calendars.Read, Calendars.ReadWrite
4. Create client secret
5. Configure redirect URIs

## Email Handling

### 1. Monitor Inbox
```
outlook__list_mail({
  folder: "inbox",
  filter: "isRead eq false",
  top: 20
})
```

### 2. Triage Emails
Categorize by:
- **Immediate response**: Questions, requests needing quick reply
- **Scheduled response**: Non-urgent, can wait
- **Ignore**: Newsletters, notifications, FYI
- **Escalate**: High-stakes, VIP sender, financial/legal

### 3. Generate Response
Using persona patterns:
```
recall_memory({ query: "email style formal" })
recall_memory({ query: "email signature" })
```

### 4. Send Response
```
outlook__reply_mail({
  message_id: "original-message-id",
  body: "Generated response with signature",
  reply_all: false
})
```

## Email Response Patterns

### Standard Reply Structure
```
[Greeting based on relationship]

[Response body - match user's typical length and style]

[Closing based on context]
[Signature]
```

### Quick Acknowledgments
- "Got it, thanks!"
- "Will do."
- "Thanks for the heads up."

### Deferral Responses
- "Let me check on this and get back to you."
- "I'll look into it and follow up by [time]."
- "Good question - let me dig into the details."

### Decline Patterns
- "Unfortunately I won't be able to make that work."
- "I'm pretty booked that day - can we look at alternatives?"
- "That's outside my area - [redirect suggestion]."

## Calendar Management

### Check Availability
```
outlook__find_free_time({
  start: "2025-01-15T09:00:00",
  end: "2025-01-15T18:00:00",
  duration: 30
})
```

### Handle Meeting Invitations

#### Auto-Accept Criteria
- Recurring team meetings
- 1:1s with direct reports/manager
- Project meetings user typically attends

#### Auto-Decline Criteria
- Conflicts with existing high-priority meetings
- Outside working hours (configurable)
- From unknown external senders

#### Defer to Human
- New recurring commitments
- All-day events
- External meetings with new contacts
- Meetings with executives

### Create Meeting
```
outlook__create_event({
  subject: "Meeting Title",
  start: "2025-01-15T10:00:00",
  end: "2025-01-15T10:30:00",
  attendees: ["email1@company.com", "email2@company.com"],
  body: "Agenda...",
  is_online_meeting: true
})
```

## VIP and Priority Rules

Configure special handling for important contacts:

```yaml
vip_senders:
  - ceo@company.com
  - manager@company.com
  - client-vip@client.com

vip_rules:
  response_priority: immediate
  escalate: always
  auto_accept_meetings: true
```

## Working Hours

Configure availability:

```yaml
working_hours:
  timezone: "Asia/Tokyo"
  weekdays:
    start: "09:00"
    end: "18:00"
  weekends:
    enabled: false

out_of_office:
  auto_reply: true
  message: "I'm currently away and will respond when I return."
```

## Rate Limiting

To avoid detection:
- Max 30 emails per hour
- Delay responses by 2-15 minutes (randomized)
- Match user's historical response time patterns
- Reduce activity during lunch hours

## Data Export for Training

### Export Sent Items
Use Graph API or Outlook export to get:
- Last 6 months of sent emails
- Meeting responses
- Calendar events created

### Analyze for Patterns
1. Response time by sender type
2. Email length by topic
3. Common phrases and signatures
4. Meeting acceptance patterns
5. Time blocking preferences

## Keywords

outlook, email, calendar, microsoft, office365, meetings, scheduling
