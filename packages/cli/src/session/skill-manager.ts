/**
 * Skill Manager
 * Handles skill escalation and de-escalation logic
 */

import type {
  SkillDefinition,
  SkillChange,
  IntentClassificationResult,
} from '@mycelium/shared';
import { SessionStateManager } from './session-state.js';

export interface SkillManagerConfig {
  /** Session state manager */
  sessionState: SessionStateManager;

  /** Callback when skills change */
  onSkillChange?: (changes: SkillChange[], notification: string) => void;
}

/**
 * Manages skill escalation and de-escalation based on intent
 */
export class SkillManager {
  private sessionState: SessionStateManager;
  private onSkillChange?: (changes: SkillChange[], notification: string) => void;

  constructor(config: SkillManagerConfig) {
    this.sessionState = config.sessionState;
    this.onSkillChange = config.onSkillChange;
  }

  /**
   * Get the underlying session state manager
   */
  getSessionState(): SessionStateManager {
    return this.sessionState;
  }

  /**
   * Process intent classification result and apply skill changes
   * @returns notification string if changes were made
   */
  processIntent(classification: IntentClassificationResult): string {
    const { requiredSkills, deescalateSkills } = classification;

    // Filter to only skills that need to be escalated (not already active)
    const toEscalate = requiredSkills.filter(
      (skillId) =>
        !this.sessionState.isSkillActive(skillId) &&
        this.sessionState.canActivateSkill(skillId)
    );

    // Filter to only skills that are currently active
    const toDeescalate = deescalateSkills.filter((skillId) =>
      this.sessionState.isSkillActive(skillId)
    );

    // No changes needed
    if (toEscalate.length === 0 && toDeescalate.length === 0) {
      return '';
    }

    // Apply changes
    const changes = this.sessionState.applyChanges(
      toEscalate,
      toDeescalate,
      classification.reason
    );

    // Generate notification
    const notification = this.formatNotification(changes);

    // Callback
    if (this.onSkillChange && changes.length > 0) {
      this.onSkillChange(changes, notification);
    }

    return notification;
  }

  /**
   * Manually escalate a skill
   */
  escalate(skillId: string, reason: string = 'manual'): string {
    if (!this.sessionState.canActivateSkill(skillId)) {
      return `[${skillId} は許可されていません]`;
    }

    if (this.sessionState.isSkillActive(skillId)) {
      return ''; // Already active
    }

    const success = this.sessionState.escalate(skillId, reason);
    if (!success) {
      return '';
    }

    const changes: SkillChange[] = [
      {
        type: 'escalate',
        skillId,
        reason,
        timestamp: new Date(),
      },
    ];

    const notification = this.formatNotification(changes);

    if (this.onSkillChange) {
      this.onSkillChange(changes, notification);
    }

    return notification;
  }

  /**
   * Manually de-escalate a skill
   */
  deescalate(skillId: string, reason: string = 'manual'): string {
    if (!this.sessionState.isSkillActive(skillId)) {
      return ''; // Not active
    }

    const success = this.sessionState.deescalate(skillId, reason);
    if (!success) {
      return '';
    }

    const changes: SkillChange[] = [
      {
        type: 'deescalate',
        skillId,
        reason,
        timestamp: new Date(),
      },
    ];

    const notification = this.formatNotification(changes);

    if (this.onSkillChange) {
      this.onSkillChange(changes, notification);
    }

    return notification;
  }

  /**
   * Get current active skills
   */
  getActiveSkills(): string[] {
    return this.sessionState.getActiveSkills();
  }

  /**
   * Get available tools from active skills
   */
  getAvailableTools(): string[] {
    return this.sessionState.getAvailableTools();
  }

  /**
   * Get skill definition by ID
   */
  getSkillDefinition(skillId: string): SkillDefinition | undefined {
    return this.sessionState.getSkillDefinition(skillId);
  }

  /**
   * Format skill change notification
   */
  private formatNotification(changes: SkillChange[]): string {
    if (changes.length === 0) {
      return '';
    }

    const escalated = changes
      .filter((c) => c.type === 'escalate')
      .map((c) => `+${c.skillId}`);

    const deescalated = changes
      .filter((c) => c.type === 'deescalate')
      .map((c) => `-${c.skillId}`);

    const parts = [...escalated, ...deescalated];
    const activeSkills = this.sessionState.getActiveSkills();

    return `[${activeSkills.join(', ') || 'base'}] (${parts.join(', ')})`;
  }
}

/**
 * Create a skill manager
 */
export function createSkillManager(config: SkillManagerConfig): SkillManager {
  return new SkillManager(config);
}
