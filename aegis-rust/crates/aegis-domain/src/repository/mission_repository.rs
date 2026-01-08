//! Mission Repository - Abstract persistence for Missions
//!
//! This trait defines what operations the domain needs.
//! How they're implemented (SQLite, file, memory) is not our concern here.

use crate::model::mission::{Mission, MissionId, MissionStatus};

/// Errors that can occur during repository operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryError {
    /// Mission not found
    NotFound { id: String },
    /// Failed to persist
    PersistenceError { message: String },
    /// Concurrent modification detected
    ConcurrencyError { id: String },
}

impl core::fmt::Display for RepositoryError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            RepositoryError::NotFound { id } => {
                write!(f, "Mission not found: {}", id)
            }
            RepositoryError::PersistenceError { message } => {
                write!(f, "Persistence error: {}", message)
            }
            RepositoryError::ConcurrencyError { id } => {
                write!(f, "Concurrent modification for mission: {}", id)
            }
        }
    }
}

/// Mission Repository Trait
///
/// This is a PORT in hexagonal architecture.
/// The domain defines what it needs; adapters provide implementations.
///
/// Note: No async here - that's an implementation detail.
/// If you need async, wrap this in an async adapter.
pub trait MissionRepository {
    /// Save a mission (create or update)
    fn save(&mut self, mission: &Mission) -> Result<(), RepositoryError>;

    /// Find a mission by ID
    fn find_by_id(&self, id: &MissionId) -> Result<Option<Mission>, RepositoryError>;

    /// Find all missions with a specific status
    fn find_by_status(&self, status: &MissionStatus) -> Result<Vec<Mission>, RepositoryError>;

    /// Find all pending missions (ready for dispatch)
    fn find_pending(&self) -> Result<Vec<Mission>, RepositoryError> {
        self.find_by_status(&MissionStatus::Pending)
    }

    /// Delete a mission
    fn delete(&mut self, id: &MissionId) -> Result<(), RepositoryError>;

    /// Check if a mission exists
    fn exists(&self, id: &MissionId) -> Result<bool, RepositoryError> {
        Ok(self.find_by_id(id)?.is_some())
    }

    /// Count all missions
    fn count(&self) -> Result<usize, RepositoryError>;

    /// Count missions by status
    fn count_by_status(&self, status: &MissionStatus) -> Result<usize, RepositoryError>;
}

/// Extension trait for async repository operations
///
/// This allows adapters to provide async implementations
/// while keeping the core trait sync-compatible.
pub trait MissionRepositoryAsync {
    /// Save a mission asynchronously
    fn save(
        &mut self,
        mission: &Mission,
    ) -> impl core::future::Future<Output = Result<(), RepositoryError>> + Send;

    /// Find a mission by ID asynchronously
    fn find_by_id(
        &self,
        id: &MissionId,
    ) -> impl core::future::Future<Output = Result<Option<Mission>, RepositoryError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::mission::Mission;
    use std::collections::HashMap;

    /// In-memory implementation for testing
    struct InMemoryMissionRepo {
        missions: HashMap<String, Mission>,
    }

    impl InMemoryMissionRepo {
        fn new() -> Self {
            Self {
                missions: HashMap::new(),
            }
        }
    }

    impl MissionRepository for InMemoryMissionRepo {
        fn save(&mut self, mission: &Mission) -> Result<(), RepositoryError> {
            self.missions
                .insert(mission.id().as_str().to_string(), mission.clone());
            Ok(())
        }

        fn find_by_id(&self, id: &MissionId) -> Result<Option<Mission>, RepositoryError> {
            Ok(self.missions.get(id.as_str()).cloned())
        }

        fn find_by_status(&self, status: &MissionStatus) -> Result<Vec<Mission>, RepositoryError> {
            Ok(self
                .missions
                .values()
                .filter(|m| m.status() == status)
                .cloned()
                .collect())
        }

        fn delete(&mut self, id: &MissionId) -> Result<(), RepositoryError> {
            self.missions.remove(id.as_str());
            Ok(())
        }

        fn count(&self) -> Result<usize, RepositoryError> {
            Ok(self.missions.len())
        }

        fn count_by_status(&self, status: &MissionStatus) -> Result<usize, RepositoryError> {
            Ok(self
                .missions
                .values()
                .filter(|m| m.status() == status)
                .count())
        }
    }

    #[test]
    fn test_in_memory_repo() {
        let mut repo = InMemoryMissionRepo::new();

        let mission = Mission::new(MissionId::new("m-001"), "Test goal");
        repo.save(&mission).unwrap();

        let found = repo.find_by_id(&MissionId::new("m-001")).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().goal(), "Test goal");

        assert_eq!(repo.count().unwrap(), 1);
    }
}
