//! Skill types for AEGIS

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Memory access policy type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryPolicy {
    /// No memory access (default)
    #[default]
    None,
    /// Own role's memory only
    Isolated,
    /// Access to specific roles' memories (requires teamRoles)
    Team,
    /// Access to all roles' memories (admin level)
    All,
}

impl MemoryPolicy {
    /// Compare privilege levels (higher = more access)
    pub fn privilege_level(&self) -> u8 {
        match self {
            MemoryPolicy::None => 0,
            MemoryPolicy::Isolated => 1,
            MemoryPolicy::Team => 2,
            MemoryPolicy::All => 3,
        }
    }

    /// Check if this policy has higher privilege than another
    pub fn is_higher_than(&self, other: &MemoryPolicy) -> bool {
        self.privilege_level() > other.privilege_level()
    }
}

/// Capability grants from skills
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGrants {
    /// Memory access policy for roles using this skill
    #[serde(default)]
    pub memory: MemoryPolicy,

    /// For 'team' policy: which roles' memories can be accessed
    #[serde(default)]
    pub memory_team_roles: Vec<String>,
}

/// Skill metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMetadata {
    /// Skill version
    pub version: Option<String>,

    /// Skill category for grouping
    pub category: Option<String>,

    /// Skill author
    pub author: Option<String>,

    /// Tags for discovery
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A2A skill-based identity configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillIdentityConfig {
    /// Skill matching rules for role assignment
    #[serde(default)]
    pub skill_matching: Vec<SkillMatchRule>,

    /// Trusted agent name prefixes
    #[serde(default)]
    pub trusted_prefixes: Vec<String>,
}

/// Rule for matching agent skills to roles
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMatchRule {
    /// Role to assign when rule matches
    pub role: String,

    /// All these skills must be present (AND logic)
    #[serde(default)]
    pub required_skills: Vec<String>,

    /// At least minSkillMatch of these must be present (OR logic)
    #[serde(default)]
    pub any_skills: Vec<String>,

    /// Minimum number of any_skills required (default: 1)
    #[serde(default = "default_min_skill_match")]
    pub min_skill_match: usize,

    /// Skills that block this rule if present
    #[serde(default)]
    pub forbidden_skills: Vec<String>,

    /// Time-based access control
    pub context: Option<RuleContext>,

    /// Optional description
    pub description: Option<String>,

    /// Priority (higher = checked first)
    #[serde(default)]
    pub priority: i32,
}

fn default_min_skill_match() -> usize {
    1
}

/// Time-based access control conditions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleContext {
    /// Time range (e.g., "09:00-18:00")
    pub allowed_time: Option<String>,

    /// Days of week (0=Sunday, 6=Saturday)
    #[serde(default)]
    pub allowed_days: Vec<u8>,

    /// IANA timezone (e.g., "Asia/Tokyo")
    pub timezone: Option<String>,
}

/// Base skill definition from Skill MCP Server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinition {
    /// Unique skill identifier
    pub id: String,

    /// Human-readable display name
    pub display_name: String,

    /// Skill description
    pub description: String,

    /// Roles that can use this skill (["*"] = all roles)
    #[serde(default)]
    pub allowed_roles: Vec<String>,

    /// Tools this skill uses (MCP tool format)
    #[serde(default)]
    pub allowed_tools: Vec<String>,

    /// Capability grants (memory, etc.)
    pub grants: Option<SkillGrants>,

    /// A2A identity configuration
    pub identity: Option<SkillIdentityConfig>,

    /// Skill metadata
    pub metadata: Option<SkillMetadata>,
}

impl SkillDefinition {
    /// Check if this skill is available for all roles
    pub fn is_universal(&self) -> bool {
        self.allowed_roles.iter().any(|r| r == "*")
    }

    /// Check if this skill is available for a specific role
    pub fn allows_role(&self, role_id: &str) -> bool {
        self.is_universal() || self.allowed_roles.iter().any(|r| r == role_id)
    }

    /// Get the memory policy for this skill
    pub fn memory_policy(&self) -> MemoryPolicy {
        self.grants
            .as_ref()
            .map(|g| g.memory)
            .unwrap_or_default()
    }
}

/// Result of list_skills from Skill MCP Server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillManifest {
    /// All available skills
    pub skills: Vec<SkillDefinition>,

    /// Manifest version
    pub version: String,

    /// When the manifest was generated
    pub generated_at: String,
}

/// Dynamically generated role from skill definitions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicRole {
    /// Role ID (extracted from skill.allowedRoles)
    pub id: String,

    /// Skills available for this role
    pub skills: Vec<String>,

    /// Aggregated tools from all skills
    pub tools: Vec<String>,
}

/// Role manifest generated from skill definitions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleManifest {
    /// Dynamic roles derived from skills
    pub roles: HashMap<String, DynamicRole>,

    /// Source skill manifest version
    pub source_version: String,

    /// When this manifest was generated
    pub generated_at: String,
}

impl RoleManifest {
    /// Generate role manifest from skill definitions
    pub fn from_skills(skills: &[SkillDefinition], version: &str) -> Self {
        let mut roles: HashMap<String, DynamicRole> = HashMap::new();

        for skill in skills {
            for role_id in &skill.allowed_roles {
                if role_id == "*" {
                    continue; // Skip wildcard, handled separately
                }

                let role = roles.entry(role_id.clone()).or_insert_with(|| DynamicRole {
                    id: role_id.clone(),
                    skills: Vec::new(),
                    tools: Vec::new(),
                });

                role.skills.push(skill.id.clone());
                role.tools.extend(skill.allowed_tools.clone());
            }
        }

        // Deduplicate tools
        for role in roles.values_mut() {
            role.tools.sort();
            role.tools.dedup();
        }

        Self {
            roles,
            source_version: version.to_string(),
            generated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============== Memory Policy Tests ==============

    #[test]
    fn test_memory_policy_ordering() {
        assert!(MemoryPolicy::All.is_higher_than(&MemoryPolicy::Team));
        assert!(MemoryPolicy::Team.is_higher_than(&MemoryPolicy::Isolated));
        assert!(MemoryPolicy::Isolated.is_higher_than(&MemoryPolicy::None));
    }

    #[test]
    fn test_memory_policy_privilege_levels() {
        assert_eq!(MemoryPolicy::None.privilege_level(), 0);
        assert_eq!(MemoryPolicy::Isolated.privilege_level(), 1);
        assert_eq!(MemoryPolicy::Team.privilege_level(), 2);
        assert_eq!(MemoryPolicy::All.privilege_level(), 3);
    }

    #[test]
    fn test_memory_policy_default() {
        let policy = MemoryPolicy::default();
        assert_eq!(policy, MemoryPolicy::None);
    }

    #[test]
    fn test_memory_policy_clone() {
        let policy = MemoryPolicy::All;
        let cloned = policy;
        assert_eq!(policy, cloned);
    }

    #[test]
    fn test_memory_policy_equal_not_higher() {
        assert!(!MemoryPolicy::All.is_higher_than(&MemoryPolicy::All));
        assert!(!MemoryPolicy::None.is_higher_than(&MemoryPolicy::None));
    }

    #[test]
    fn test_memory_policy_serialization() {
        let policy = MemoryPolicy::Isolated;
        let json = serde_json::to_string(&policy).unwrap();
        assert_eq!(json, "\"isolated\"");

        let parsed: MemoryPolicy = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, MemoryPolicy::Isolated);
    }

    #[test]
    fn test_memory_policy_all_variants_serialize() {
        let variants = vec![
            (MemoryPolicy::None, "\"none\""),
            (MemoryPolicy::Isolated, "\"isolated\""),
            (MemoryPolicy::Team, "\"team\""),
            (MemoryPolicy::All, "\"all\""),
        ];

        for (policy, expected) in variants {
            let json = serde_json::to_string(&policy).unwrap();
            assert_eq!(json, expected);
        }
    }

    // ============== Skill Definition Tests ==============

    #[test]
    fn test_skill_role_check() {
        let skill = SkillDefinition {
            id: "test".to_string(),
            display_name: "Test Skill".to_string(),
            description: "A test skill".to_string(),
            allowed_roles: vec!["admin".to_string(), "developer".to_string()],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };

        assert!(skill.allows_role("admin"));
        assert!(skill.allows_role("developer"));
        assert!(!skill.allows_role("guest"));
    }

    #[test]
    fn test_universal_skill() {
        let skill = SkillDefinition {
            id: "universal".to_string(),
            display_name: "Universal".to_string(),
            description: "Available to all".to_string(),
            allowed_roles: vec!["*".to_string()],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };

        assert!(skill.is_universal());
        assert!(skill.allows_role("any-role"));
    }

    #[test]
    fn test_skill_with_identity() {
        let skill = SkillDefinition {
            id: "admin-skill".to_string(),
            display_name: "Admin Skill".to_string(),
            description: "Admin tools".to_string(),
            allowed_roles: vec!["admin".to_string()],
            allowed_tools: vec!["*".to_string()],
            grants: None,
            identity: Some(SkillIdentityConfig {
                skill_matching: vec![SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin_access".to_string()],
                    any_skills: vec![],
                    min_skill_match: 1,
                    forbidden_skills: vec![],
                    context: None,
                    description: None,
                    priority: 100,
                }],
                trusted_prefixes: vec!["claude-".to_string()],
            }),
            metadata: None,
        };

        assert!(skill.identity.is_some());
        let identity = skill.identity.unwrap();
        assert_eq!(identity.skill_matching.len(), 1);
        assert_eq!(identity.trusted_prefixes, vec!["claude-"]);
    }

    #[test]
    fn test_skill_memory_policy() {
        let skill = SkillDefinition {
            id: "memory-skill".to_string(),
            display_name: "Memory Skill".to_string(),
            description: "Has memory".to_string(),
            allowed_roles: vec!["developer".to_string()],
            allowed_tools: vec![],
            grants: Some(SkillGrants {
                memory: MemoryPolicy::Isolated,
                memory_team_roles: vec![],
            }),
            identity: None,
            metadata: None,
        };

        assert_eq!(skill.memory_policy(), MemoryPolicy::Isolated);
    }

    #[test]
    fn test_skill_memory_policy_default() {
        let skill = SkillDefinition {
            id: "no-grants".to_string(),
            display_name: "No Grants".to_string(),
            description: "No grants".to_string(),
            allowed_roles: vec![],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };

        assert_eq!(skill.memory_policy(), MemoryPolicy::None);
    }

    #[test]
    fn test_skill_non_universal() {
        let skill = SkillDefinition {
            id: "restricted".to_string(),
            display_name: "Restricted".to_string(),
            description: "Not for everyone".to_string(),
            allowed_roles: vec!["admin".to_string()],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };

        assert!(!skill.is_universal());
    }

    #[test]
    fn test_skill_with_mixed_roles() {
        let skill = SkillDefinition {
            id: "mixed".to_string(),
            display_name: "Mixed".to_string(),
            description: "Mixed roles".to_string(),
            allowed_roles: vec!["admin".to_string(), "*".to_string()],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };

        // Should be universal because it contains "*"
        assert!(skill.is_universal());
        assert!(skill.allows_role("anyone"));
    }

    #[test]
    fn test_skill_serialization() {
        let skill = SkillDefinition {
            id: "test".to_string(),
            display_name: "Test".to_string(),
            description: "Test skill".to_string(),
            allowed_roles: vec!["admin".to_string()],
            allowed_tools: vec!["tool1".to_string()],
            grants: None,
            identity: None,
            metadata: None,
        };

        let json = serde_json::to_string(&skill).unwrap();
        let parsed: SkillDefinition = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, skill.id);
        assert_eq!(parsed.display_name, skill.display_name);
    }

    // ============== Skill Grants Tests ==============

    #[test]
    fn test_skill_grants_default() {
        let grants = SkillGrants::default();
        assert_eq!(grants.memory, MemoryPolicy::None);
        assert!(grants.memory_team_roles.is_empty());
    }

    #[test]
    fn test_skill_grants_with_team_roles() {
        let grants = SkillGrants {
            memory: MemoryPolicy::Team,
            memory_team_roles: vec!["frontend".to_string(), "backend".to_string()],
        };

        assert_eq!(grants.memory, MemoryPolicy::Team);
        assert_eq!(grants.memory_team_roles.len(), 2);
    }

    #[test]
    fn test_skill_grants_serialization() {
        let grants = SkillGrants {
            memory: MemoryPolicy::Team,
            memory_team_roles: vec!["role1".to_string()],
        };

        let json = serde_json::to_string(&grants).unwrap();
        assert!(json.contains("\"memory\":\"team\""));
        assert!(json.contains("\"memoryTeamRoles\""));
    }

    // ============== Skill Metadata Tests ==============

    #[test]
    fn test_skill_metadata_default() {
        let meta = SkillMetadata::default();
        assert!(meta.version.is_none());
        assert!(meta.category.is_none());
        assert!(meta.author.is_none());
        assert!(meta.tags.is_empty());
    }

    #[test]
    fn test_skill_metadata_full() {
        let meta = SkillMetadata {
            version: Some("1.0.0".to_string()),
            category: Some("dev-tools".to_string()),
            author: Some("AEGIS Team".to_string()),
            tags: vec!["coding".to_string(), "review".to_string()],
        };

        assert_eq!(meta.version.unwrap(), "1.0.0");
        assert_eq!(meta.category.unwrap(), "dev-tools");
        assert_eq!(meta.tags.len(), 2);
    }

    // ============== Skill Match Rule Tests ==============

    #[test]
    fn test_skill_match_rule_default_min() {
        let rule = SkillMatchRule {
            role: "test".to_string(),
            required_skills: vec![],
            any_skills: vec![],
            min_skill_match: default_min_skill_match(),
            forbidden_skills: vec![],
            context: None,
            description: None,
            priority: 0,
        };

        assert_eq!(rule.min_skill_match, 1);
    }

    #[test]
    fn test_skill_match_rule_with_context() {
        let rule = SkillMatchRule {
            role: "office".to_string(),
            required_skills: vec![],
            any_skills: vec!["coding".to_string()],
            min_skill_match: 1,
            forbidden_skills: vec![],
            context: Some(RuleContext {
                allowed_time: Some("09:00-18:00".to_string()),
                allowed_days: vec![1, 2, 3, 4, 5],
                timezone: Some("Asia/Tokyo".to_string()),
            }),
            description: Some("Office hours only".to_string()),
            priority: 50,
        };

        assert!(rule.context.is_some());
        let ctx = rule.context.unwrap();
        assert_eq!(ctx.allowed_time.unwrap(), "09:00-18:00");
        assert_eq!(ctx.allowed_days, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_skill_match_rule_serialization() {
        let rule = SkillMatchRule {
            role: "admin".to_string(),
            required_skills: vec!["admin_access".to_string()],
            any_skills: vec![],
            min_skill_match: 1,
            forbidden_skills: vec!["banned".to_string()],
            context: None,
            description: Some("Admin rule".to_string()),
            priority: 100,
        };

        let json = serde_json::to_string(&rule).unwrap();
        let parsed: SkillMatchRule = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.role, rule.role);
        assert_eq!(parsed.required_skills, rule.required_skills);
        assert_eq!(parsed.forbidden_skills, rule.forbidden_skills);
        assert_eq!(parsed.priority, rule.priority);
    }

    // ============== Skill Identity Config Tests ==============

    #[test]
    fn test_skill_identity_config_default() {
        let config = SkillIdentityConfig::default();
        assert!(config.skill_matching.is_empty());
        assert!(config.trusted_prefixes.is_empty());
    }

    #[test]
    fn test_skill_identity_config_with_rules() {
        let config = SkillIdentityConfig {
            skill_matching: vec![
                SkillMatchRule {
                    role: "admin".to_string(),
                    required_skills: vec!["admin".to_string()],
                    any_skills: vec![],
                    min_skill_match: 1,
                    forbidden_skills: vec![],
                    context: None,
                    description: None,
                    priority: 100,
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
            trusted_prefixes: vec!["claude-".to_string(), "aegis-".to_string()],
        };

        assert_eq!(config.skill_matching.len(), 2);
        assert_eq!(config.trusted_prefixes.len(), 2);
    }

    // ============== Rule Context Tests ==============

    #[test]
    fn test_rule_context_serialization() {
        let ctx = RuleContext {
            allowed_time: Some("09:00-17:00".to_string()),
            allowed_days: vec![1, 2, 3, 4, 5],
            timezone: Some("America/New_York".to_string()),
        };

        let json = serde_json::to_string(&ctx).unwrap();
        let parsed: RuleContext = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.allowed_time, ctx.allowed_time);
        assert_eq!(parsed.allowed_days, ctx.allowed_days);
        assert_eq!(parsed.timezone, ctx.timezone);
    }

    #[test]
    fn test_rule_context_empty() {
        let ctx = RuleContext {
            allowed_time: None,
            allowed_days: vec![],
            timezone: None,
        };

        assert!(ctx.allowed_time.is_none());
        assert!(ctx.allowed_days.is_empty());
    }

    // ============== Skill Manifest Tests ==============

    #[test]
    fn test_skill_manifest_basic() {
        let manifest = SkillManifest {
            skills: vec![],
            version: "1.0.0".to_string(),
            generated_at: "2024-01-01".to_string(),
        };

        assert!(manifest.skills.is_empty());
        assert_eq!(manifest.version, "1.0.0");
    }

    #[test]
    fn test_skill_manifest_with_skills() {
        let skill = SkillDefinition {
            id: "test".to_string(),
            display_name: "Test".to_string(),
            description: "Test".to_string(),
            allowed_roles: vec!["admin".to_string()],
            allowed_tools: vec!["tool1".to_string()],
            grants: None,
            identity: None,
            metadata: None,
        };

        let manifest = SkillManifest {
            skills: vec![skill],
            version: "1.0.0".to_string(),
            generated_at: "2024-01-01".to_string(),
        };

        assert_eq!(manifest.skills.len(), 1);
        assert_eq!(manifest.skills[0].id, "test");
    }

    // ============== Dynamic Role Tests ==============

    #[test]
    fn test_dynamic_role_creation() {
        let role = DynamicRole {
            id: "developer".to_string(),
            skills: vec!["code-review".to_string(), "testing".to_string()],
            tools: vec!["filesystem__read".to_string(), "git__commit".to_string()],
        };

        assert_eq!(role.id, "developer");
        assert_eq!(role.skills.len(), 2);
        assert_eq!(role.tools.len(), 2);
    }

    // ============== Role Manifest Tests ==============

    #[test]
    fn test_role_manifest_from_empty_skills() {
        let manifest = RoleManifest::from_skills(&[], "1.0.0");

        assert!(manifest.roles.is_empty());
        assert_eq!(manifest.source_version, "1.0.0");
    }

    #[test]
    fn test_role_manifest_from_skills() {
        let skills = vec![
            SkillDefinition {
                id: "skill1".to_string(),
                display_name: "Skill 1".to_string(),
                description: "".to_string(),
                allowed_roles: vec!["admin".to_string(), "developer".to_string()],
                allowed_tools: vec!["tool1".to_string()],
                grants: None,
                identity: None,
                metadata: None,
            },
            SkillDefinition {
                id: "skill2".to_string(),
                display_name: "Skill 2".to_string(),
                description: "".to_string(),
                allowed_roles: vec!["developer".to_string()],
                allowed_tools: vec!["tool2".to_string()],
                grants: None,
                identity: None,
                metadata: None,
            },
        ];

        let manifest = RoleManifest::from_skills(&skills, "1.0.0");

        assert_eq!(manifest.roles.len(), 2);
        assert!(manifest.roles.contains_key("admin"));
        assert!(manifest.roles.contains_key("developer"));

        // Admin has only skill1
        assert_eq!(manifest.roles["admin"].skills.len(), 1);
        assert_eq!(manifest.roles["admin"].tools.len(), 1);

        // Developer has both skills
        assert_eq!(manifest.roles["developer"].skills.len(), 2);
        assert_eq!(manifest.roles["developer"].tools.len(), 2);
    }

    #[test]
    fn test_role_manifest_ignores_wildcard() {
        let skills = vec![SkillDefinition {
            id: "public".to_string(),
            display_name: "Public".to_string(),
            description: "".to_string(),
            allowed_roles: vec!["*".to_string()],
            allowed_tools: vec!["public_tool".to_string()],
            grants: None,
            identity: None,
            metadata: None,
        }];

        let manifest = RoleManifest::from_skills(&skills, "1.0.0");

        // Wildcard role should not create a role entry
        assert!(manifest.roles.is_empty());
    }

    #[test]
    fn test_role_manifest_deduplicates_tools() {
        let skills = vec![
            SkillDefinition {
                id: "skill1".to_string(),
                display_name: "S1".to_string(),
                description: "".to_string(),
                allowed_roles: vec!["dev".to_string()],
                allowed_tools: vec!["tool1".to_string(), "tool2".to_string()],
                grants: None,
                identity: None,
                metadata: None,
            },
            SkillDefinition {
                id: "skill2".to_string(),
                display_name: "S2".to_string(),
                description: "".to_string(),
                allowed_roles: vec!["dev".to_string()],
                allowed_tools: vec!["tool2".to_string(), "tool3".to_string()], // tool2 overlaps
                grants: None,
                identity: None,
                metadata: None,
            },
        ];

        let manifest = RoleManifest::from_skills(&skills, "1.0.0");

        // Should have 3 unique tools, not 4
        assert_eq!(manifest.roles["dev"].tools.len(), 3);
    }

    #[test]
    fn test_role_manifest_sorts_tools() {
        let skills = vec![SkillDefinition {
            id: "skill".to_string(),
            display_name: "S".to_string(),
            description: "".to_string(),
            allowed_roles: vec!["dev".to_string()],
            allowed_tools: vec!["z_tool".to_string(), "a_tool".to_string(), "m_tool".to_string()],
            grants: None,
            identity: None,
            metadata: None,
        }];

        let manifest = RoleManifest::from_skills(&skills, "1.0.0");
        let tools = &manifest.roles["dev"].tools;

        // Should be sorted
        assert_eq!(tools[0], "a_tool");
        assert_eq!(tools[1], "m_tool");
        assert_eq!(tools[2], "z_tool");
    }

    // ============== Additional Tests ==============

    mod additional_tests {
        use super::*;

        #[test]
        fn test_memory_policy_debug() {
            let policy = MemoryPolicy::Isolated;
            let debug = format!("{:?}", policy);
            assert!(debug.contains("Isolated"));
        }

        #[test]
        fn test_memory_policy_eq() {
            assert_eq!(MemoryPolicy::None, MemoryPolicy::None);
            assert_ne!(MemoryPolicy::None, MemoryPolicy::Isolated);
        }

        #[test]
        fn test_skill_grants_debug() {
            let grants = SkillGrants::default();
            let debug = format!("{:?}", grants);
            assert!(debug.contains("SkillGrants"));
        }

        #[test]
        fn test_skill_grants_clone() {
            let grants = SkillGrants {
                memory: MemoryPolicy::Team,
                memory_team_roles: vec!["role1".to_string(), "role2".to_string()],
            };

            let cloned = grants.clone();
            assert_eq!(cloned.memory, grants.memory);
            assert_eq!(cloned.memory_team_roles.len(), 2);
        }

        #[test]
        fn test_skill_metadata_debug() {
            let meta = SkillMetadata::default();
            let debug = format!("{:?}", meta);
            assert!(debug.contains("SkillMetadata"));
        }

        #[test]
        fn test_skill_metadata_clone() {
            let meta = SkillMetadata {
                version: Some("1.0.0".to_string()),
                category: Some("tools".to_string()),
                author: Some("Author".to_string()),
                tags: vec!["tag1".to_string()],
            };

            let cloned = meta.clone();
            assert_eq!(cloned.version, meta.version);
            assert_eq!(cloned.tags.len(), 1);
        }

        #[test]
        fn test_skill_definition_debug() {
            let skill = SkillDefinition {
                id: "test".to_string(),
                display_name: "Test".to_string(),
                description: "Desc".to_string(),
                allowed_roles: vec![],
                allowed_tools: vec![],
                grants: None,
                identity: None,
                metadata: None,
            };

            let debug = format!("{:?}", skill);
            assert!(debug.contains("SkillDefinition"));
        }

        #[test]
        fn test_skill_definition_clone() {
            let skill = SkillDefinition {
                id: "test".to_string(),
                display_name: "Test".to_string(),
                description: "Desc".to_string(),
                allowed_roles: vec!["admin".to_string()],
                allowed_tools: vec!["tool".to_string()],
                grants: Some(SkillGrants::default()),
                identity: None,
                metadata: None,
            };

            let cloned = skill.clone();
            assert_eq!(cloned.id, skill.id);
            assert_eq!(cloned.allowed_roles, skill.allowed_roles);
        }

        #[test]
        fn test_skill_manifest_debug() {
            let manifest = SkillManifest {
                skills: vec![],
                version: "1.0.0".to_string(),
                generated_at: "2024".to_string(),
            };

            let debug = format!("{:?}", manifest);
            assert!(debug.contains("SkillManifest"));
        }

        #[test]
        fn test_skill_manifest_clone() {
            let manifest = SkillManifest {
                skills: vec![],
                version: "1.0.0".to_string(),
                generated_at: "2024".to_string(),
            };

            let cloned = manifest.clone();
            assert_eq!(cloned.version, manifest.version);
        }

        #[test]
        fn test_dynamic_role_debug() {
            let role = DynamicRole {
                id: "test".to_string(),
                skills: vec![],
                tools: vec![],
            };

            let debug = format!("{:?}", role);
            assert!(debug.contains("DynamicRole"));
        }

        #[test]
        fn test_dynamic_role_clone() {
            let role = DynamicRole {
                id: "dev".to_string(),
                skills: vec!["skill1".to_string()],
                tools: vec!["tool1".to_string()],
            };

            let cloned = role.clone();
            assert_eq!(cloned.id, role.id);
        }

        #[test]
        fn test_role_manifest_debug() {
            let manifest = RoleManifest::from_skills(&[], "1.0.0");
            let debug = format!("{:?}", manifest);
            assert!(debug.contains("RoleManifest"));
        }

        #[test]
        fn test_role_manifest_clone() {
            let manifest = RoleManifest::from_skills(&[], "1.0.0");
            let cloned = manifest.clone();
            assert_eq!(cloned.source_version, manifest.source_version);
        }

        #[test]
        fn test_skill_identity_config_debug() {
            let config = SkillIdentityConfig::default();
            let debug = format!("{:?}", config);
            assert!(debug.contains("SkillIdentityConfig"));
        }

        #[test]
        fn test_skill_identity_config_clone() {
            let config = SkillIdentityConfig {
                skill_matching: vec![],
                trusted_prefixes: vec!["claude-".to_string()],
            };

            let cloned = config.clone();
            assert_eq!(cloned.trusted_prefixes.len(), 1);
        }

        #[test]
        fn test_skill_match_rule_debug() {
            let rule = SkillMatchRule {
                role: "admin".to_string(),
                required_skills: vec![],
                any_skills: vec![],
                min_skill_match: 1,
                forbidden_skills: vec![],
                context: None,
                description: None,
                priority: 0,
            };

            let debug = format!("{:?}", rule);
            assert!(debug.contains("SkillMatchRule"));
        }

        #[test]
        fn test_skill_match_rule_clone() {
            let rule = SkillMatchRule {
                role: "admin".to_string(),
                required_skills: vec!["skill1".to_string()],
                any_skills: vec!["skill2".to_string()],
                min_skill_match: 2,
                forbidden_skills: vec!["banned".to_string()],
                context: None,
                description: Some("Test rule".to_string()),
                priority: 100,
            };

            let cloned = rule.clone();
            assert_eq!(cloned.role, rule.role);
            assert_eq!(cloned.priority, 100);
        }

        #[test]
        fn test_rule_context_debug() {
            let ctx = RuleContext {
                allowed_time: Some("09:00-17:00".to_string()),
                allowed_days: vec![1, 2, 3],
                timezone: Some("UTC".to_string()),
            };

            let debug = format!("{:?}", ctx);
            assert!(debug.contains("RuleContext"));
        }

        #[test]
        fn test_rule_context_clone() {
            let ctx = RuleContext {
                allowed_time: Some("09:00-17:00".to_string()),
                allowed_days: vec![1, 2, 3, 4, 5],
                timezone: Some("America/New_York".to_string()),
            };

            let cloned = ctx.clone();
            assert_eq!(cloned.allowed_days.len(), 5);
        }

        #[test]
        fn test_skill_allows_role_case_sensitive() {
            let skill = SkillDefinition {
                id: "test".to_string(),
                display_name: "Test".to_string(),
                description: "".to_string(),
                allowed_roles: vec!["Admin".to_string()],
                allowed_tools: vec![],
                grants: None,
                identity: None,
                metadata: None,
            };

            assert!(skill.allows_role("Admin"));
            assert!(!skill.allows_role("admin"));
            assert!(!skill.allows_role("ADMIN"));
        }

        #[test]
        fn test_skill_memory_policy_with_grants_all() {
            let skill = SkillDefinition {
                id: "admin".to_string(),
                display_name: "Admin".to_string(),
                description: "".to_string(),
                allowed_roles: vec!["admin".to_string()],
                allowed_tools: vec![],
                grants: Some(SkillGrants {
                    memory: MemoryPolicy::All,
                    memory_team_roles: vec![],
                }),
                identity: None,
                metadata: None,
            };

            assert_eq!(skill.memory_policy(), MemoryPolicy::All);
        }

        #[test]
        fn test_skill_many_roles() {
            let roles: Vec<String> = (0..100).map(|i| format!("role_{}", i)).collect();

            let skill = SkillDefinition {
                id: "many".to_string(),
                display_name: "Many Roles".to_string(),
                description: "".to_string(),
                allowed_roles: roles.clone(),
                allowed_tools: vec![],
                grants: None,
                identity: None,
                metadata: None,
            };

            assert_eq!(skill.allowed_roles.len(), 100);
            assert!(skill.allows_role("role_50"));
        }

        #[test]
        fn test_skill_many_tools() {
            let tools: Vec<String> = (0..100).map(|i| format!("tool_{}", i)).collect();

            let skill = SkillDefinition {
                id: "many".to_string(),
                display_name: "Many Tools".to_string(),
                description: "".to_string(),
                allowed_roles: vec!["admin".to_string()],
                allowed_tools: tools.clone(),
                grants: None,
                identity: None,
                metadata: None,
            };

            assert_eq!(skill.allowed_tools.len(), 100);
        }

        #[test]
        fn test_role_manifest_many_skills() {
            let skills: Vec<SkillDefinition> = (0..50)
                .map(|i| SkillDefinition {
                    id: format!("skill_{}", i),
                    display_name: format!("Skill {}", i),
                    description: "".to_string(),
                    allowed_roles: vec!["admin".to_string()],
                    allowed_tools: vec![format!("tool_{}", i)],
                    grants: None,
                    identity: None,
                    metadata: None,
                })
                .collect();

            let manifest = RoleManifest::from_skills(&skills, "1.0.0");

            assert!(manifest.roles.contains_key("admin"));
            assert_eq!(manifest.roles["admin"].skills.len(), 50);
            assert_eq!(manifest.roles["admin"].tools.len(), 50);
        }

        #[test]
        fn test_memory_policy_serialization_all_variants() {
            let variants = [
                MemoryPolicy::None,
                MemoryPolicy::Isolated,
                MemoryPolicy::Team,
                MemoryPolicy::All,
            ];

            for policy in &variants {
                let json = serde_json::to_string(policy).unwrap();
                let restored: MemoryPolicy = serde_json::from_str(&json).unwrap();
                assert_eq!(&restored, policy);
            }
        }

        #[test]
        fn test_skill_definition_serialization() {
            let skill = SkillDefinition {
                id: "test".to_string(),
                display_name: "Test".to_string(),
                description: "Description".to_string(),
                allowed_roles: vec!["admin".to_string()],
                allowed_tools: vec!["tool".to_string()],
                grants: Some(SkillGrants {
                    memory: MemoryPolicy::Isolated,
                    memory_team_roles: vec![],
                }),
                identity: None,
                metadata: Some(SkillMetadata {
                    version: Some("1.0.0".to_string()),
                    category: None,
                    author: None,
                    tags: vec![],
                }),
            };

            let json = serde_json::to_string(&skill).unwrap();
            let restored: SkillDefinition = serde_json::from_str(&json).unwrap();

            assert_eq!(restored.id, skill.id);
            assert_eq!(restored.memory_policy(), MemoryPolicy::Isolated);
        }
    }
}
