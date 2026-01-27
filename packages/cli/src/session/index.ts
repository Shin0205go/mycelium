/**
 * Session-based Skill Management Module
 *
 * Provides dynamic skill escalation/de-escalation based on user intent.
 */

export {
  SessionStateManager,
  createSessionStateManager,
} from './session-state.js';

export { SkillManager, createSkillManager } from './skill-manager.js';

export {
  IntentClassifier,
  createIntentClassifier,
} from './intent-classifier.js';
