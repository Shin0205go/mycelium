#!/usr/bin/env node
// ============================================================================
// Mycelium Subagent Role Hook
// Manages role switching for subagents
// - SubagentStart: Apply pending role and save original
// - SubagentStop: Restore original role
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SESSION_FILE = join(homedir(), '.mycelium', 'session-state.json');

// Read session state
function readSessionState() {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

// Write session state
function writeSessionState(state) {
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[subagent-hook] Failed to write session state: ${error.message}`);
  }
}

// Role to allowed tools mapping (simplified - should sync with mycelium)
const ROLE_TOOLS = {
  viewer: [
    'filesystem__read_file',
    'filesystem__read_multiple_files',
    'filesystem__list_directory',
    'filesystem__directory_tree',
    'filesystem__search_files',
    'filesystem__get_file_info',
  ],
  developer: [
    'filesystem__read_file',
    'filesystem__read_multiple_files',
    'filesystem__write_file',
    'filesystem__edit_file',
    'filesystem__create_directory',
    'filesystem__list_directory',
    'filesystem__directory_tree',
    'filesystem__move_file',
    'filesystem__search_files',
    'filesystem__get_file_info',
  ],
};

// Main hook logic
async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookInput;
  try {
    hookInput = JSON.parse(input);
  } catch (error) {
    console.error(`[subagent-hook] Failed to parse input: ${error.message}`);
    process.exit(0);
  }

  const { hook_event_name, agent_id, agent_type } = hookInput;
  const state = readSessionState();

  if (!state) {
    process.exit(0);
  }

  // Handle SubagentStart
  if (hook_event_name === 'SubagentStart') {
    console.error(`[Mycelium] Subagent started: ${agent_id} (${agent_type})`);

    // Check for pending role from Task call
    if (state.pendingSubagentRole) {
      const newRole = state.pendingSubagentRole;
      const newTools = ROLE_TOOLS[newRole];

      if (newTools) {
        // Save current state for restoration
        state.subagentStack = state.subagentStack || [];
        state.subagentStack.push({
          agent_id,
          originalRole: state.role,
          originalAllowedTools: state.allowedTools,
        });

        // Apply new role
        state.role = newRole;
        state.roleName = newRole.charAt(0).toUpperCase() + newRole.slice(1);
        state.allowedTools = newTools;

        console.error(`[Mycelium] Subagent role set to: ${newRole}`);
      }

      // Clear pending role
      delete state.pendingSubagentRole;
      writeSessionState(state);
    }
  }

  // Handle SubagentStop
  if (hook_event_name === 'SubagentStop') {
    console.error(`[Mycelium] Subagent stopped: ${agent_id}`);

    // Restore previous role from stack
    if (state.subagentStack && state.subagentStack.length > 0) {
      const last = state.subagentStack.pop();

      if (last && last.agent_id === agent_id) {
        state.role = last.originalRole;
        state.allowedTools = last.originalAllowedTools;
        console.error(`[Mycelium] Restored role to: ${last.originalRole}`);
      }

      writeSessionState(state);
    }
  }

  process.exit(0);
}

main().catch(error => {
  console.error(`[subagent-hook] Error: ${error.message}`);
  process.exit(0);
});
