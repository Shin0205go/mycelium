//! Mission - The baton that passes between agents
//!
//! A Mission is an Entity (has identity that persists through changes).
//! Even if the goal or context changes, it's still the "same" mission.

use super::agent::AgentId;
use super::artifact::Artifact;
use super::role::Role;

/// Unique identifier for a Mission
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MissionId(String);

impl MissionId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The current status of a Mission
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MissionStatus {
    /// Just created, not yet started
    Pending,
    /// Currently being worked on
    InProgress {
        /// Who is currently working on it
        current_agent: AgentId,
    },
    /// Waiting for verification
    AwaitingVerification,
    /// Successfully completed
    Completed,
    /// Failed (with reason)
    Failed { reason: String },
    /// Cancelled by user
    Cancelled,
}

/// What should happen next in the mission
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextAction {
    /// Which role should handle this
    pub target_role: Role,
    /// What they should do (instruction)
    pub instruction: String,
    /// Priority (higher = more urgent)
    pub priority: u8,
}

/// Context accumulated during mission execution
#[derive(Debug, Clone, Default)]
pub struct Context {
    /// Summarized history of what happened
    pub summary: String,
    /// Key decisions made
    pub decisions: Vec<String>,
    /// Important facts discovered
    pub facts: Vec<String>,
}

impl Context {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_summary(mut self, summary: impl Into<String>) -> Self {
        self.summary = summary.into();
        self
    }

    pub fn add_decision(&mut self, decision: impl Into<String>) {
        self.decisions.push(decision.into());
    }

    pub fn add_fact(&mut self, fact: impl Into<String>) {
        self.facts.push(fact.into());
    }
}

/// Mission - The central entity of AEGIS
///
/// This is the "baton" that gets passed between agents.
/// The Router (GameMaster) manages this object and decides
/// who gets to work on it next.
#[derive(Debug, Clone)]
pub struct Mission {
    /// Unique identifier (Entity identity)
    id: MissionId,
    /// The ultimate goal (what user wants)
    goal: String,
    /// Accumulated context (history, decisions, facts)
    context: Context,
    /// Produced artifacts (code, data, reports)
    artifacts: Vec<Artifact>,
    /// What should happen next
    next_action: Option<NextAction>,
    /// Current status
    status: MissionStatus,
}

impl Mission {
    /// Create a new Mission with a goal
    pub fn new(id: MissionId, goal: impl Into<String>) -> Self {
        Self {
            id,
            goal: goal.into(),
            context: Context::new(),
            artifacts: Vec::new(),
            next_action: None,
            status: MissionStatus::Pending,
        }
    }

    // ========== Getters ==========

    pub fn id(&self) -> &MissionId {
        &self.id
    }

    pub fn goal(&self) -> &str {
        &self.goal
    }

    pub fn context(&self) -> &Context {
        &self.context
    }

    pub fn artifacts(&self) -> &[Artifact] {
        &self.artifacts
    }

    pub fn next_action(&self) -> Option<&NextAction> {
        self.next_action.as_ref()
    }

    pub fn status(&self) -> &MissionStatus {
        &self.status
    }

    // ========== State Transitions ==========

    /// Start the mission with an agent
    pub fn start(&mut self, agent_id: AgentId) -> Result<(), MissionError> {
        match &self.status {
            MissionStatus::Pending => {
                self.status = MissionStatus::InProgress {
                    current_agent: agent_id,
                };
                Ok(())
            }
            _ => Err(MissionError::InvalidStateTransition {
                from: format!("{:?}", self.status),
                to: "InProgress".to_string(),
            }),
        }
    }

    /// Hand off to another agent
    pub fn handoff(&mut self, next: NextAction) -> Result<(), MissionError> {
        match &self.status {
            MissionStatus::InProgress { .. } => {
                self.next_action = Some(next);
                self.status = MissionStatus::Pending;
                Ok(())
            }
            _ => Err(MissionError::InvalidStateTransition {
                from: format!("{:?}", self.status),
                to: "Pending (handoff)".to_string(),
            }),
        }
    }

    /// Submit for verification
    pub fn submit_for_verification(&mut self) -> Result<(), MissionError> {
        match &self.status {
            MissionStatus::InProgress { .. } => {
                self.status = MissionStatus::AwaitingVerification;
                Ok(())
            }
            _ => Err(MissionError::InvalidStateTransition {
                from: format!("{:?}", self.status),
                to: "AwaitingVerification".to_string(),
            }),
        }
    }

    /// Mark as completed
    pub fn complete(&mut self) -> Result<(), MissionError> {
        match &self.status {
            MissionStatus::AwaitingVerification => {
                self.status = MissionStatus::Completed;
                self.next_action = None;
                Ok(())
            }
            _ => Err(MissionError::InvalidStateTransition {
                from: format!("{:?}", self.status),
                to: "Completed".to_string(),
            }),
        }
    }

    /// Mark as failed
    pub fn fail(&mut self, reason: impl Into<String>) {
        self.status = MissionStatus::Failed {
            reason: reason.into(),
        };
        self.next_action = None;
    }

    /// Cancel the mission
    pub fn cancel(&mut self) {
        self.status = MissionStatus::Cancelled;
        self.next_action = None;
    }

    // ========== Mutations ==========

    /// Add an artifact produced by an agent
    pub fn add_artifact(&mut self, artifact: Artifact) {
        self.artifacts.push(artifact);
    }

    /// Update the context with new information
    pub fn update_context<F>(&mut self, f: F)
    where
        F: FnOnce(&mut Context),
    {
        f(&mut self.context);
    }

    /// Set the next action
    pub fn set_next_action(&mut self, action: NextAction) {
        self.next_action = Some(action);
    }

    /// Clear the next action (after it's been dispatched)
    pub fn clear_next_action(&mut self) {
        self.next_action = None;
    }
}

/// Errors that can occur during Mission operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MissionError {
    InvalidStateTransition { from: String, to: String },
}

impl core::fmt::Display for MissionError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            MissionError::InvalidStateTransition { from, to } => {
                write!(f, "Invalid state transition from {} to {}", from, to)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mission_lifecycle() {
        let mut mission = Mission::new(
            MissionId::new("m-001"),
            "Create a stock analysis report",
        );

        assert_eq!(mission.status(), &MissionStatus::Pending);

        // Start with an agent
        let agent_id = AgentId::new("agent-architect");
        mission.start(agent_id.clone()).unwrap();

        assert!(matches!(
            mission.status(),
            MissionStatus::InProgress { current_agent } if *current_agent == agent_id
        ));

        // Submit for verification
        mission.submit_for_verification().unwrap();
        assert_eq!(mission.status(), &MissionStatus::AwaitingVerification);

        // Complete
        mission.complete().unwrap();
        assert_eq!(mission.status(), &MissionStatus::Completed);
    }

    #[test]
    fn test_invalid_transition() {
        let mut mission = Mission::new(MissionId::new("m-002"), "Test");

        // Can't complete a pending mission
        let result = mission.complete();
        assert!(result.is_err());
    }
}
