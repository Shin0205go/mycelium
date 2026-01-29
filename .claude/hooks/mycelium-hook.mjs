#!/usr/bin/env node
// ============================================================================
// Mycelium Hook for Claude Code
// Enforces role-based tool access control for built-in tools (Bash, Edit, etc.)
// Also handles Task tool to set role for subagents
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Session state file location
const SESSION_FILE = join(homedir(), '.mycelium', 'session-state.json');

// Role keywords to detect in Task prompts
const ROLE_PATTERNS = [
  { pattern: /\brole:\s*(\w+)/i, extract: (m) => m[1] },
  { pattern: /\bas\s+(\w+)\s+role/i, extract: (m) => m[1] },
  { pattern: /\bwith\s+(\w+)\s+role/i, extract: (m) => m[1] },
  { pattern: /\b(\w+)ロール/i, extract: (m) => m[1] },
  { pattern: /\bロール:\s*(\w+)/i, extract: (m) => m[1] },
];

// Built-in tools that can be mapped to MCP-style names
// If any of these MCP tools are allowed, the built-in tool is also allowed
const BUILTIN_TOOL_MAPPING = {
  // Bash is allowed if write operations are permitted
  'Bash': ['bash', 'Bash', 'filesystem__write_file', 'filesystem__create_directory'],
  'Edit': ['filesystem__write_file', 'filesystem__edit_file', 'Edit'],
  'Write': ['filesystem__write_file', 'Write'],
  'Read': ['filesystem__read_file', 'Read'],
  'Glob': ['filesystem__search_files', 'filesystem__list_directory', 'Glob'],
  'Grep': ['filesystem__search_files', 'Grep'],
  'WebFetch': ['WebFetch'],
  'WebSearch': ['WebSearch'],
  'Task': ['Task'],
  'NotebookEdit': ['NotebookEdit'],
};

// Read session state from file
function readSessionState() {
  try {
    if (!existsSync(SESSION_FILE)) {
      // No session file = no restrictions (mycelium not active)
      return null;
    }
    const content = readFileSync(SESSION_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[mycelium-hook] Failed to read session state: ${error.message}`);
    return null;
  }
}

// Write session state
function writeSessionState(state) {
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[mycelium-hook] Failed to write session state: ${error.message}`);
  }
}

// Extract role from Task prompt
function extractRoleFromPrompt(prompt) {
  if (!prompt) return null;
  for (const { pattern, extract } of ROLE_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) {
      return extract(match).toLowerCase();
    }
  }
  return null;
}

// Check if a tool is allowed for the current role
function isToolAllowed(toolName, sessionState) {
  if (!sessionState || !sessionState.enabled) {
    // Mycelium not active, allow all
    return { allowed: true, reason: 'Mycelium not active' };
  }

  const { role, allowedTools } = sessionState;

  if (!allowedTools || allowedTools.length === 0) {
    // No tool restrictions
    return { allowed: true, reason: 'No tool restrictions' };
  }

  // Check if this built-in tool maps to any allowed MCP tools
  const mappedNames = BUILTIN_TOOL_MAPPING[toolName] || [toolName];

  for (const mapped of mappedNames) {
    // Check exact match
    if (allowedTools.includes(mapped)) {
      return { allowed: true, reason: `Tool ${mapped} is allowed` };
    }

    // Check pattern match (e.g., filesystem__* matches filesystem__read_file)
    for (const allowedTool of allowedTools) {
      if (allowedTool.endsWith('*')) {
        const prefix = allowedTool.slice(0, -1);
        if (mapped.startsWith(prefix)) {
          return { allowed: true, reason: `Tool ${mapped} matches pattern ${allowedTool}` };
        }
      }
    }
  }

  return {
    allowed: false,
    reason: `Tool '${toolName}' is not allowed for role '${role}'. Allowed tools: ${allowedTools.slice(0, 5).join(', ')}${allowedTools.length > 5 ? '...' : ''}`
  };
}

// Main hook logic
async function main() {
  // Read input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookInput;
  try {
    hookInput = JSON.parse(input);
  } catch (error) {
    console.error(`[mycelium-hook] Failed to parse input: ${error.message}`);
    process.exit(1);
  }

  const { tool_name, tool_input } = hookInput;

  // Read current session state
  const sessionState = readSessionState();

  // Handle Task tool - extract role from prompt
  if (tool_name === 'Task' && tool_input?.prompt) {
    const role = extractRoleFromPrompt(tool_input.prompt);
    if (role && sessionState) {
      // Store pending subagent role
      sessionState.pendingSubagentRole = role;
      writeSessionState(sessionState);
      console.error(`[Mycelium] Task will spawn subagent with role: ${role}`);
    }
    // Always allow Task tool itself
    process.exit(0);
  }

  // Check if tool is allowed
  const { allowed, reason } = isToolAllowed(tool_name, sessionState);

  if (!allowed) {
    // Output to stderr for Claude to see
    console.error(`[Mycelium Policy] Access denied: ${reason}`);
    process.exit(2); // Exit code 2 = block the tool
  }

  // Tool is allowed, exit successfully
  process.exit(0);
}

main().catch(error => {
  console.error(`[mycelium-hook] Error: ${error.message}`);
  process.exit(1);
});
