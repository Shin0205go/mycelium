/**
 * Session State Management
 * Tracks active skills and available tools during a session
 */

import type {
  SessionState,
  SkillChange,
  SkillDefinition,
} from '@mycelium/shared';

/**
 * Manages session state for dynamic skill management
 */
export class SessionStateManager {
  private state: SessionState;
  private skillDefinitions: Map<string, SkillDefinition>;
  private roleAllowedSkills: Set<string>;

  constructor(
    skills: SkillDefinition[],
    userRole: string,
    allowedSkillsForRole: string[] = ['*'],
    defaultSkills: string[] = []
  ) {
    this.skillDefinitions = new Map(skills.map((s) => [s.id, s]));
    this.roleAllowedSkills = new Set(
      allowedSkillsForRole.includes('*')
        ? skills.map((s) => s.id)
        : allowedSkillsForRole
    );

    // Initialize with default skills (filtered by role permissions)
    const validDefaultSkills = defaultSkills.filter((id) =>
      this.canActivateSkill(id)
    );

    this.state = {
      activeSkills: validDefaultSkills,
      availableTools: this.computeAvailableTools(validDefaultSkills),
      userRole,
      skillHistory: [],
      startedAt: new Date(),
    };
  }

  /**
   * Get current session state (immutable snapshot)
   */
  getState(): Readonly<SessionState> {
    return { ...this.state };
  }

  /**
   * Get currently active skill IDs
   */
  getActiveSkills(): string[] {
    return [...this.state.activeSkills];
  }

  /**
   * Get available tools from active skills
   */
  getAvailableTools(): string[] {
    return [...this.state.availableTools];
  }

  /**
   * Check if a skill can be activated (role permission check)
   */
  canActivateSkill(skillId: string): boolean {
    // Check if skill exists
    if (!this.skillDefinitions.has(skillId)) {
      return false;
    }

    // Check if role allows this skill
    return this.roleAllowedSkills.has(skillId);
  }

  /**
   * Check if a skill is currently active
   */
  isSkillActive(skillId: string): boolean {
    return this.state.activeSkills.includes(skillId);
  }

  /**
   * Escalate: Add a skill to active skills
   * @returns true if skill was added, false if already active or not allowed
   */
  escalate(skillId: string, reason: string): boolean {
    if (!this.canActivateSkill(skillId)) {
      return false;
    }

    if (this.isSkillActive(skillId)) {
      return false;
    }

    this.state.activeSkills.push(skillId);
    this.state.availableTools = this.computeAvailableTools(
      this.state.activeSkills
    );

    this.state.skillHistory.push({
      type: 'escalate',
      skillId,
      reason,
      timestamp: new Date(),
    });

    return true;
  }

  /**
   * Deescalate: Remove a skill from active skills
   * @returns true if skill was removed, false if not active
   */
  deescalate(skillId: string, reason: string): boolean {
    const index = this.state.activeSkills.indexOf(skillId);
    if (index === -1) {
      return false;
    }

    this.state.activeSkills.splice(index, 1);
    this.state.availableTools = this.computeAvailableTools(
      this.state.activeSkills
    );

    this.state.skillHistory.push({
      type: 'deescalate',
      skillId,
      reason,
      timestamp: new Date(),
    });

    return true;
  }

  /**
   * Apply skill changes (escalation and deescalation)
   * @returns list of changes that were applied
   */
  applyChanges(
    escalate: string[],
    deescalate: string[],
    reason: string
  ): SkillChange[] {
    const changes: SkillChange[] = [];

    // First deescalate
    for (const skillId of deescalate) {
      if (this.deescalate(skillId, reason)) {
        changes.push({
          type: 'deescalate',
          skillId,
          reason,
          timestamp: new Date(),
        });
      }
    }

    // Then escalate
    for (const skillId of escalate) {
      if (this.escalate(skillId, reason)) {
        changes.push({
          type: 'escalate',
          skillId,
          reason,
          timestamp: new Date(),
        });
      }
    }

    return changes;
  }

  /**
   * Get skill definition by ID
   */
  getSkillDefinition(skillId: string): SkillDefinition | undefined {
    return this.skillDefinitions.get(skillId);
  }

  /**
   * Get all skill definitions
   */
  getAllSkillDefinitions(): SkillDefinition[] {
    return Array.from(this.skillDefinitions.values());
  }

  /**
   * Get skills allowed for the current role
   */
  getAllowedSkillsForRole(): string[] {
    return Array.from(this.roleAllowedSkills);
  }

  /**
   * Get skill change history
   */
  getHistory(): SkillChange[] {
    return [...this.state.skillHistory];
  }

  /**
   * Format skill change notification for display
   */
  formatSkillNotification(changes: SkillChange[]): string {
    if (changes.length === 0) {
      return '';
    }

    const escalatedSkills = changes
      .filter((c) => c.type === 'escalate')
      .map((c) => c.skillId);

    const before = this.state.activeSkills
      .filter((s: string) => !escalatedSkills.includes(s));

    const current = this.state.activeSkills;

    // Format: [before] → [after]
    const beforeStr = before.length > 0 ? before.join(', ') : 'base';
    const afterStr = current.length > 0 ? current.join(', ') : 'base';

    if (beforeStr === afterStr) {
      return '';
    }

    return `[${beforeStr}] → [${afterStr}]`;
  }

  /**
   * Compute available tools from active skills
   */
  private computeAvailableTools(activeSkillIds: string[]): string[] {
    const tools = new Set<string>();

    for (const skillId of activeSkillIds) {
      const skill = this.skillDefinitions.get(skillId);
      if (skill) {
        for (const tool of skill.allowedTools) {
          tools.add(tool);
        }
      }
    }

    return Array.from(tools);
  }
}

/**
 * Create a new session state manager
 */
export function createSessionStateManager(
  skills: SkillDefinition[],
  userRole: string,
  allowedSkillsForRole?: string[],
  defaultSkills?: string[]
): SessionStateManager {
  return new SessionStateManager(
    skills,
    userRole,
    allowedSkillsForRole,
    defaultSkills
  );
}
