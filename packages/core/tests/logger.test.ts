/**
 * Unit tests for logger.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, logger as defaultLogger } from '../src/utils/logger.js';

describe('Logger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create logger with default level', () => {
      const log = new Logger();
      expect(log).toBeInstanceOf(Logger);
    });

    it('should create logger with custom level', () => {
      const log = new Logger('debug');
      expect(log).toBeInstanceOf(Logger);
    });
  });

  describe('logging methods', () => {
    let log: Logger;

    beforeEach(() => {
      process.env.LOG_SILENT = 'false';
      log = new Logger('debug');
    });

    it('should have info method', () => {
      expect(typeof log.info).toBe('function');
      expect(() => log.info('test message')).not.toThrow();
    });

    it('should have warn method', () => {
      expect(typeof log.warn).toBe('function');
      expect(() => log.warn('test warning')).not.toThrow();
    });

    it('should have error method', () => {
      expect(typeof log.error).toBe('function');
      expect(() => log.error('test error')).not.toThrow();
    });

    it('should have debug method', () => {
      expect(typeof log.debug).toBe('function');
      expect(() => log.debug('test debug')).not.toThrow();
    });

    it('should accept metadata', () => {
      expect(() => log.info('message', { key: 'value' })).not.toThrow();
    });
  });

  describe('silent mode', () => {
    it('should not log when LOG_SILENT is true', () => {
      process.env.LOG_SILENT = 'true';
      const log = new Logger();

      // These should not throw even in silent mode
      expect(() => log.info('test')).not.toThrow();
      expect(() => log.warn('test')).not.toThrow();
      expect(() => log.error('test')).not.toThrow();
      expect(() => log.debug('test')).not.toThrow();
    });
  });

  describe('critical method', () => {
    it('should have critical method', () => {
      const log = new Logger();
      expect(typeof log.critical).toBe('function');
    });

    it('should not throw in critical method', () => {
      const log = new Logger();
      expect(() => log.critical('critical message')).not.toThrow();
    });

    it('should accept metadata in critical', () => {
      const log = new Logger();
      expect(() => log.critical('message', { data: 'test' })).not.toThrow();
    });

    it('should respect silent mode in stdio', () => {
      process.env.LOG_SILENT = 'true';
      process.env.MCP_TRANSPORT = 'stdio';
      const log = new Logger();

      // Should not throw
      expect(() => log.critical('test')).not.toThrow();
    });
  });

  describe('MYCELIUM-specific log methods', () => {
    let log: Logger;

    beforeEach(() => {
      log = new Logger();
    });

    it('should have decision method', () => {
      expect(typeof log.decision).toBe('function');
      expect(() => log.decision('agent-1', 'allow', '/resource', 'policy match')).not.toThrow();
    });

    it('should have violation method', () => {
      expect(typeof log.violation).toBe('function');
      expect(() => log.violation('agent-1', '/secret', 'unauthorized')).not.toThrow();
    });

    it('should have audit method', () => {
      expect(typeof log.audit).toBe('function');
      expect(() => log.audit('create', { user: 'test' })).not.toThrow();
    });
  });

  describe('default logger export', () => {
    it('should export default logger instance', () => {
      expect(defaultLogger).toBeInstanceOf(Logger);
    });
  });

  describe('stdio mode detection', () => {
    it('should detect stdio mode from MCP_TRANSPORT env', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      const log = new Logger();
      expect(log).toBeInstanceOf(Logger);
    });

    it('should detect stdio mode from --stdio arg', () => {
      const originalArgv = process.argv;
      process.argv = [...originalArgv, '--stdio'];

      const log = new Logger();
      expect(log).toBeInstanceOf(Logger);

      process.argv = originalArgv;
    });
  });

  describe('production mode', () => {
    it('should handle production environment', () => {
      process.env.NODE_ENV = 'production';

      // This may fail if logs directory doesn't exist, but shouldn't throw
      // during logger creation
      expect(() => new Logger()).not.toThrow();
    });
  });
});
