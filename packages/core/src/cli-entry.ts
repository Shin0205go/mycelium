#!/usr/bin/env node
/**
 * AEGIS CLI - Agent router client with dynamic role switching
 *
 * Supports three modes:
 * 1. Interactive mode (default) - REPL with role switching
 * 2. Sub-agent mode - Non-interactive, for orchestrator integration
 * 3. HTTP server mode - REST API for Apple Watch and other clients
 */

import { parseArgs, showHelp, showVersion } from './args.js';
import { AegisCLI } from './cli.js';
import { SubAgent } from './sub-agent.js';
import { startHttpServer } from './http-server.js';

async function main() {
  const args = parseArgs();

  // Handle help/version
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    showVersion();
    process.exit(0);
  }

  // Choose mode
  if (args.serve) {
    // HTTP server mode
    await startHttpServer({
      port: args.port,
      host: args.host,
      useApiKey: args.useApiKey,
      model: args.model,
      authToken: args.token,
    });
  } else if (args.interactive) {
    // Interactive REPL mode
    const cli = new AegisCLI();
    await cli.run();
  } else {
    // Sub-agent mode (non-interactive)
    const subAgent = new SubAgent(args);
    await subAgent.run();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
