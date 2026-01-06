/**
 * Command-line argument parsing for aegis-cli
 */

export interface CliArgs {
  // Mode
  interactive: boolean;
  serve: boolean;

  // Server options
  port: number;
  host?: string;
  token?: string; // Bearer token for authentication

  // Sub-agent options
  role?: string;
  prompt?: string;
  json: boolean;

  // Common options
  model?: string;
  useApiKey: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const args: CliArgs = {
    interactive: true,
    serve: false,
    port: 3000,
    json: false,
    useApiKey: false,
    help: false,
    version: false,
  };

  let i = 0;
  const positional: string[] = [];

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      args.version = true;
    } else if (arg === 'serve') {
      args.serve = true;
      args.interactive = false;
    } else if (arg === '--port' || arg === '-P') {
      i++;
      args.port = parseInt(argv[i], 10) || 3000;
    } else if (arg === '--host' || arg === '-H') {
      i++;
      args.host = argv[i];
    } else if (arg === '--token' || arg === '-t') {
      i++;
      args.token = argv[i];
    } else if (arg === '--json' || arg === '-j') {
      args.json = true;
    } else if (arg === '--api-key') {
      args.useApiKey = true;
    } else if (arg === '--role' || arg === '-r') {
      i++;
      args.role = argv[i];
    } else if (arg === '--model' || arg === '-m') {
      i++;
      args.model = argv[i];
    } else if (arg === '--prompt' || arg === '-p') {
      i++;
      args.prompt = argv[i];
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }

    i++;
  }

  // If prompt not specified via --prompt, use positional argument
  if (!args.prompt && positional.length > 0) {
    args.prompt = positional.join(' ');
  }

  // If prompt is provided, switch to non-interactive mode
  if (args.prompt) {
    args.interactive = false;
  }

  return args;
}

export function showHelp(): void {
  console.log(`
AEGIS CLI - Agent Router Client

Usage:
  aegis-cli [options]                    # Interactive mode
  aegis-cli [options] <prompt>           # Sub-agent mode
  aegis-cli serve [options]              # HTTP server mode

Options:
  -r, --role <role>     Specify role (orchestrator, mentor, frontend, etc.)
  -p, --prompt <text>   Prompt to send (enables non-interactive mode)
  -j, --json            Output result as JSON (for sub-agent mode)
  -m, --model <model>   Model to use (claude-3-5-haiku-20241022, etc.)
  --api-key             Use ANTHROPIC_API_KEY instead of Claude Code auth
  -h, --help            Show this help message
  -v, --version         Show version

Server Options (for serve command):
  -P, --port <port>     HTTP server port (default: 3000)
  -H, --host <host>     HTTP server host (default: 0.0.0.0)
  -t, --token <token>   Bearer token for authentication (optional)

Examples:
  # Interactive mode
  aegis-cli

  # Sub-agent mode - simple query
  aegis-cli "What is 2+2?"

  # Sub-agent mode - with specific role
  aegis-cli --role mentor "Review this code pattern"

  # Sub-agent mode - JSON output for orchestration
  aegis-cli --role frontend --json "Create a button component"

  # HTTP server mode (for Apple Watch, etc.)
  aegis-cli serve --port 3000

  # HTTP server with Bearer token auth
  aegis-cli serve --port 3000 --token mysecrettoken

  # HTTP server with API key and token
  aegis-cli serve --port 3000 --api-key --token mysecrettoken
`);
}

export function showVersion(): void {
  console.log('aegis-cli v1.0.0');
}
