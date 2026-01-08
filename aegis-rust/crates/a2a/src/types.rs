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
