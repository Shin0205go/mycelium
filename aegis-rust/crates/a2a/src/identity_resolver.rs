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

    fn create_skill(id: &str) -> A2AAgentSkill {
        A2AAgentSkill {
            id: id.to_string(),
            name: None,
            description: None,
        }
    }

    fn create_resolver() -> IdentityResolver {
        IdentityResolver::new(Arc::new(NullLogger), IdentityResolverConfig::default())
    }

    #[test]
    fn test_resolve_to_default_when_no_rules_match() {
        let resolver = create_resolver();

        let agent = A2AAgentCard {
            name: "unknown-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("some_skill")],
        };

        let result = resolver.resolve(&agent);
        assert_eq!(result.role_id, "guest");
        assert!(result.matched_rule.is_none());
        assert!(result.matched_skills.is_empty());
    }

    #[test]
    fn test_resolve_to_default_when_no_skills() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "developer".to_string(),
                required_skills: vec!["coding".to_string()],
                any_skills: Vec::new(),
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 0,
            }],
            trusted_prefixes: Vec::new(),
        });

        let agent = A2AAgentCard {
            name: "empty-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };

        let result = resolver.resolve(&agent);
        assert_eq!(result.role_id, "guest");
    }

    #[test]
    fn test_required_skills_and_logic_match_all() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "frontend".to_string(),
                required_skills: vec![
                    "create_component".to_string(),
                    "style_design".to_string(),
                ],
                any_skills: Vec::new(),
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 50,
            }],
            trusted_prefixes: Vec::new(),
        });

        let agent = A2AAgentCard {
            name: "frontend-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![
                create_skill("create_component"),
                create_skill("style_design"),
                create_skill("extra_skill"),
            ],
        };

        let result = resolver.resolve(&agent);
        assert_eq!(result.role_id, "frontend");
        assert!(result.matched_skills.contains(&"create_component".to_string()));
        assert!(result.matched_skills.contains(&"style_design".to_string()));
    }

    #[test]
    fn test_required_skills_missing_one_fails() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "frontend".to_string(),
                required_skills: vec![
                    "create_component".to_string(),
                    "style_design".to_string(),
                ],
                any_skills: Vec::new(),
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 50,
            }],
            trusted_prefixes: Vec::new(),
        });

        let agent = A2AAgentCard {
            name: "partial-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("create_component")], // missing style_design
        };

        let result = resolver.resolve(&agent);
        assert_eq!(result.role_id, "guest");
    }

    #[test]
    fn test_any_skills_or_logic_match_one() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "frontend".to_string(),
                required_skills: Vec::new(),
                any_skills: vec![
                    "react".to_string(),
                    "vue".to_string(),
                    "angular".to_string(),
                ],
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 50,
            }],
            trusted_prefixes: Vec::new(),
        });

        let agent = A2AAgentCard {
            name: "react-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("react")],
        };

        let result = resolver.resolve(&agent);
        assert_eq!(result.role_id, "frontend");
        assert!(result.matched_skills.contains(&"react".to_string()));
    }

    #[test]
    fn test_any_skills_none_match_fails() {
        let mut resolver = create_resolver();
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
            trusted_prefixes: Vec::new(),
        });

        let agent = A2AAgentCard {
            name: "backend-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("database_query")],
        };

        let result = resolver.resolve(&agent);
        assert_eq!(result.role_id, "guest");
    }

    #[test]
    fn test_min_skill_match_threshold() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "senior".to_string(),
                required_skills: Vec::new(),
                any_skills: vec![
                    "react".to_string(),
                    "vue".to_string(),
                    "angular".to_string(),
                    "svelte".to_string(),
                ],
                min_skill_match: 2,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 50,
            }],
            trusted_prefixes: Vec::new(),
        });

        // Only 1 skill - should not match
        let junior = A2AAgentCard {
            name: "junior".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("react")],
        };
        assert_eq!(resolver.resolve(&junior).role_id, "guest");

        // 2 skills - should match
        let senior = A2AAgentCard {
            name: "senior".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("react"), create_skill("vue")],
        };
        assert_eq!(resolver.resolve(&senior).role_id, "senior");
    }

    #[test]
    fn test_priority_ordering() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![
                SkillMatchRule {
                    role: "developer".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["coding".to_string()],
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 10,
                },
                SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["coding".to_string(), "admin_access".to_string()],
                    min_skill_match: 2,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 100,
                },
            ],
            trusted_prefixes: Vec::new(),
        });

        // Agent with both skills should match higher priority admin
        let agent = A2AAgentCard {
            name: "admin-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("coding"), create_skill("admin_access")],
        };
        assert_eq!(resolver.resolve(&agent).role_id, "admin");
    }

    #[test]
    fn test_forbidden_skills_block_match() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "admin".to_string(),
                required_skills: vec!["admin_access".to_string()],
                any_skills: Vec::new(),
                min_skill_match: 1,
                forbidden_skills: vec!["trial_user".to_string(), "sandbox_mode".to_string()],
                context: None,
                description: None,
                priority: 100,
            }],
            trusted_prefixes: Vec::new(),
        });

        // Agent with forbidden skill should be blocked
        let trial_agent = A2AAgentCard {
            name: "trial-admin".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("admin_access"), create_skill("trial_user")],
        };
        assert_eq!(resolver.resolve(&trial_agent).role_id, "guest");

        // Agent without forbidden skill passes
        let real_admin = A2AAgentCard {
            name: "real-admin".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("admin_access"), create_skill("full_license")],
        };
        assert_eq!(resolver.resolve(&real_admin).role_id, "admin");
    }

    #[test]
    fn test_trusted_prefix_detection() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: Vec::new(),
            trusted_prefixes: vec!["claude-".to_string(), "aegis-".to_string()],
        });

        let claude = A2AAgentCard {
            name: "claude-code".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };
        assert!(resolver.resolve(&claude).is_trusted);

        let aegis = A2AAgentCard {
            name: "aegis-frontend".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };
        assert!(resolver.resolve(&aegis).is_trusted);

        let random = A2AAgentCard {
            name: "random-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };
        assert!(!resolver.resolve(&random).is_trusted);
    }

    #[test]
    fn test_combined_required_and_any_skills() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "fullstack".to_string(),
                required_skills: vec!["coding".to_string(), "testing".to_string()],
                any_skills: vec!["frontend_framework".to_string(), "backend_framework".to_string()],
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 50,
            }],
            trusted_prefixes: Vec::new(),
        });

        // All conditions met
        let fullstack = A2AAgentCard {
            name: "fullstack-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![
                create_skill("coding"),
                create_skill("testing"),
                create_skill("frontend_framework"),
            ],
        };
        assert_eq!(resolver.resolve(&fullstack).role_id, "fullstack");

        // Missing required skill
        let partial = A2AAgentCard {
            name: "partial-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![
                create_skill("coding"),
                // missing testing
                create_skill("frontend_framework"),
            ],
        };
        assert_eq!(resolver.resolve(&partial).role_id, "guest");
    }

    #[test]
    fn test_get_stats() {
        let mut resolver = create_resolver();
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![
                SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin_access".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 100,
                },
                SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["system_management".to_string()],
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 50,
                },
                SkillMatchRule {
                    role: "frontend".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["react".to_string()],
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 50,
                },
            ],
            trusted_prefixes: vec!["claude-".to_string()],
        });

        let stats = resolver.get_stats();
        assert_eq!(stats.total_rules, 3);
        assert_eq!(stats.rules_by_role.get("admin"), Some(&2));
        assert_eq!(stats.rules_by_role.get("frontend"), Some(&1));
        assert!(stats.trusted_prefixes.contains(&"claude-".to_string()));
    }

    #[test]
    fn test_real_world_skill_config() {
        let mut resolver = create_resolver();

        // Admin skill
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "admin".to_string(),
                required_skills: vec![
                    "admin_access".to_string(),
                    "system_management".to_string(),
                ],
                any_skills: Vec::new(),
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: Some("Full admin requires both skills".to_string()),
                priority: 100,
            }],
            trusted_prefixes: vec!["claude-".to_string(), "aegis-".to_string()],
        });

        // Frontend skill
        resolver.add_rules_from_identity_config(&SkillIdentityConfig {
            skill_matching: vec![SkillMatchRule {
                role: "frontend".to_string(),
                required_skills: Vec::new(),
                any_skills: vec![
                    "react".to_string(),
                    "vue".to_string(),
                    "angular".to_string(),
                    "svelte".to_string(),
                ],
                min_skill_match: 1,
                forbidden_skills: Vec::new(),
                context: None,
                description: None,
                priority: 50,
            }],
            trusted_prefixes: Vec::new(),
        });

        // Test admin agent
        let admin = A2AAgentCard {
            name: "claude-admin".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![
                create_skill("admin_access"),
                create_skill("system_management"),
            ],
        };
        let admin_result = resolver.resolve(&admin);
        assert_eq!(admin_result.role_id, "admin");
        assert!(admin_result.is_trusted);

        // Test partial admin -> guest
        let partial = A2AAgentCard {
            name: "partial-admin".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("admin_access")],
        };
        assert_eq!(resolver.resolve(&partial).role_id, "guest");

        // Test frontend agent
        let frontend = A2AAgentCard {
            name: "react-builder".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("react"), create_skill("typescript")],
        };
        let frontend_result = resolver.resolve(&frontend);
        assert_eq!(frontend_result.role_id, "frontend");
        assert!(frontend_result.matched_skills.contains(&"react".to_string()));

        // Test unknown agent -> guest
        let unknown = A2AAgentCard {
            name: "unknown-service".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![create_skill("unrelated_skill")],
        };
        let unknown_result = resolver.resolve(&unknown);
        assert_eq!(unknown_result.role_id, "guest");
        assert!(unknown_result.matched_rule.is_none());
        assert!(!unknown_result.is_trusted);
    }
}
