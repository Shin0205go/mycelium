//! Agent - A stateless executor in the AEGIS system
//!
//! Agent is an Entity (has identity).
//! The same AgentId refers to the same "person" even if the
//! underlying model changes (Gemini → Claude).
//!
//! IMPORTANT: Agents are STATELESS. They don't remember past missions.
//! All context is passed via the Mission object.

use super::role::Role;
use super::skill::Skill;

/// Unique identifier for an Agent
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AgentId(String);

impl AgentId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl core::fmt::Display for AgentId {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Agent - A stateless executor
///
/// Think of an Agent as a "job title" + "ID badge".
/// The actual "person" (LLM) behind it can change,
/// but the role and identity remain.
#[derive(Debug, Clone)]
pub struct Agent {
    /// Unique identifier (Entity identity)
    id: AgentId,
    /// Display name
    name: String,
    /// What this agent does
    role: Role,
    /// Skills this agent has
    skills: Vec<Skill>,
    /// System instruction for this agent
    system_instruction: String,
}

impl Agent {
    /// Create a new Agent
    pub fn new(
        id: AgentId,
        name: impl Into<String>,
        role: Role,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            role,
            skills: Vec::new(),
            system_instruction: String::new(),
        }
    }

    /// Builder: add a skill
    pub fn with_skill(mut self, skill: Skill) -> Self {
        self.skills.push(skill);
        self
    }

    /// Builder: add skills
    pub fn with_skills(mut self, skills: impl IntoIterator<Item = Skill>) -> Self {
        self.skills.extend(skills);
        self
    }

    /// Builder: set system instruction
    pub fn with_system_instruction(mut self, instruction: impl Into<String>) -> Self {
        self.system_instruction = instruction.into();
        self
    }

    // ========== Getters ==========

    pub fn id(&self) -> &AgentId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn role(&self) -> Role {
        self.role
    }

    pub fn skills(&self) -> &[Skill] {
        &self.skills
    }

    pub fn system_instruction(&self) -> &str {
        &self.system_instruction
    }

    // ========== Capability Checks ==========

    /// Check if this agent has a specific skill
    pub fn has_skill(&self, skill_id: &str) -> bool {
        self.skills.iter().any(|s| s.id().as_str() == skill_id)
    }

    /// Check if this agent can handle a specific role
    pub fn can_handle(&self, role: Role) -> bool {
        self.role == role
    }
}

impl PartialEq for Agent {
    fn eq(&self, other: &Self) -> bool {
        // Entity equality: same ID = same entity
        self.id == other.id
    }
}

impl Eq for Agent {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::skill::SkillId;

    #[test]
    fn test_agent_creation() {
        let agent = Agent::new(
            AgentId::new("arch-001"),
            "Chief Architect",
            Role::Architect,
        );

        assert_eq!(agent.id().as_str(), "arch-001");
        assert_eq!(agent.name(), "Chief Architect");
        assert_eq!(agent.role(), Role::Architect);
    }

    #[test]
    fn test_agent_with_skills() {
        let agent = Agent::new(
            AgentId::new("worker-001"),
            "Frontend Developer",
            Role::Worker,
        )
        .with_skill(Skill::new(SkillId::new("react"), "React Development"))
        .with_skill(Skill::new(SkillId::new("typescript"), "TypeScript"));

        assert!(agent.has_skill("react"));
        assert!(agent.has_skill("typescript"));
        assert!(!agent.has_skill("rust"));
    }

    #[test]
    fn test_entity_equality() {
        let agent1 = Agent::new(AgentId::new("a-001"), "Agent A", Role::Worker);
        let agent2 = Agent::new(AgentId::new("a-001"), "Agent A Modified", Role::Architect);

        // Same ID = same entity (even if other fields differ)
        assert_eq!(agent1, agent2);
    }
}
