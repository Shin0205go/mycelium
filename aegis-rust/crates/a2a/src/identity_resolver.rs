//! IdentityResolver - A2A capability-based identity resolution

use crate::types::*;
use shared::Logger;
use std::sync::Arc;

/// Identity resolver configuration
#[derive(Debug, Clone)]
pub struct IdentityResolverConfig {
    pub version: String,
    pub default_role: String,
    pub skill_rules: Vec<SkillMatchRule>,
    pub trusted_prefixes: Vec<String>,
    pub strict_validation: bool,
}

impl Default for IdentityResolverConfig {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            default_role: "guest".to_string(),
            skill_rules: Vec::new(),
            trusted_prefixes: Vec::new(),
            strict_validation: false,
        }
    }
}

/// A2A Identity Resolver
pub struct IdentityResolver {
    config: IdentityResolverConfig,
    logger: Arc<dyn Logger>,
}

impl IdentityResolver {
    /// Create a new IdentityResolver
    pub fn new(logger: Arc<dyn Logger>, config: IdentityResolverConfig) -> Self {
        Self { config, logger }
    }

    /// Add skill rules from skill definitions
    pub fn add_rules_from_identity_config(&mut self, config: &SkillIdentityConfig) {
        self.config.skill_rules.extend(config.skill_matching.clone());
        self.config.trusted_prefixes.extend(config.trusted_prefixes.clone());

        // Sort by priority (higher first)
        self.config.skill_rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }

    /// Resolve identity from an A2A Agent Card
    pub fn resolve(&self, agent_card: &A2AAgentCard) -> IdentityResolution {
        let agent_skills: Vec<&str> = agent_card.skills.iter().map(|s| s.id.as_str()).collect();
        let is_trusted = self.is_trusted_agent(&agent_card.name);

        // Try to match rules
        for rule in &self.config.skill_rules {
            if let Some(matched) = self.try_match_rule(rule, &agent_skills) {
                self.logger.info(
                    &format!("Resolved agent '{}' to role '{}' via rule", agent_card.name, rule.role),
                    None,
                );

                return IdentityResolution {
                    role_id: rule.role.clone(),
                    agent_name: agent_card.name.clone(),
                    matched_rule: Some(rule.clone()),
                    matched_skills: matched,
                    is_trusted,
                    resolved_at: chrono::Utc::now(),
                };
            }
        }

        // No match - use default role
        self.logger.info(
            &format!("Agent '{}' resolved to default role '{}'", agent_card.name, self.config.default_role),
            None,
        );

        IdentityResolution {
            role_id: self.config.default_role.clone(),
            agent_name: agent_card.name.clone(),
            matched_rule: None,
            matched_skills: Vec::new(),
            is_trusted,
            resolved_at: chrono::Utc::now(),
        }
    }

    /// Try to match a single rule
    fn try_match_rule(&self, rule: &SkillMatchRule, agent_skills: &[&str]) -> Option<Vec<String>> {
        // Check forbidden skills first
        for forbidden in &rule.forbidden_skills {
            if agent_skills.contains(&forbidden.as_str()) {
                return None;
            }
        }

        // Check required skills (AND logic)
        for required in &rule.required_skills {
            if !agent_skills.contains(&required.as_str()) {
                return None;
            }
        }

        // Check any_skills (OR logic)
        if !rule.any_skills.is_empty() {
            let matched: Vec<String> = rule
                .any_skills
                .iter()
                .filter(|s| agent_skills.contains(&s.as_str()))
                .cloned()
                .collect();

            if matched.len() < rule.min_skill_match {
                return None;
            }

            return Some(matched);
        }

        // If we have required skills and passed, return them
        if !rule.required_skills.is_empty() {
            return Some(rule.required_skills.clone());
        }

        // Empty rule matches everything
        Some(Vec::new())
    }

    /// Check if an agent name is trusted
    fn is_trusted_agent(&self, name: &str) -> bool {
        self.config.trusted_prefixes.iter().any(|p| name.starts_with(p))
    }

    /// Get statistics about loaded rules
    pub fn get_stats(&self) -> IdentityResolverStats {
        let mut rules_by_role: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        for rule in &self.config.skill_rules {
            *rules_by_role.entry(rule.role.clone()).or_default() += 1;
        }

        IdentityResolverStats {
            total_rules: self.config.skill_rules.len(),
            rules_by_role,
            trusted_prefixes: self.config.trusted_prefixes.clone(),
        }
    }
}

/// Statistics about the identity resolver
#[derive(Debug, Clone)]
pub struct IdentityResolverStats {
    pub total_rules: usize,
    pub rules_by_role: std::collections::HashMap<String, usize>,
    pub trusted_prefixes: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared::NullLogger;

    #[test]
    fn test_identity_resolution() {
        let logger = Arc::new(NullLogger);
        let mut resolver = IdentityResolver::new(logger, IdentityResolverConfig::default());

        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "frontend".to_string(),
                required_skills: Vec::new(),
                any_skills: vec!["react".to_string(), "vue".to_string()],
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 50,
            }],
            trusted_prefixes: vec!["claude-".to_string()],
        });

        let agent = A2AAgentCard {
            name: "react-builder".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![A2AAgentSkill {
                id: "react".to_string(),
                name: None,
                description: None,
            }],
        };

        let result = resolver.resolve(&agent);
        assert_eq!(result.role_id, "frontend");
    }
}
