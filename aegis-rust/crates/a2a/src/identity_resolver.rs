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

    // ============== Edge Case Tests ==============

    mod edge_cases {
        use super::*;

        #[test]
        fn test_empty_rule_matches_any_agent() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "catch_all".to_string(),
                    required_skills: Vec::new(),
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 1,
                }],
                trusted_prefixes: Vec::new(),
            });

            let agent = A2AAgentCard {
                name: "any-agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "catch_all");
        }

        #[test]
        fn test_agent_with_many_skills() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "polyglot".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["skill_1".to_string()],
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 50,
                }],
                trusted_prefixes: Vec::new(),
            });

            let skills: Vec<A2AAgentSkill> = (0..100)
                .map(|i| create_skill(&format!("skill_{}", i)))
                .collect();

            let agent = A2AAgentCard {
                name: "multi-skill-agent".to_string(),
                version: "1.0.0".to_string(),
                skills,
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "polyglot");
        }

        #[test]
        fn test_unicode_skill_ids() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "japanese".to_string(),
                    required_skills: vec!["日本語".to_string()],
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
                name: "日本語エージェント".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill("日本語")],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "japanese");
        }

        #[test]
        fn test_empty_agent_name() {
            let resolver = create_resolver();

            let agent = A2AAgentCard {
                name: "".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "guest");
            assert_eq!(result.agent_name, "");
        }

        #[test]
        fn test_very_long_agent_name() {
            let resolver = create_resolver();

            let agent = A2AAgentCard {
                name: "a".repeat(10000),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "guest");
        }

        #[test]
        fn test_duplicate_skills_in_agent() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "developer".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["coding".to_string()],
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 50,
                }],
                trusted_prefixes: Vec::new(),
            });

            let agent = A2AAgentCard {
                name: "dup-skill-agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![
                    create_skill("coding"),
                    create_skill("coding"),
                    create_skill("coding"),
                ],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "developer");
        }

        #[test]
        fn test_special_chars_in_skill_id() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "special".to_string(),
                    required_skills: vec!["skill-with-dash".to_string(), "skill_with_underscore".to_string()],
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
                name: "special-agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![
                    create_skill("skill-with-dash"),
                    create_skill("skill_with_underscore"),
                ],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "special");
        }

        #[test]
        fn test_min_skill_match_zero() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "any_match".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["react".to_string(), "vue".to_string()],
                    min_skill_match: 0, // Zero means no minimum
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 50,
                }],
                trusted_prefixes: Vec::new(),
            });

            let agent = A2AAgentCard {
                name: "no-framework-agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill("unrelated")],
            };

            // With min_skill_match = 0, having any_skills defined but 0 matches still passes
            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "any_match");
        }

        #[test]
        fn test_config_default_role_customization() {
            let config = IdentityResolverConfig {
                default_role: "custom_default".to_string(),
                ..Default::default()
            };
            let resolver = IdentityResolver::new(Arc::new(NullLogger), config);

            let agent = A2AAgentCard {
                name: "agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "custom_default");
        }

        #[test]
        fn test_multiple_add_rules_calls() {
            let mut resolver = create_resolver();

            // Add rules incrementally
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "first".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["skill1".to_string()],
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 10,
                }],
                trusted_prefixes: vec!["prefix1-".to_string()],
            });

            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "second".to_string(),
                    required_skills: Vec::new(),
                    any_skills: vec!["skill2".to_string()],
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 20,
                }],
                trusted_prefixes: vec!["prefix2-".to_string()],
            });

            let stats = resolver.get_stats();
            assert_eq!(stats.total_rules, 2);
            assert!(stats.trusted_prefixes.contains(&"prefix1-".to_string()));
            assert!(stats.trusted_prefixes.contains(&"prefix2-".to_string()));
        }

        #[test]
        fn test_resolution_contains_timestamp() {
            let resolver = create_resolver();

            let agent = A2AAgentCard {
                name: "test".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let before = chrono::Utc::now();
            let result = resolver.resolve(&agent);
            let after = chrono::Utc::now();

            assert!(result.resolved_at >= before);
            assert!(result.resolved_at <= after);
        }
    }

    // ============== Red Team Security Tests ==============

    mod red_team {
        use super::*;

        #[test]
        fn red_team_forbidden_skill_blocks_even_with_all_required() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin_access".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: vec!["banned".to_string()],
                    context: None,
                    description: None,
                    priority: 100,
                }],
                trusted_prefixes: Vec::new(),
            });

            // Has admin_access but also has banned skill
            let agent = A2AAgentCard {
                name: "banned-admin".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill("admin_access"), create_skill("banned")],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "guest");
        }

        #[test]
        fn red_team_case_sensitive_skill_matching() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["Admin_Access".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 100,
                }],
                trusted_prefixes: Vec::new(),
            });

            // Different case should NOT match
            let agent = A2AAgentCard {
                name: "case-test".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill("admin_access")], // lowercase
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "guest");
        }

        #[test]
        fn red_team_partial_skill_id_match() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 100,
                }],
                trusted_prefixes: Vec::new(),
            });

            // Partial match should NOT work (admin_access != admin)
            let agent = A2AAgentCard {
                name: "partial-match".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill("admin_access")],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "guest");
        }

        #[test]
        fn red_team_prefix_not_suffix_for_trusted() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: Vec::new(),
                trusted_prefixes: vec!["claude-".to_string()],
            });

            // Name ending with prefix should NOT be trusted
            let agent = A2AAgentCard {
                name: "attacker-claude-".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            // "attacker-claude-" does NOT start with "claude-"
            let result = resolver.resolve(&agent);
            assert!(!result.is_trusted);
        }

        #[test]
        fn red_team_null_in_skill_id() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 100,
                }],
                trusted_prefixes: Vec::new(),
            });

            // Null byte injection attempt
            let agent = A2AAgentCard {
                name: "null-test".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill("admin\0extra")],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "guest");
        }

        #[test]
        fn red_team_whitespace_in_skill_id() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 100,
                }],
                trusted_prefixes: Vec::new(),
            });

            // Whitespace padding should NOT match
            let agent = A2AAgentCard {
                name: "whitespace-test".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill(" admin ")],
            };

            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "guest");
        }

        #[test]
        fn red_team_fallback_order_attack() {
            let mut resolver = create_resolver();

            // Lower priority catch-all rule
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: Vec::new(),
                    any_skills: Vec::new(), // matches anyone
                    min_skill_match: 0,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 1, // Very low priority
                }],
                trusted_prefixes: Vec::new(),
            });

            // Higher priority restrictive rule
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "verified".to_string(),
                    required_skills: vec!["verified_token".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: Vec::new(),
                    context: None,
                    description: None,
                    priority: 100, // High priority
                }],
                trusted_prefixes: Vec::new(),
            });

            // Agent without verified_token should fall through to admin catch-all
            let agent = A2AAgentCard {
                name: "attacker".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let result = resolver.resolve(&agent);
            // Should match the catch-all admin rule (not verified)
            assert_eq!(result.role_id, "admin");
        }

        #[test]
        fn red_team_empty_forbidden_skills_list() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin_access".to_string()],
                    any_skills: Vec::new(),
                    min_skill_match: 1,
                    forbidden_skills: vec![], // Empty forbidden list
                    context: None,
                    description: None,
                    priority: 100,
                }],
                trusted_prefixes: Vec::new(),
            });

            let agent = A2AAgentCard {
                name: "admin-agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![create_skill("admin_access")],
            };

            // Empty forbidden list means nothing is blocked
            let result = resolver.resolve(&agent);
            assert_eq!(result.role_id, "admin");
        }
    }

    // ============== Config Tests ==============

    mod config {
        use super::*;

        #[test]
        fn test_default_config() {
            let config = IdentityResolverConfig::default();

            assert_eq!(config.version, "1.0.0");
            assert_eq!(config.default_role, "guest");
            assert!(config.skill_rules.is_empty());
            assert!(config.trusted_prefixes.is_empty());
            assert!(!config.strict_validation);
        }

        #[test]
        fn test_config_clone() {
            let config = IdentityResolverConfig {
                version: "2.0.0".to_string(),
                default_role: "custom".to_string(),
                skill_rules: vec![SkillMatchRule {
                    role: "test".to_string(),
                    required_skills: vec!["req".to_string()],
                    any_skills: vec!["any".to_string()],
                    min_skill_match: 2,
                    forbidden_skills: vec!["forbidden".to_string()],
                    context: None,
                    description: Some("desc".to_string()),
                    priority: 99,
                }],
                trusted_prefixes: vec!["trusted-".to_string()],
                strict_validation: true,
            };

            let cloned = config.clone();

            assert_eq!(cloned.version, config.version);
            assert_eq!(cloned.default_role, config.default_role);
            assert_eq!(cloned.skill_rules.len(), config.skill_rules.len());
            assert_eq!(cloned.trusted_prefixes, config.trusted_prefixes);
            assert_eq!(cloned.strict_validation, config.strict_validation);
        }

        #[test]
        fn test_config_debug() {
            let config = IdentityResolverConfig::default();
            let debug = format!("{:?}", config);
            assert!(debug.contains("IdentityResolverConfig"));
        }
    }

    // ============== Stats Tests ==============

    mod stats {
        use super::*;

        #[test]
        fn test_stats_empty_resolver() {
            let resolver = create_resolver();
            let stats = resolver.get_stats();

            assert_eq!(stats.total_rules, 0);
            assert!(stats.rules_by_role.is_empty());
            assert!(stats.trusted_prefixes.is_empty());
        }

        #[test]
        fn test_stats_after_adding_rules() {
            let mut resolver = create_resolver();
            resolver.add_rules_from_identity_config(&SkillIdentityConfig {
                skill_matching: vec![
                    SkillMatchRule {
                        role: "admin".to_string(),
                        required_skills: vec![],
                        any_skills: vec!["admin".to_string()],
                        min_skill_match: 1,
                        forbidden_skills: vec![],
                        context: None,
                        description: None,
                        priority: 100,
                    },
                    SkillMatchRule {
                        role: "admin".to_string(),
                        required_skills: vec![],
                        any_skills: vec!["superuser".to_string()],
                        min_skill_match: 1,
                        forbidden_skills: vec![],
                        context: None,
                        description: None,
                        priority: 90,
                    },
                    SkillMatchRule {
                        role: "developer".to_string(),
                        required_skills: vec![],
                        any_skills: vec!["coding".to_string()],
                        min_skill_match: 1,
                        forbidden_skills: vec![],
                        context: None,
                        description: None,
                        priority: 50,
                    },
                ],
                trusted_prefixes: vec!["trusted-".to_string()],
            });

            let stats = resolver.get_stats();
            assert_eq!(stats.total_rules, 3);
            assert_eq!(stats.rules_by_role.get("admin"), Some(&2));
            assert_eq!(stats.rules_by_role.get("developer"), Some(&1));
        }

        #[test]
        fn test_stats_clone() {
            let resolver = create_resolver();
            let stats = resolver.get_stats();
            let cloned = stats.clone();

            assert_eq!(cloned.total_rules, stats.total_rules);
        }

        #[test]
        fn test_stats_debug() {
            let resolver = create_resolver();
            let stats = resolver.get_stats();
            let debug = format!("{:?}", stats);

            assert!(debug.contains("IdentityResolverStats"));
        }
    }
}
