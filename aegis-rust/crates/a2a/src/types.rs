//! A2A types

use serde::{Deserialize, Serialize};

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

/// Skill match rule for identity resolution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMatchRule {
    pub role: String,
    #[serde(default)]
    pub required_skills: Vec<String>,
    #[serde(default)]
    pub any_skills: Vec<String>,
    #[serde(default = "default_min_skill_match")]
    pub min_skill_match: usize,
    #[serde(default)]
    pub forbidden_skills: Vec<String>,
    pub context: Option<RuleContext>,
    pub description: Option<String>,
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
    pub allowed_time: Option<String>,
    #[serde(default)]
    pub allowed_days: Vec<u8>,
    pub timezone: Option<String>,
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

/// Skill identity configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillIdentityConfig {
    #[serde(default)]
    pub skill_matching: Vec<SkillMatchRule>,
    #[serde(default)]
    pub trusted_prefixes: Vec<String>,
}
