//! Error types for AEGIS

use thiserror::Error;

/// Error thrown when role is not found
#[derive(Debug, Error)]
#[error("Role '{role_id}' not found. Available roles: {}", available_roles.join(", "))]
pub struct RoleNotFoundError {
    pub role_id: String,
    pub available_roles: Vec<String>,
}

/// Error thrown when server is not accessible for current role
#[derive(Debug, Error)]
#[error("Server '{server_name}' is not accessible for role '{current_role}'. Allowed servers: {}", allowed_servers.join(", "))]
pub struct ServerNotAccessibleError {
    pub server_name: String,
    pub current_role: String,
    pub allowed_servers: Vec<String>,
}

/// Error thrown when tool is not accessible
#[derive(Debug, Error)]
#[error("Tool '{tool_name}' is not accessible for role '{current_role}': {reason}")]
pub struct ToolNotAccessibleError {
    pub tool_name: String,
    pub current_role: String,
    pub reason: String,
}

/// General AEGIS error type
#[derive(Debug, Error)]
pub enum AegisError {
    #[error(transparent)]
    RoleNotFound(#[from] RoleNotFoundError),

    #[error(transparent)]
    ServerNotAccessible(#[from] ServerNotAccessibleError),

    #[error(transparent)]
    ToolNotAccessible(#[from] ToolNotAccessibleError),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("MCP error: {0}")]
    Mcp(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, AegisError>;
