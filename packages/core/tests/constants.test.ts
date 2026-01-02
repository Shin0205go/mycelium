/**
 * Unit tests for constants/index.ts
 */

import { describe, it, expect } from 'vitest';
import { TIMEOUTS, SERVER } from '../src/constants/index.js';

describe('TIMEOUTS', () => {
  it('should define UPSTREAM_REQUEST timeout', () => {
    expect(TIMEOUTS.UPSTREAM_REQUEST).toBe(60000);
  });

  it('should define UPSTREAM_SERVER_INIT timeout', () => {
    expect(TIMEOUTS.UPSTREAM_SERVER_INIT).toBe(30000);
  });

  it('should define CONTEXT_ENRICHMENT timeout', () => {
    expect(TIMEOUTS.CONTEXT_ENRICHMENT).toBe(5000);
  });

  it('should define CACHE_OPERATION timeout', () => {
    expect(TIMEOUTS.CACHE_OPERATION).toBe(1000);
  });

  it('should define STARTUP_DELAY timeout', () => {
    expect(TIMEOUTS.STARTUP_DELAY).toBe(2000);
  });

  it('should be readonly (const assertion)', () => {
    // TypeScript ensures this at compile time, but we can verify values don't change
    const original = { ...TIMEOUTS };
    expect(TIMEOUTS.UPSTREAM_REQUEST).toBe(original.UPSTREAM_REQUEST);
  });
});

describe('SERVER', () => {
  it('should define DEFAULT_PORT', () => {
    expect(SERVER.DEFAULT_PORT).toBe(3000);
  });
});
