/**
 * Unit tests for args.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, showHelp, showVersion, type CliArgs } from '../src/args.js';

describe('parseArgs', () => {
  describe('default values', () => {
    it('should return default values when no args', () => {
      const args = parseArgs([]);

      expect(args.interactive).toBe(true);
      expect(args.json).toBe(false);
      expect(args.useApiKey).toBe(false);
      expect(args.help).toBe(false);
      expect(args.version).toBe(false);
      expect(args.role).toBeUndefined();
      expect(args.prompt).toBeUndefined();
      expect(args.model).toBeUndefined();
    });
  });

  describe('help flag', () => {
    it('should parse --help', () => {
      const args = parseArgs(['--help']);
      expect(args.help).toBe(true);
    });

    it('should parse -h', () => {
      const args = parseArgs(['-h']);
      expect(args.help).toBe(true);
    });
  });

  describe('version flag', () => {
    it('should parse --version', () => {
      const args = parseArgs(['--version']);
      expect(args.version).toBe(true);
    });

    it('should parse -v', () => {
      const args = parseArgs(['-v']);
      expect(args.version).toBe(true);
    });
  });

  describe('json flag', () => {
    it('should parse --json', () => {
      const args = parseArgs(['--json']);
      expect(args.json).toBe(true);
    });

    it('should parse -j', () => {
      const args = parseArgs(['-j']);
      expect(args.json).toBe(true);
    });
  });

  describe('api-key flag', () => {
    it('should parse --api-key', () => {
      const args = parseArgs(['--api-key']);
      expect(args.useApiKey).toBe(true);
    });
  });

  describe('role option', () => {
    it('should parse --role with value', () => {
      const args = parseArgs(['--role', 'admin']);
      expect(args.role).toBe('admin');
    });

    it('should parse -r with value', () => {
      const args = parseArgs(['-r', 'developer']);
      expect(args.role).toBe('developer');
    });
  });

  describe('model option', () => {
    it('should parse --model with value', () => {
      const args = parseArgs(['--model', 'claude-3-opus']);
      expect(args.model).toBe('claude-3-opus');
    });

    it('should parse -m with value', () => {
      const args = parseArgs(['-m', 'claude-3-haiku']);
      expect(args.model).toBe('claude-3-haiku');
    });
  });

  describe('prompt option', () => {
    it('should parse --prompt with value', () => {
      const args = parseArgs(['--prompt', 'Hello world']);
      expect(args.prompt).toBe('Hello world');
    });

    it('should parse -p with value', () => {
      const args = parseArgs(['-p', 'Test prompt']);
      expect(args.prompt).toBe('Test prompt');
    });

    it('should set interactive to false when prompt provided', () => {
      const args = parseArgs(['--prompt', 'Hello']);
      expect(args.interactive).toBe(false);
    });
  });

  describe('positional arguments', () => {
    it('should use positional argument as prompt', () => {
      const args = parseArgs(['What is 2+2?']);
      expect(args.prompt).toBe('What is 2+2?');
      expect(args.interactive).toBe(false);
    });

    it('should join multiple positional arguments', () => {
      const args = parseArgs(['Hello', 'world', 'test']);
      expect(args.prompt).toBe('Hello world test');
    });

    it('should not override explicit --prompt with positional', () => {
      const args = parseArgs(['--prompt', 'explicit', 'positional']);
      expect(args.prompt).toBe('explicit');
    });
  });

  describe('combined options', () => {
    it('should parse multiple flags together', () => {
      const args = parseArgs(['-j', '--api-key', '-r', 'admin']);

      expect(args.json).toBe(true);
      expect(args.useApiKey).toBe(true);
      expect(args.role).toBe('admin');
    });

    it('should parse all options with prompt', () => {
      const args = parseArgs([
        '-r', 'developer',
        '-m', 'claude-3-opus',
        '-j',
        '--api-key',
        'Build a React component'
      ]);

      expect(args.role).toBe('developer');
      expect(args.model).toBe('claude-3-opus');
      expect(args.json).toBe(true);
      expect(args.useApiKey).toBe(true);
      expect(args.prompt).toBe('Build a React component');
      expect(args.interactive).toBe(false);
    });
  });

  describe('unknown options', () => {
    let mockExit: ReturnType<typeof vi.spyOn>;
    let mockError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it('should exit on unknown option', () => {
      parseArgs(['--unknown-option']);

      expect(mockError).toHaveBeenCalledWith('Unknown option: --unknown-option');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit on unknown short option', () => {
      parseArgs(['-x']);

      expect(mockError).toHaveBeenCalledWith('Unknown option: -x');
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});

describe('showHelp', () => {
  let mockLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockLog.mockRestore();
  });

  it('should print help text', () => {
    showHelp();

    expect(mockLog).toHaveBeenCalled();
    const output = mockLog.mock.calls[0][0];
    expect(output).toContain('MYCELIUM CLI');
    expect(output).toContain('Usage:');
    expect(output).toContain('--role');
    expect(output).toContain('--prompt');
    expect(output).toContain('--json');
    expect(output).toContain('Examples:');
  });
});

describe('showVersion', () => {
  let mockLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockLog.mockRestore();
  });

  it('should print version', () => {
    showVersion();

    expect(mockLog).toHaveBeenCalledWith('aegis-cli v1.0.0');
  });
});
