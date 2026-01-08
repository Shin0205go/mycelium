//! Repository Traits - The "Ports" of Hexagonal Architecture
//!
//! These traits define HOW the domain wants to persist data,
//! but NOT how it's actually done. That's the adapter's job.
//!
//! ```text
//! Domain Layer          │  Adapter Layer
//! ──────────────────────┼────────────────────────
//! trait MissionRepo     │  SqliteMissionRepo
//!   fn save()           │  InMemoryMissionRepo
//!   fn find()           │  S3MissionRepo
//! ```

pub mod agent_repository;
pub mod mission_repository;
