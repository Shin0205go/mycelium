//! In-Memory Repository Implementations
//!
//! Simple in-memory implementations of repository traits.
//! Useful for testing and development.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use aegis_domain::model::agent::{Agent, AgentId};
use aegis_domain::model::mission::{Mission, MissionId, MissionStatus};
use aegis_domain::model::role::Role;
use aegis_domain::repository::agent_repository::AgentRepository;
use aegis_domain::repository::mission_repository::{MissionRepository, RepositoryError};

/// In-memory Mission Repository
///
/// Thread-safe implementation using RwLock.
#[derive(Debug, Clone, Default)]
pub struct InMemoryMissionRepository {
    missions: Arc<RwLock<HashMap<String, Mission>>>,
}

impl InMemoryMissionRepository {
    pub fn new() -> Self {
        Self {
            missions: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl MissionRepository for InMemoryMissionRepository {
    fn save(&mut self, mission: &Mission) -> Result<(), RepositoryError> {
        let mut missions = self.missions.write().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire write lock".to_string(),
            }
        })?;
        missions.insert(mission.id().as_str().to_string(), mission.clone());
        Ok(())
    }

    fn find_by_id(&self, id: &MissionId) -> Result<Option<Mission>, RepositoryError> {
        let missions = self.missions.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(missions.get(id.as_str()).cloned())
    }

    fn find_by_status(&self, status: &MissionStatus) -> Result<Vec<Mission>, RepositoryError> {
        let missions = self.missions.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(missions
            .values()
            .filter(|m| m.status() == status)
            .cloned()
            .collect())
    }

    fn delete(&mut self, id: &MissionId) -> Result<(), RepositoryError> {
        let mut missions = self.missions.write().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire write lock".to_string(),
            }
        })?;
        missions.remove(id.as_str());
        Ok(())
    }

    fn count(&self) -> Result<usize, RepositoryError> {
        let missions = self.missions.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(missions.len())
    }

    fn count_by_status(&self, status: &MissionStatus) -> Result<usize, RepositoryError> {
        let missions = self.missions.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(missions.values().filter(|m| m.status() == status).count())
    }
}

/// In-memory Agent Repository
#[derive(Debug, Clone, Default)]
pub struct InMemoryAgentRepository {
    agents: Arc<RwLock<HashMap<String, Agent>>>,
}

impl InMemoryAgentRepository {
    pub fn new() -> Self {
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl AgentRepository for InMemoryAgentRepository {
    fn register(&mut self, agent: Agent) -> Result<(), RepositoryError> {
        let mut agents = self.agents.write().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire write lock".to_string(),
            }
        })?;
        agents.insert(agent.id().as_str().to_string(), agent);
        Ok(())
    }

    fn find_by_id(&self, id: &AgentId) -> Result<Option<Agent>, RepositoryError> {
        let agents = self.agents.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(agents.get(id.as_str()).cloned())
    }

    fn find_by_role(&self, role: Role) -> Result<Vec<Agent>, RepositoryError> {
        let agents = self.agents.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(agents.values().filter(|a| a.role() == role).cloned().collect())
    }

    fn find_by_skill(&self, skill_id: &str) -> Result<Vec<Agent>, RepositoryError> {
        let agents = self.agents.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(agents
            .values()
            .filter(|a| a.has_skill(skill_id))
            .cloned()
            .collect())
    }

    fn find_by_skills_all(&self, skill_ids: &[&str]) -> Result<Vec<Agent>, RepositoryError> {
        let agents = self.agents.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(agents
            .values()
            .filter(|a| skill_ids.iter().all(|s| a.has_skill(s)))
            .cloned()
            .collect())
    }

    fn find_by_skills_any(&self, skill_ids: &[&str]) -> Result<Vec<Agent>, RepositoryError> {
        let agents = self.agents.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(agents
            .values()
            .filter(|a| skill_ids.iter().any(|s| a.has_skill(s)))
            .cloned()
            .collect())
    }

    fn unregister(&mut self, id: &AgentId) -> Result<(), RepositoryError> {
        let mut agents = self.agents.write().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire write lock".to_string(),
            }
        })?;
        agents.remove(id.as_str());
        Ok(())
    }

    fn list_all(&self) -> Result<Vec<Agent>, RepositoryError> {
        let agents = self.agents.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(agents.values().cloned().collect())
    }

    fn count_by_role(&self, role: Role) -> Result<usize, RepositoryError> {
        let agents = self.agents.read().map_err(|_| {
            RepositoryError::PersistenceError {
                message: "Failed to acquire read lock".to_string(),
            }
        })?;
        Ok(agents.values().filter(|a| a.role() == role).count())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aegis_domain::model::skill::{Skill, SkillId};

    #[test]
    fn test_mission_repository() {
        let mut repo = InMemoryMissionRepository::new();

        let mission = Mission::new(MissionId::new("m-001"), "Test goal");
        repo.save(&mission).unwrap();

        let found = repo.find_by_id(&MissionId::new("m-001")).unwrap();
        assert!(found.is_some());

        assert_eq!(repo.count().unwrap(), 1);
    }

    #[test]
    fn test_agent_repository() {
        let mut repo = InMemoryAgentRepository::new();

        let agent = Agent::new(AgentId::new("a-001"), "Test Agent", Role::Worker)
            .with_skill(Skill::new(SkillId::new("rust"), "Rust"));

        repo.register(agent).unwrap();

        let found = repo.find_by_skill("rust").unwrap();
        assert_eq!(found.len(), 1);
    }
}
