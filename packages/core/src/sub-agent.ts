/**
 * SubAgent - Non-interactive mode for aegis-cli
 * Used when spawned as a child process by an orchestrator agent
 *
 * SDK-only version: Uses Claude Agent SDK directly, no MCPClient
 */

import { createQuery, extractTextFromMessage, isToolUseMessage, getToolUseInfo } from './agent.js';
import type { CliArgs } from './args.js';

export interface SubAgentResult {
  success: boolean;
  role: string;
  result?: string;
  error?: string;
  toolsUsed?: string[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
}

export class SubAgent {
  private args: CliArgs;

  constructor(args: CliArgs) {
    this.args = args;
  }

  async run(): Promise<void> {
    let prompt = this.args.prompt;

    // If no prompt provided, try reading from stdin
    if (!prompt) {
      prompt = await this.readStdin();
    }

    if (!prompt) {
      this.outputError('No prompt provided');
      process.exit(1);
    }

    try {
      // Determine role - prefer env var (set by parent orchestrator) over args
      const roleFromEnv = process.env.AEGIS_CURRENT_ROLE;
      const roleId = roleFromEnv || this.args.role || 'orchestrator';

      // Run the query using SDK directly
      // Role is passed via currentRole option to createQuery
      // Session is persisted per role for continuity
      const result = await this.executeQuery(prompt, roleId);

      // Output result
      this.outputResult(result);

      process.exit(result.success ? 0 : 1);
    } catch (error: any) {
      this.outputError(error.message || String(error));
      process.exit(1);
    }
  }

  private async readStdin(): Promise<string | undefined> {
    // Check if stdin is a TTY (interactive terminal)
    if (process.stdin.isTTY) {
      return undefined;
    }

    return new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => {
        resolve(data.trim() || undefined);
      });
      // Timeout after 100ms if no data
      setTimeout(() => {
        if (!data) {
          resolve(undefined);
        }
      }, 100);
    });
  }

  private async executeQuery(
    prompt: string,
    roleId: string
  ): Promise<SubAgentResult> {
    const toolsUsed: string[] = [];
    let resultText = '';
    let usage: SubAgentResult['usage'] | undefined;
    let error: string | undefined;

    try {
      const queryResult = createQuery(prompt, {
        model: this.args.model || 'claude-3-5-haiku-20241022',
        includePartialMessages: true,
        useApiKey: this.args.useApiKey,
        currentRole: roleId,
        persistSession: true,   // Enable per-role session persistence
        continueSession: true   // Continue from previous session of same role
      });

      for await (const msg of queryResult) {
        // Collect tool usage
        if (msg.type === 'assistant' && isToolUseMessage(msg)) {
          const tools = getToolUseInfo(msg);
          for (const tool of tools) {
            const shortName = tool.name.replace('mcp__aegis-router__', '');
            toolsUsed.push(shortName);

            // Output progress to stderr in JSON mode
            if (this.args.json) {
              console.error(`[tool] ${shortName}`);
            }
          }
        }

        // Collect text output
        if (msg.type === 'assistant') {
          const text = extractTextFromMessage(msg);
          if (text) {
            resultText = text;
          }
        }

        // Handle result
        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            usage = {
              inputTokens: msg.usage.input_tokens,
              outputTokens: msg.usage.output_tokens,
              costUSD: msg.total_cost_usd
            };
          } else {
            error = msg.errors?.join(', ') || `Error: ${msg.subtype}`;
          }
        }
      }

      return {
        success: !error,
        role: roleId,
        result: resultText,
        error,
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
        usage
      };
    } catch (e: any) {
      return {
        success: false,
        role: roleId,
        error: e.message || String(e)
      };
    }
  }

  private outputResult(result: SubAgentResult): void {
    if (this.args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.success) {
        console.log(result.result);
        if (result.usage) {
          console.error(`\n[${result.role}] Tokens: ${result.usage.inputTokens}/${result.usage.outputTokens} | Cost: $${result.usage.costUSD.toFixed(4)}`);
        }
      } else {
        console.error(`Error: ${result.error}`);
      }
    }
  }

  private outputError(message: string): void {
    if (this.args.json) {
      console.log(JSON.stringify({
        success: false,
        role: this.args.role || 'orchestrator',
        error: message
      }, null, 2));
    } else {
      console.error(`Error: ${message}`);
    }
  }
}
