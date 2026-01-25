/**
 * Tests for Adhoc Agent approval workflow
 */

import { describe, it, expect } from 'vitest';
import { DANGEROUS_TOOL_CATEGORIES } from '../src/agents/adhoc-agent.js';

// Test the approval check logic directly
// (We can't easily test the full AdhocAgent class due to SDK dependencies)

describe('Adhoc Agent Approval Logic', () => {
  /**
   * Recreate the checkApprovalRequired logic for testing
   */
  function checkApprovalRequired(toolName: string): {
    required: boolean;
    reason: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    category?: string;
  } {
    const getRiskLevel = (category: string): 'low' | 'medium' | 'high' | 'critical' => {
      switch (category) {
        case 'SHELL_EXEC':
          return 'critical';
        case 'FILE_WRITE':
          return 'high';
        case 'DATABASE':
          return 'high';
        case 'NETWORK':
          return 'medium';
        default:
          return 'low';
      }
    };

    for (const [category, tools] of Object.entries(DANGEROUS_TOOL_CATEGORIES)) {
      for (const dangerousTool of tools) {
        const toolSuffix = dangerousTool.includes('__')
          ? dangerousTool.split('__')[1]
          : dangerousTool;

        if (toolName === dangerousTool ||
            toolName.includes(dangerousTool) ||
            toolName.endsWith(toolSuffix)) {
          return {
            required: true,
            reason: `Dangerous operation: ${category}`,
            riskLevel: getRiskLevel(category),
            category,
          };
        }
      }
    }

    return { required: false, reason: '', riskLevel: 'low' };
  }

  describe('DANGEROUS_TOOL_CATEGORIES', () => {
    it('should have FILE_WRITE category', () => {
      expect(DANGEROUS_TOOL_CATEGORIES.FILE_WRITE).toBeDefined();
      expect(DANGEROUS_TOOL_CATEGORIES.FILE_WRITE).toContain('filesystem__write_file');
      expect(DANGEROUS_TOOL_CATEGORIES.FILE_WRITE).toContain('filesystem__delete_file');
    });

    it('should have SHELL_EXEC category', () => {
      expect(DANGEROUS_TOOL_CATEGORIES.SHELL_EXEC).toBeDefined();
      expect(DANGEROUS_TOOL_CATEGORIES.SHELL_EXEC).toContain('sandbox__exec');
    });

    it('should have NETWORK category', () => {
      expect(DANGEROUS_TOOL_CATEGORIES.NETWORK).toBeDefined();
    });

    it('should have DATABASE category', () => {
      expect(DANGEROUS_TOOL_CATEGORIES.DATABASE).toBeDefined();
    });
  });

  describe('checkApprovalRequired', () => {
    describe('FILE_WRITE operations', () => {
      it('should require approval for filesystem__write_file', () => {
        const result = checkApprovalRequired('filesystem__write_file');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('high');
        expect(result.category).toBe('FILE_WRITE');
      });

      it('should require approval for filesystem__delete_file', () => {
        const result = checkApprovalRequired('filesystem__delete_file');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('high');
      });

      it('should require approval for mcp__mycelium-router__filesystem__write_file', () => {
        const result = checkApprovalRequired('mcp__mycelium-router__filesystem__write_file');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('high');
      });
    });

    describe('SHELL_EXEC operations', () => {
      it('should require approval for sandbox__exec', () => {
        const result = checkApprovalRequired('sandbox__exec');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('critical');
        expect(result.category).toBe('SHELL_EXEC');
      });

      it('should require approval for bash__run', () => {
        const result = checkApprovalRequired('bash__run');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('critical');
      });

      it('should require approval for shell__exec', () => {
        const result = checkApprovalRequired('shell__exec');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('critical');
      });
    });

    describe('NETWORK operations', () => {
      it('should require approval for http__request', () => {
        const result = checkApprovalRequired('http__request');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('medium');
        expect(result.category).toBe('NETWORK');
      });
    });

    describe('DATABASE operations', () => {
      it('should require approval for postgres__execute', () => {
        const result = checkApprovalRequired('postgres__execute');
        expect(result.required).toBe(true);
        expect(result.riskLevel).toBe('high');
        expect(result.category).toBe('DATABASE');
      });
    });

    describe('Safe operations', () => {
      it('should NOT require approval for filesystem__read_file', () => {
        const result = checkApprovalRequired('filesystem__read_file');
        expect(result.required).toBe(false);
      });

      it('should NOT require approval for mycelium-skills__list_skills', () => {
        const result = checkApprovalRequired('mycelium-skills__list_skills');
        expect(result.required).toBe(false);
      });

      it('should NOT require approval for git__status', () => {
        const result = checkApprovalRequired('git__status');
        expect(result.required).toBe(false);
      });

      it('should NOT require approval for mycelium-session__session_save', () => {
        const result = checkApprovalRequired('mycelium-session__session_save');
        expect(result.required).toBe(false);
      });
    });

    describe('Suffix matching', () => {
      it('should match by suffix (write_file)', () => {
        const result = checkApprovalRequired('some_server__write_file');
        expect(result.required).toBe(true);
      });

      it('should match by suffix (delete_file)', () => {
        const result = checkApprovalRequired('another__delete_file');
        expect(result.required).toBe(true);
      });

      it('should match by suffix (exec)', () => {
        const result = checkApprovalRequired('mycelium-sandbox__exec');
        expect(result.required).toBe(true);
      });
    });
  });
});
