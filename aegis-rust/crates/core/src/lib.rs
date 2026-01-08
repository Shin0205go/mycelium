//! # AEGIS Core
//!
//! Integration layer with AegisRouterCore - the central orchestrator.

mod aegis_router_core;

pub use aegis_router_core::AegisRouterCore;

// Re-export dependencies
pub use rbac::{RoleManager, ToolVisibilityManager, RoleMemoryStore};
pub use a2a::IdentityResolver;
pub use audit::{AuditLogger, RateLimiter};
pub use gateway::StdioRouter;
