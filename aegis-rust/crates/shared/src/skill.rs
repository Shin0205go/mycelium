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

    #[test]
    fn test_memory_policy_ordering() {
        assert!(MemoryPolicy::All.is_higher_than(&MemoryPolicy::Team));
        assert!(MemoryPolicy::Team.is_higher_than(&MemoryPolicy::Isolated));
        assert!(MemoryPolicy::Isolated.is_higher_than(&MemoryPolicy::None));
    }

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
}
