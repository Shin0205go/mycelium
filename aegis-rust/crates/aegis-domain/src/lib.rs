//! # AEGIS Domain Layer
//!
//! The heart of AEGIS - pure business logic with zero external dependencies.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                    Domain Layer (This Crate)                     │
//! │  ┌─────────────────────────────────────────────────────────────┐│
//! │  │  model/     - Entities & Value Objects                      ││
//! │  │  repository/- Trait definitions (not implementations)       ││
//! │  │  service/   - Domain services (GameLoop)                    ││
//! │  └─────────────────────────────────────────────────────────────┘│
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## The Golden Rule
//!
//! **This crate has ZERO external dependencies.**
//!
//! If Google changes Gemini API, this crate doesn't change.
//! If we switch from SQLite to PostgreSQL, this crate doesn't change.
//! This is data sovereignty in action.

pub mod model;
pub mod repository;
pub mod service;

// Re-export commonly used types
pub use model::{
    agent::{Agent, AgentId},
    artifact::{Artifact, ArtifactKind},
    mission::{Mission, MissionId, MissionStatus},
    role::Role,
    skill::{Skill, SkillId},
};

pub use repository::{
    agent_repository::AgentRepository,
    mission_repository::MissionRepository,
};

pub use service::game_loop::{GameLoop, GameLoopEvent};
