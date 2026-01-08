//! # AEGIS A2A
//!
//! Agent-to-Agent Identity Resolution based on A2A Agent Card skills.

mod identity_resolver;
mod types;

pub use identity_resolver::{IdentityResolver, IdentityResolverConfig, IdentityResolverStats};
pub use types::*;
