//! Agent Repository - Abstract persistence for Agents
//!
//! Agents are registered in the system and can be looked up
//! by ID, role, or skills.

use crate::model::agent::{Agent, AgentId};
use crate::model::role::Role;
use crate::repository::mission_repository::RepositoryError;

/// Agent Repository Trait
///
/// This is a PORT in hexagonal architecture.
/// Used by the Router to find available agents for dispatching.
pub trait AgentRepository {
    /// Register an agent in the system
    fn register(&mut self, agent: Agent) -> Result<(), RepositoryError>;

    /// Find an agent by ID
    fn find_by_id(&self, id: &AgentId) -> Result<Option<Agent>, RepositoryError>;

    /// Find all agents with a specific role
    fn find_by_role(&self, role: Role) -> Result<Vec<Agent>, RepositoryError>;

    /// Find agents that have a specific skill
    fn find_by_skill(&self, skill_id: &str) -> Result<Vec<Agent>, RepositoryError>;

    /// Find agents that have ALL of the specified skills
    fn find_by_skills_all(&self, skill_ids: &[&str]) -> Result<Vec<Agent>, RepositoryError>;

    /// Find agents that have ANY of the specified skills
    fn find_by_skills_any(&self, skill_ids: &[&str]) -> Result<Vec<Agent>, RepositoryError>;

    /// Unregister an agent
    fn unregister(&mut self, id: &AgentId) -> Result<(), RepositoryError>;

    /// List all registered agents
    fn list_all(&self) -> Result<Vec<Agent>, RepositoryError>;

    /// Count agents by role
    fn count_by_role(&self, role: Role) -> Result<usize, RepositoryError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::skill::{Skill, SkillId};
    use std::collections::HashMap;

    struct InMemoryAgentRepo {
        agents: HashMap<String, Agent>,
    }

    impl InMemoryAgentRepo {
        fn new() -> Self {
            Self {
                agents: HashMap::new(),
            }
        }
    }

    impl AgentRepository for InMemoryAgentRepo {
        fn register(&mut self, agent: Agent) -> Result<(), RepositoryError> {
            self.agents
                .insert(agent.id().as_str().to_string(), agent);
            Ok(())
        }

        fn find_by_id(&self, id: &AgentId) -> Result<Option<Agent>, RepositoryError> {
            Ok(self.agents.get(id.as_str()).cloned())
        }

        fn find_by_role(&self, role: Role) -> Result<Vec<Agent>, RepositoryError> {
            Ok(self
                .agents
                .values()
                .filter(|a| a.role() == role)
                .cloned()
                .collect())
        }

        fn find_by_skill(&self, skill_id: &str) -> Result<Vec<Agent>, RepositoryError> {
            Ok(self
                .agents
                .values()
                .filter(|a| a.has_skill(skill_id))
                .cloned()
                .collect())
        }

        fn find_by_skills_all(&self, skill_ids: &[&str]) -> Result<Vec<Agent>, RepositoryError> {
            Ok(self
                .agents
                .values()
                .filter(|a| skill_ids.iter().all(|s| a.has_skill(s)))
                .cloned()
                .collect())
        }

        fn find_by_skills_any(&self, skill_ids: &[&str]) -> Result<Vec<Agent>, RepositoryError> {
            Ok(self
                .agents
                .values()
                .filter(|a| skill_ids.iter().any(|s| a.has_skill(s)))
                .cloned()
                .collect())
        }

        fn unregister(&mut self, id: &AgentId) -> Result<(), RepositoryError> {
            self.agents.remove(id.as_str());
            Ok(())
        }

        fn list_all(&self) -> Result<Vec<Agent>, RepositoryError> {
            Ok(self.agents.values().cloned().collect())
        }

        fn count_by_role(&self, role: Role) -> Result<usize, RepositoryError> {
            Ok(self.agents.values().filter(|a| a.role() == role).count())
        }
    }

    #[test]
    fn test_find_by_role() {
        let mut repo = InMemoryAgentRepo::new();

        repo.register(Agent::new(
            AgentId::new("arch-001"),
            "Architect 1",
            Role::Architect,
        ))
        .unwrap();

        repo.register(Agent::new(
            AgentId::new("worker-001"),
            "Worker 1",
            Role::Worker,
        ))
        .unwrap();

        repo.register(Agent::new(
            AgentId::new("worker-002"),
            "Worker 2",
            Role::Worker,
        ))
        .unwrap();

        let architects = repo.find_by_role(Role::Architect).unwrap();
        assert_eq!(architects.len(), 1);

        let workers = repo.find_by_role(Role::Worker).unwrap();
        assert_eq!(workers.len(), 2);
    }

    #[test]
    fn test_find_by_skills() {
        let mut repo = InMemoryAgentRepo::new();

        repo.register(
            Agent::new(AgentId::new("w-001"), "Frontend Dev", Role::Worker)
                .with_skill(Skill::new(SkillId::new("react"), "React"))
                .with_skill(Skill::new(SkillId::new("typescript"), "TypeScript")),
        )
        .unwrap();

        repo.register(
            Agent::new(AgentId::new("w-002"), "Backend Dev", Role::Worker)
                .with_skill(Skill::new(SkillId::new("rust"), "Rust"))
                .with_skill(Skill::new(SkillId::new("typescript"), "TypeScript")),
        )
        .unwrap();

        // Find by single skill
        let ts_devs = repo.find_by_skill("typescript").unwrap();
        assert_eq!(ts_devs.len(), 2);

        // Find by ALL skills
        let react_ts = repo.find_by_skills_all(&["react", "typescript"]).unwrap();
        assert_eq!(react_ts.len(), 1);

        // Find by ANY skills
        let react_or_rust = repo.find_by_skills_any(&["react", "rust"]).unwrap();
        assert_eq!(react_or_rust.len(), 2);
    }
}
