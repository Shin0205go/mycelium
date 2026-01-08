//! # AEGIS Shared
//!
//! Common types and interfaces used across all AEGIS packages.

pub mod error;
pub mod role;
pub mod skill;
pub mod tool;
pub mod config;

// Re-exports
pub use error::*;
pub use role::*;
pub use skill::*;
pub use tool::*;
pub use config::*;
