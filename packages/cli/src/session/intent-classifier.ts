/**
 * Intent Classifier
 * Maps user input to required skills based on keywords and patterns
 */

import type {
  SkillDefinition,
  IntentClassificationResult,
} from '@mycelium/shared';

/**
 * Built-in trigger patterns for common intents
 * These are used when skills don't define explicit triggers
 */
const DEFAULT_SKILL_TRIGGERS: Record<string, string[]> = {
  // File reading
  'reader': [
    '読んで', '確認して', '見せて', '見て', '表示', '開いて',
    'read', 'show', 'display', 'open', 'cat', 'view',
  ],
  // File editing
  'editor': [
    '編集', '書き換え', '修正', '変更', '更新', '書いて', '作成',
    'edit', 'modify', 'change', 'update', 'write', 'create', 'fix',
  ],
  'code-modifier': [
    '編集', '書き換え', '修正', '変更', '更新', '書いて', '作成',
    'edit', 'modify', 'change', 'update', 'write', 'create', 'fix',
    'refactor', 'リファクタ',
  ],
  // Testing
  'tester': [
    'テスト', '実行', '検証', 'test', 'run', 'execute', 'verify',
  ],
  'test-runner': [
    'テスト', 'test', 'spec', 'jest', 'vitest', 'pytest',
  ],
  // Git operations
  'git-workflow': [
    'commit', 'push', 'pull', 'branch', 'merge', 'git', 'コミット',
    'プッシュ', 'ブランチ', 'マージ', 'diff', '差分',
  ],
  // Build
  'build-check': [
    'build', 'ビルド', 'compile', 'コンパイル', 'bundle',
  ],
  // Documentation
  'doc-updater': [
    'ドキュメント', 'document', 'readme', 'docs', 'doc',
  ],
};

/**
 * Patterns that suggest ending a task (for de-escalation)
 */
const TASK_END_PATTERNS = [
  '終わり', '完了', '終了', 'done', 'finished', 'complete', 'ありがとう',
  '次', 'next', '別の', 'other', 'それは良い', 'ok', 'okay', 'オーケー',
];

export interface IntentClassifierConfig {
  /** Available skill definitions */
  skills: SkillDefinition[];

  /** Currently active skills */
  activeSkills: string[];

  /** Custom trigger overrides */
  customTriggers?: Record<string, string[]>;

  /** Skills that should never be de-escalated */
  protectedSkills?: string[];
}

/**
 * Classifies user intent and determines required skills
 */
export class IntentClassifier {
  private skills: Map<string, SkillDefinition>;
  private triggers: Map<string, string[]>;
  private activeSkills: Set<string>;
  private protectedSkills: Set<string>;

  constructor(config: IntentClassifierConfig) {
    this.skills = new Map(config.skills.map((s) => [s.id, s]));
    this.activeSkills = new Set(config.activeSkills);
    this.protectedSkills = new Set(config.protectedSkills || []);

    // Build trigger map: skill triggers from definition > default > custom override
    this.triggers = new Map();
    for (const skill of config.skills) {
      const skillTriggers = skill.triggers ||
        DEFAULT_SKILL_TRIGGERS[skill.id] ||
        [];
      this.triggers.set(skill.id, skillTriggers);
    }

    // Apply custom overrides
    if (config.customTriggers) {
      for (const [skillId, triggers] of Object.entries(config.customTriggers)) {
        this.triggers.set(skillId, triggers);
      }
    }
  }

  /**
   * Update active skills (called after skill changes)
   */
  updateActiveSkills(activeSkills: string[]): void {
    this.activeSkills = new Set(activeSkills);
  }

  /**
   * Classify user input and determine required skills
   */
  classify(input: string): IntentClassificationResult {
    const normalizedInput = input.toLowerCase();
    const requiredSkills: string[] = [];
    const deescalateSkills: string[] = [];
    const matchedTriggers: string[] = [];

    // Check for task end patterns (for de-escalation)
    const isTaskEnding = TASK_END_PATTERNS.some((pattern) =>
      normalizedInput.includes(pattern.toLowerCase())
    );

    // Find skills that match the input
    for (const [skillId, triggers] of this.triggers.entries()) {
      const matched = triggers.some((trigger) =>
        normalizedInput.includes(trigger.toLowerCase())
      );

      if (matched) {
        requiredSkills.push(skillId);
        matchedTriggers.push(skillId);
      }
    }

    // If task is ending and we have new required skills,
    // consider de-escalating skills not in the new set (except protected skills)
    if (isTaskEnding && requiredSkills.length > 0) {
      for (const activeSkill of this.activeSkills) {
        if (!requiredSkills.includes(activeSkill) && !this.protectedSkills.has(activeSkill)) {
          deescalateSkills.push(activeSkill);
        }
      }
    }

    // Calculate confidence based on match quality
    const confidence = this.calculateConfidence(
      input,
      matchedTriggers,
      isTaskEnding
    );

    // Generate reason
    const reason = this.generateReason(
      matchedTriggers,
      deescalateSkills,
      isTaskEnding
    );

    return {
      requiredSkills,
      deescalateSkills,
      confidence,
      reason,
    };
  }

  /**
   * Get skill definitions that have triggers matching the input
   */
  getMatchingSkills(input: string): SkillDefinition[] {
    const result = this.classify(input);
    return result.requiredSkills
      .map((id) => this.skills.get(id))
      .filter((s): s is SkillDefinition => s !== undefined);
  }

  /**
   * Calculate confidence score for classification
   */
  private calculateConfidence(
    input: string,
    matchedTriggers: string[],
    isTaskEnding: boolean
  ): number {
    if (matchedTriggers.length === 0) {
      return 0;
    }

    // Base confidence from number of matches
    let confidence = Math.min(matchedTriggers.length * 0.3, 0.9);

    // Boost if input is specific (longer, more keywords)
    const wordCount = input.split(/\s+/).length;
    if (wordCount > 5) {
      confidence += 0.1;
    }

    // Reduce confidence if task ending detected but no clear next task
    if (isTaskEnding && matchedTriggers.length === 0) {
      confidence *= 0.5;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate human-readable reason for classification
   */
  private generateReason(
    matchedTriggers: string[],
    deescalateSkills: string[],
    isTaskEnding: boolean
  ): string {
    const parts: string[] = [];

    if (matchedTriggers.length > 0) {
      parts.push(`intent matched: ${matchedTriggers.join(', ')}`);
    }

    if (deescalateSkills.length > 0) {
      parts.push(`task ended: ${deescalateSkills.join(', ')}`);
    }

    if (isTaskEnding && matchedTriggers.length === 0) {
      parts.push('task completion detected');
    }

    return parts.join('; ') || 'no specific intent detected';
  }
}

/**
 * Create an intent classifier
 */
export function createIntentClassifier(
  config: IntentClassifierConfig
): IntentClassifier {
  return new IntentClassifier(config);
}
