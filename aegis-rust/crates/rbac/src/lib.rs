//! # AEGIS RBAC
//!
//! Role-Based Access Control for AEGIS.
//!
//! ## Components
//!
//! - `RoleManager` - Role definitions and permission checking
//! - `ToolVisibilityManager` - Tool filtering by role
//! - `RoleMemoryStore` - Role-based memory storage

pub mod role_manager;
pub mod tool_visibility;
pub mod role_memory;

pub use role_manager::RoleManager;
pub use tool_visibility::ToolVisibilityManager;
pub use role_memory::RoleMemoryStore;
