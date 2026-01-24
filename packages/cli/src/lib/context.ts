/**
 * Context file handling for Workflow → Adhoc handoff
 *
 * When a workflow fails, context is saved to a JSON file.
 * Adhoc agent can load this context to understand what happened.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Script execution error details
 */
export interface ScriptError {
  message: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Workflow execution context saved on failure
 */
export interface WorkflowContext {
  /** Skill ID that was executed */
  skillId: string;

  /** Path to the script within the skill */
  scriptPath: string;

  /** Arguments passed to the script */
  args?: string[];

  /** Error details from the failed execution */
  error: ScriptError;

  /** ISO8601 timestamp of when the failure occurred */
  timestamp: string;

  /** Optional summary of the conversation before failure */
  conversationSummary?: string;

  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
}

/** Default context file name */
const DEFAULT_CONTEXT_FILE = 'workflow-context.json';

/**
 * Get the default context file path
 * Uses current working directory
 */
export function getDefaultContextPath(): string {
  return path.join(process.cwd(), DEFAULT_CONTEXT_FILE);
}

/**
 * Write workflow context to a JSON file
 *
 * @param context - The workflow context to save
 * @param filePath - Optional custom file path (defaults to ./workflow-context.json)
 * @returns The path where the context was saved
 */
export async function writeContext(
  context: WorkflowContext,
  filePath?: string
): Promise<string> {
  const targetPath = filePath || getDefaultContextPath();

  // Ensure timestamp is set
  const contextWithTimestamp: WorkflowContext = {
    ...context,
    timestamp: context.timestamp || new Date().toISOString(),
  };

  await fs.writeFile(
    targetPath,
    JSON.stringify(contextWithTimestamp, null, 2),
    'utf-8'
  );

  return targetPath;
}

/**
 * Read workflow context from a JSON file
 *
 * @param filePath - Path to the context file
 * @returns The parsed workflow context
 * @throws Error if file doesn't exist or is invalid JSON
 */
export async function readContext(filePath: string): Promise<WorkflowContext> {
  const content = await fs.readFile(filePath, 'utf-8');
  const context = JSON.parse(content) as WorkflowContext;

  // Validate required fields
  if (!context.skillId || !context.scriptPath || !context.error) {
    throw new Error('Invalid context file: missing required fields');
  }

  return context;
}

/**
 * Check if a context file exists
 *
 * @param filePath - Path to check
 * @returns true if the file exists
 */
export async function contextExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a context file
 *
 * @param filePath - Path to the context file
 */
export async function deleteContext(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Format context for display in CLI
 *
 * @param context - The workflow context
 * @returns Formatted string for display
 */
export function formatContextForDisplay(context: WorkflowContext): string {
  const lines = [
    `Skill: ${context.skillId}`,
    `Script: ${context.scriptPath}`,
  ];

  if (context.args && context.args.length > 0) {
    lines.push(`Args: ${context.args.join(' ')}`);
  }

  lines.push(`Time: ${context.timestamp}`);
  lines.push('');
  lines.push(`Error (exit code ${context.error.exitCode}):`);
  lines.push(`  ${context.error.message}`);

  if (context.error.stderr) {
    lines.push('');
    lines.push('stderr:');
    lines.push(context.error.stderr.split('\n').map(l => `  ${l}`).join('\n'));
  }

  if (context.error.stdout) {
    lines.push('');
    lines.push('stdout:');
    lines.push(context.error.stdout.split('\n').map(l => `  ${l}`).join('\n'));
  }

  if (context.conversationSummary) {
    lines.push('');
    lines.push('Conversation Summary:');
    lines.push(context.conversationSummary.split('\n').map(l => `  ${l}`).join('\n'));
  }

  return lines.join('\n');
}
