/**
 * Role Configuration Tests
 * Tests for role-based access control and tool filtering
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RoleConfigManager } from '../src/router/role-config.js';
import { Logger } from '../src/utils/logger.js';
import { join } from 'path';

// Set LOG_SILENT for tests
process.env.LOG_SILENT = 'true';
const testLogger = new Logger();

describe('RoleConfigManager', () => {
  let roleManager: RoleConfigManager;

  beforeAll(async () => {
    const projectRoot = process.cwd();
    roleManager = new RoleConfigManager(testLogger, {
      rolesDir: join(projectRoot, 'roles'),
      configFile: join(projectRoot, 'roles', 'aegis-roles.json'),
    });
    await roleManager.initialize();
  });

  describe('Role Loading', () => {
    it('should load all roles from config', () => {
      const roleIds = roleManager.getRoleIds();
      expect(roleIds.length).toBeGreaterThan(0);
    });

    it('should have orchestrator as default role', () => {
      expect(roleManager.getDefaultRoleId()).toBe('orchestrator');
    });

    it('should load expected roles', () => {
      const expectedRoles = ['orchestrator', 'frontend', 'backend', 'security', 'guest', 'devops'];
      for (const roleId of expectedRoles) {
        expect(roleManager.hasRole(roleId)).toBe(true);
      }
    });

    it('should load agents as roles', () => {
      // Agents defined in aegis-roles.json
      const agentRoles = ['formatter', 'reviewer', 'mentor'];
      for (const agentId of agentRoles) {
        expect(roleManager.hasRole(agentId)).toBe(true);
        expect(roleManager.isAgentRole(agentId)).toBe(true);
      }
    });
  });

  describe('Server Access Control', () => {
    it('orchestrator should have no allowed servers', () => {
      const role = roleManager.getRole('orchestrator');
      expect(role?.allowedServers).toEqual([]);
    });

    it('frontend should have filesystem access', () => {
      expect(roleManager.isServerAllowedForRole('frontend', 'filesystem')).toBe(true);
    });

    it('frontend should not have execution-server access', () => {
      expect(roleManager.isServerAllowedForRole('frontend', 'execution-server')).toBe(false);
    });

    it('devops should have access to all servers (via @all group)', () => {
      // devops uses @all which maps to ["*"]
      expect(roleManager.isServerAllowedForRole('devops', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('devops', 'any-server')).toBe(true);
    });

    it('guest should only have filesystem access', () => {
      expect(roleManager.isServerAllowedForRole('guest', 'filesystem')).toBe(true);
      expect(roleManager.isServerAllowedForRole('guest', 'playwright')).toBe(false);
    });
  });

  describe('Tool Permission Patterns', () => {
    it('system tool get_agent_manifest should always be allowed', () => {
      // System tools should be allowed for all roles
      expect(roleManager.isToolAllowedForRole('orchestrator', 'get_agent_manifest', 'aegis-router')).toBe(true);
      expect(roleManager.isToolAllowedForRole('guest', 'get_agent_manifest', 'aegis-router')).toBe(true);
    });

    it('frontend should allow read/write/list/search tools', () => {
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__write_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__list_directory', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__search_files', 'filesystem')).toBe(true);
    });

    it('frontend should deny delete/execute tools', () => {
      expect(roleManager.isToolAllowedForRole('frontend', 'filesystem__delete_file', 'filesystem')).toBe(false);
      expect(roleManager.isToolAllowedForRole('frontend', 'any__execute_command', 'filesystem')).toBe(false);
    });

    it('security should only allow read operations', () => {
      expect(roleManager.isToolAllowedForRole('security', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('security', 'filesystem__list_directory', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('security', 'filesystem__write_file', 'filesystem')).toBe(false);
      expect(roleManager.isToolAllowedForRole('security', 'filesystem__delete_file', 'filesystem')).toBe(false);
    });

    it('guest should only allow specific tools', () => {
      // Guest allows only filesystem__read_file and filesystem__list_directory
      expect(roleManager.isToolAllowedForRole('guest', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('guest', 'filesystem__list_directory', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('guest', 'filesystem__write_file', 'filesystem')).toBe(false);
      expect(roleManager.isToolAllowedForRole('guest', 'filesystem__search_files', 'filesystem')).toBe(false);
    });

    it('db_admin should have read-only filesystem access', () => {
      expect(roleManager.isToolAllowedForRole('db_admin', 'filesystem__read_file', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('db_admin', 'filesystem__list_directory', 'filesystem')).toBe(true);
      expect(roleManager.isToolAllowedForRole('db_admin', 'filesystem__write_file', 'filesystem')).toBe(false);
    });
  });

  describe('Agent Skill Filtering', () => {
    it('formatter agent should have specific skills', () => {
      const allowedSkills = roleManager.getAllowedSkillsForAgent('formatter');
      expect(allowedSkills).toContain('doc-coauthoring');
      expect(allowedSkills).toContain('docx');
      expect(allowedSkills).toContain('xlsx');
    });

    it('reviewer agent should have development skills', () => {
      const allowedSkills = roleManager.getAllowedSkillsForAgent('reviewer');
      expect(allowedSkills).toContain('mcp-builder');
      expect(allowedSkills).toContain('skill-creator');
    });

    it('mentor agent should have teaching-related skills', () => {
      const allowedSkills = roleManager.getAllowedSkillsForAgent('mentor');
      expect(allowedSkills).toContain('skill-creator');
      expect(allowedSkills).toContain('frontend-design');
    });

    it('should correctly filter skills for agents', () => {
      expect(roleManager.isSkillAllowedForAgent('formatter', 'docx')).toBe(true);
      expect(roleManager.isSkillAllowedForAgent('formatter', 'unknown-skill')).toBe(false);
    });
  });

  describe('Role Metadata', () => {
    it('all roles should be active by default', () => {
      const roles = roleManager.getAllRoles();
      for (const role of roles) {
        expect(role.metadata?.active).not.toBe(false);
      }
    });

    it('roles should have priority set', () => {
      const orchestrator = roleManager.getRole('orchestrator');
      const devops = roleManager.getRole('devops');
      expect(orchestrator?.metadata?.priority).toBeDefined();
      expect(devops?.metadata?.priority).toBeDefined();
    });
  });

  describe('Server Groups', () => {
    it('should resolve @development group', () => {
      // backend uses @development group
      const backend = roleManager.getRole('backend');
      expect(backend?.allowedServers).toContain('filesystem');
      expect(backend?.allowedServers).toContain('execution-server');
      expect(backend?.allowedServers).toContain('agent-skills');
    });

    it('should resolve @all group to wildcard', () => {
      const devops = roleManager.getRole('devops');
      // @all maps to ["*"] which allows all servers
      expect(devops?.allowedServers).toContain('*');
    });
  });

  describe('List Roles', () => {
    it('should list all active roles', () => {
      const result = roleManager.listRoles();
      expect(result.roles.length).toBeGreaterThan(0);
      expect(result.defaultRole).toBe('orchestrator');
    });

    it('should mark current role correctly', () => {
      const result = roleManager.listRoles({}, 'frontend');
      const frontendRole = result.roles.find(r => r.id === 'frontend');
      expect(frontendRole?.isCurrent).toBe(true);
    });
  });
});
