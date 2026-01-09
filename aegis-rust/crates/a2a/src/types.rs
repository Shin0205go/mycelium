//! A2A types

use serde::{Deserialize, Serialize};

// Re-export shared types for convenience
pub use shared::{SkillMatchRule, SkillIdentityConfig, RuleContext};

/// A2A Agent Card skill
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AAgentSkill {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
}

/// A2A Agent Card
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AAgentCard {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub skills: Vec<A2AAgentSkill>,
}

/// Identity resolution result
#[derive(Debug, Clone)]
pub struct IdentityResolution {
    pub role_id: String,
    pub agent_name: String,
    pub matched_rule: Option<SkillMatchRule>,
    pub matched_skills: Vec<String>,
    pub is_trusted: bool,
    pub resolved_at: chrono::DateTime<chrono::Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============== A2AAgentSkill Tests ==============

    #[test]
    fn test_agent_skill_creation() {
        let skill = A2AAgentSkill {
            id: "react".to_string(),
            name: Some("React Development".to_string()),
            description: Some("Building React applications".to_string()),
        };

        assert_eq!(skill.id, "react");
        assert_eq!(skill.name, Some("React Development".to_string()));
        assert!(skill.description.is_some());
    }

    #[test]
    fn test_agent_skill_minimal() {
        let skill = A2AAgentSkill {
            id: "coding".to_string(),
            name: None,
            description: None,
        };

        assert_eq!(skill.id, "coding");
        assert!(skill.name.is_none());
        assert!(skill.description.is_none());
    }

    #[test]
    fn test_agent_skill_serialization() {
        let skill = A2AAgentSkill {
            id: "test".to_string(),
            name: Some("Test Skill".to_string()),
            description: None,
        };

        let json = serde_json::to_string(&skill).unwrap();
        assert!(json.contains("\"id\":\"test\""));
        assert!(json.contains("\"name\":\"Test Skill\""));
    }

    #[test]
    fn test_agent_skill_deserialization() {
        let json = r#"{"id": "react", "name": "React", "description": "React dev"}"#;
        let skill: A2AAgentSkill = serde_json::from_str(json).unwrap();

        assert_eq!(skill.id, "react");
        assert_eq!(skill.name, Some("React".to_string()));
    }

    #[test]
    fn test_agent_skill_deserialization_minimal() {
        let json = r#"{"id": "coding"}"#;
        let skill: A2AAgentSkill = serde_json::from_str(json).unwrap();

        assert_eq!(skill.id, "coding");
        assert!(skill.name.is_none());
    }

    // ============== A2AAgentCard Tests ==============

    #[test]
    fn test_agent_card_creation() {
        let card = A2AAgentCard {
            name: "react-builder".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![
                A2AAgentSkill {
                    id: "react".to_string(),
                    name: None,
                    description: None,
                },
                A2AAgentSkill {
                    id: "typescript".to_string(),
                    name: None,
                    description: None,
                },
            ],
        };

        assert_eq!(card.name, "react-builder");
        assert_eq!(card.version, "1.0.0");
        assert_eq!(card.skills.len(), 2);
    }

    #[test]
    fn test_agent_card_no_skills() {
        let card = A2AAgentCard {
            name: "basic-agent".to_string(),
            version: "0.1.0".to_string(),
            skills: vec![],
        };

        assert!(card.skills.is_empty());
    }

    #[test]
    fn test_agent_card_serialization() {
        let card = A2AAgentCard {
            name: "test-agent".to_string(),
            version: "2.0.0".to_string(),
            skills: vec![A2AAgentSkill {
                id: "skill1".to_string(),
                name: None,
                description: None,
            }],
        };

        let json = serde_json::to_string(&card).unwrap();
        assert!(json.contains("\"name\":\"test-agent\""));
        assert!(json.contains("\"version\":\"2.0.0\""));
        assert!(json.contains("skill1"));
    }

    #[test]
    fn test_agent_card_deserialization() {
        let json = r#"{
            "name": "claude-code",
            "version": "1.0.0",
            "skills": [
                {"id": "coding"},
                {"id": "testing"}
            ]
        }"#;

        let card: A2AAgentCard = serde_json::from_str(json).unwrap();
        assert_eq!(card.name, "claude-code");
        assert_eq!(card.skills.len(), 2);
    }

    #[test]
    fn test_agent_card_deserialization_default_skills() {
        let json = r#"{"name": "minimal", "version": "1.0.0"}"#;
        let card: A2AAgentCard = serde_json::from_str(json).unwrap();

        assert!(card.skills.is_empty());
    }

    // ============== IdentityResolution Tests ==============

    #[test]
    fn test_identity_resolution_creation() {
        let resolution = IdentityResolution {
            role_id: "admin".to_string(),
            agent_name: "claude-admin".to_string(),
            matched_rule: None,
            matched_skills: vec!["admin_access".to_string()],
            is_trusted: true,
            resolved_at: chrono::Utc::now(),
        };

        assert_eq!(resolution.role_id, "admin");
        assert_eq!(resolution.agent_name, "claude-admin");
        assert!(resolution.is_trusted);
        assert!(resolution.matched_skills.contains(&"admin_access".to_string()));
    }

    #[test]
    fn test_identity_resolution_with_matched_rule() {
        let rule = SkillMatchRule {
            role: "frontend".to_string(),
            required_skills: vec![],
            any_skills: vec!["react".to_string()],
            min_skill_match: 1,
            forbidden_skills: vec![],
            context: None,
            description: Some("Frontend rule".to_string()),
            priority: 50,
        };

        let resolution = IdentityResolution {
            role_id: "frontend".to_string(),
            agent_name: "react-agent".to_string(),
            matched_rule: Some(rule),
            matched_skills: vec!["react".to_string()],
            is_trusted: false,
            resolved_at: chrono::Utc::now(),
        };

        assert!(resolution.matched_rule.is_some());
        assert_eq!(resolution.matched_rule.as_ref().unwrap().role, "frontend");
    }

    #[test]
    fn test_identity_resolution_no_matched_rule() {
        let resolution = IdentityResolution {
            role_id: "guest".to_string(),
            agent_name: "unknown-agent".to_string(),
            matched_rule: None,
            matched_skills: vec![],
            is_trusted: false,
            resolved_at: chrono::Utc::now(),
        };

        assert!(resolution.matched_rule.is_none());
        assert!(resolution.matched_skills.is_empty());
    }

    #[test]
    fn test_identity_resolution_clone() {
        let resolution = IdentityResolution {
            role_id: "test".to_string(),
            agent_name: "test-agent".to_string(),
            matched_rule: None,
            matched_skills: vec!["skill1".to_string()],
            is_trusted: true,
            resolved_at: chrono::Utc::now(),
        };

        let cloned = resolution.clone();
        assert_eq!(cloned.role_id, resolution.role_id);
        assert_eq!(cloned.agent_name, resolution.agent_name);
        assert_eq!(cloned.is_trusted, resolution.is_trusted);
    }

    // ============== Clone and Debug Tests ==============

    #[test]
    fn test_agent_skill_clone() {
        let skill = A2AAgentSkill {
            id: "original".to_string(),
            name: Some("Original".to_string()),
            description: None,
        };

        let cloned = skill.clone();
        assert_eq!(cloned.id, skill.id);
        assert_eq!(cloned.name, skill.name);
    }

    #[test]
    fn test_agent_card_clone() {
        let card = A2AAgentCard {
            name: "original".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![A2AAgentSkill {
                id: "skill".to_string(),
                name: None,
                description: None,
            }],
        };

        let cloned = card.clone();
        assert_eq!(cloned.name, card.name);
        assert_eq!(cloned.skills.len(), card.skills.len());
    }

    #[test]
    fn test_agent_skill_debug() {
        let skill = A2AAgentSkill {
            id: "test".to_string(),
            name: None,
            description: None,
        };

        let debug = format!("{:?}", skill);
        assert!(debug.contains("A2AAgentSkill"));
        assert!(debug.contains("test"));
    }

    #[test]
    fn test_agent_card_debug() {
        let card = A2AAgentCard {
            name: "debug-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };

        let debug = format!("{:?}", card);
        assert!(debug.contains("A2AAgentCard"));
        assert!(debug.contains("debug-agent"));
    }

    #[test]
    fn test_identity_resolution_debug() {
        let resolution = IdentityResolution {
            role_id: "test".to_string(),
            agent_name: "agent".to_string(),
            matched_rule: None,
            matched_skills: vec![],
            is_trusted: false,
            resolved_at: chrono::Utc::now(),
        };

        let debug = format!("{:?}", resolution);
        assert!(debug.contains("IdentityResolution"));
    }

    // ============== Edge Cases ==============

    #[test]
    fn test_agent_card_many_skills() {
        let skills: Vec<A2AAgentSkill> = (0..100)
            .map(|i| A2AAgentSkill {
                id: format!("skill_{}", i),
                name: None,
                description: None,
            })
            .collect();

        let card = A2AAgentCard {
            name: "multi-skill".to_string(),
            version: "1.0.0".to_string(),
            skills,
        };

        assert_eq!(card.skills.len(), 100);
    }

    #[test]
    fn test_agent_card_unicode_name() {
        let card = A2AAgentCard {
            name: "日本語エージェント".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };

        assert_eq!(card.name, "日本語エージェント");
    }

    #[test]
    fn test_agent_skill_unicode() {
        let skill = A2AAgentSkill {
            id: "日本語".to_string(),
            name: Some("日本語スキル".to_string()),
            description: Some("これはテストです".to_string()),
        };

        assert_eq!(skill.id, "日本語");
    }

    // ============== Additional Type Tests ==============

    mod additional_type_tests {
        use super::*;

        #[test]
        fn test_agent_skill_empty_fields() {
            let skill = A2AAgentSkill {
                id: "".to_string(),
                name: Some("".to_string()),
                description: Some("".to_string()),
            };

            assert!(skill.id.is_empty());
            assert_eq!(skill.name, Some("".to_string()));
        }

        #[test]
        fn test_agent_skill_long_id() {
            let long_id = "x".repeat(10000);
            let skill = A2AAgentSkill {
                id: long_id.clone(),
                name: None,
                description: None,
            };

            assert_eq!(skill.id, long_id);
        }

        #[test]
        fn test_agent_skill_serialization_roundtrip() {
            let skill = A2AAgentSkill {
                id: "test".to_string(),
                name: Some("Test Skill".to_string()),
                description: Some("A test skill".to_string()),
            };

            let json = serde_json::to_string(&skill).unwrap();
            let parsed: A2AAgentSkill = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed.id, skill.id);
            assert_eq!(parsed.name, skill.name);
            assert_eq!(parsed.description, skill.description);
        }

        #[test]
        fn test_agent_card_empty_name() {
            let card = A2AAgentCard {
                name: "".to_string(),
                version: "".to_string(),
                skills: vec![],
            };

            assert!(card.name.is_empty());
            assert!(card.version.is_empty());
        }

        #[test]
        fn test_agent_card_long_name() {
            let long_name = "agent".repeat(1000);
            let card = A2AAgentCard {
                name: long_name.clone(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            assert_eq!(card.name, long_name);
        }

        #[test]
        fn test_agent_card_serialization_roundtrip() {
            let card = A2AAgentCard {
                name: "test-agent".to_string(),
                version: "2.0.0".to_string(),
                skills: vec![
                    A2AAgentSkill {
                        id: "skill1".to_string(),
                        name: Some("Skill 1".to_string()),
                        description: None,
                    },
                    A2AAgentSkill {
                        id: "skill2".to_string(),
                        name: None,
                        description: Some("Description".to_string()),
                    },
                ],
            };

            let json = serde_json::to_string(&card).unwrap();
            let parsed: A2AAgentCard = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed.name, card.name);
            assert_eq!(parsed.version, card.version);
            assert_eq!(parsed.skills.len(), 2);
        }

        #[test]
        fn test_identity_resolution_multiple_skills() {
            let resolution = IdentityResolution {
                role_id: "developer".to_string(),
                agent_name: "dev-agent".to_string(),
                matched_rule: None,
                matched_skills: vec![
                    "react".to_string(),
                    "typescript".to_string(),
                    "testing".to_string(),
                ],
                is_trusted: true,
                resolved_at: chrono::Utc::now(),
            };

            assert_eq!(resolution.matched_skills.len(), 3);
        }

        #[test]
        fn test_identity_resolution_empty_matched_skills() {
            let resolution = IdentityResolution {
                role_id: "guest".to_string(),
                agent_name: "guest-agent".to_string(),
                matched_rule: None,
                matched_skills: vec![],
                is_trusted: false,
                resolved_at: chrono::Utc::now(),
            };

            assert!(resolution.matched_skills.is_empty());
        }

        #[test]
        fn test_identity_resolution_with_rule_priority() {
            let rule = SkillMatchRule {
                role: "admin".to_string(),
                required_skills: vec!["admin_access".to_string()],
                any_skills: vec![],
                min_skill_match: 1,
                forbidden_skills: vec!["trial".to_string()],
                context: None,
                description: Some("High priority admin rule".to_string()),
                priority: 100,
            };

            let resolution = IdentityResolution {
                role_id: "admin".to_string(),
                agent_name: "admin-agent".to_string(),
                matched_rule: Some(rule),
                matched_skills: vec!["admin_access".to_string()],
                is_trusted: true,
                resolved_at: chrono::Utc::now(),
            };

            assert_eq!(resolution.matched_rule.as_ref().unwrap().priority, 100);
        }

        #[test]
        fn test_agent_card_with_special_chars() {
            let card = A2AAgentCard {
                name: "agent/v2@domain.com".to_string(),
                version: "v1.0.0-beta+build.123".to_string(),
                skills: vec![],
            };

            assert!(card.name.contains('@'));
            assert!(card.version.contains('+'));
        }

        #[test]
        fn test_agent_skill_with_special_chars() {
            let skill = A2AAgentSkill {
                id: "skill-v2.0/beta".to_string(),
                name: Some("Skill <v2>".to_string()),
                description: Some("Desc with \"quotes\"".to_string()),
            };

            assert!(skill.id.contains('/'));
            assert!(skill.description.as_ref().unwrap().contains('"'));
        }

        #[test]
        fn test_identity_resolution_timestamps_different() {
            let now = chrono::Utc::now();
            let later = now + chrono::Duration::seconds(1);

            let res1 = IdentityResolution {
                role_id: "test".to_string(),
                agent_name: "agent1".to_string(),
                matched_rule: None,
                matched_skills: vec![],
                is_trusted: false,
                resolved_at: now,
            };

            let res2 = IdentityResolution {
                role_id: "test".to_string(),
                agent_name: "agent2".to_string(),
                matched_rule: None,
                matched_skills: vec![],
                is_trusted: false,
                resolved_at: later,
            };

            assert!(res2.resolved_at > res1.resolved_at);
        }

        #[test]
        fn test_agent_card_200_skills() {
            let skills: Vec<A2AAgentSkill> = (0..200)
                .map(|i| A2AAgentSkill {
                    id: format!("skill_{}", i),
                    name: Some(format!("Skill {}", i)),
                    description: None,
                })
                .collect();

            let card = A2AAgentCard {
                name: "super-agent".to_string(),
                version: "1.0.0".to_string(),
                skills,
            };

            assert_eq!(card.skills.len(), 200);
        }

        #[test]
        fn test_identity_resolution_clone_independence() {
            let original = IdentityResolution {
                role_id: "test".to_string(),
                agent_name: "agent".to_string(),
                matched_rule: None,
                matched_skills: vec!["skill".to_string()],
                is_trusted: true,
                resolved_at: chrono::Utc::now(),
            };

            let cloned = original.clone();

            // Modifications to one should not affect the other
            assert_eq!(original.role_id, cloned.role_id);
            assert_eq!(original.matched_skills, cloned.matched_skills);
        }

        #[test]
        fn test_agent_skill_special_unicode() {
            let skill = A2AAgentSkill {
                id: "emoji_🎉".to_string(),
                name: Some("スキル with 日本語".to_string()),
                description: Some("مهارة عربية".to_string()),
            };

            assert!(skill.id.contains('🎉'));
            assert!(skill.name.as_ref().unwrap().contains("日本語"));
        }

        #[test]
        fn test_agent_card_json_extra_fields() {
            // Test that extra fields are ignored during deserialization
            let json = r#"{
                "name": "agent",
                "version": "1.0.0",
                "skills": [],
                "extra_field": "ignored",
                "another_extra": 123
            }"#;

            let card: A2AAgentCard = serde_json::from_str(json).unwrap();
            assert_eq!(card.name, "agent");
            assert!(card.skills.is_empty());
        }
    }
}
