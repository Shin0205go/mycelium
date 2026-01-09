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

#[cfg(test)]
mod tests {
    use super::*;

    // ============== RoleNotFoundError Tests ==============

    #[test]
    fn test_role_not_found_with_available_roles() {
        let error = RoleNotFoundError {
            role_id: "admin".to_string(),
            available_roles: vec!["user".to_string(), "guest".to_string()],
        };

        assert_eq!(error.role_id, "admin");
        assert_eq!(error.available_roles, vec!["user", "guest"]);
    }

    #[test]
    fn test_role_not_found_message_format() {
        let error = RoleNotFoundError {
            role_id: "superuser".to_string(),
            available_roles: vec!["admin".to_string(), "editor".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("superuser"));
        assert!(msg.contains("admin"));
        assert!(msg.contains("editor"));
    }

    #[test]
    fn test_role_not_found_empty_available_roles() {
        let error = RoleNotFoundError {
            role_id: "any".to_string(),
            available_roles: vec![],
        };

        let msg = error.to_string();
        assert!(msg.contains("any"));
        assert!(msg.contains("Available roles:"));
    }

    #[test]
    fn test_role_not_found_single_available_role() {
        let error = RoleNotFoundError {
            role_id: "admin".to_string(),
            available_roles: vec!["guest".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("guest"));
        assert!(!msg.contains(","));
    }

    // ============== ServerNotAccessibleError Tests ==============

    #[test]
    fn test_server_not_accessible_error() {
        let error = ServerNotAccessibleError {
            server_name: "database".to_string(),
            current_role: "guest".to_string(),
            allowed_servers: vec!["web".to_string(), "cache".to_string()],
        };

        assert_eq!(error.server_name, "database");
        assert_eq!(error.current_role, "guest");
        assert_eq!(error.allowed_servers, vec!["web", "cache"]);
    }

    #[test]
    fn test_server_not_accessible_message_format() {
        let error = ServerNotAccessibleError {
            server_name: "production-db".to_string(),
            current_role: "viewer".to_string(),
            allowed_servers: vec!["cache".to_string(), "api".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("production-db"));
        assert!(msg.contains("viewer"));
        assert!(msg.contains("cache"));
        assert!(msg.contains("api"));
    }

    #[test]
    fn test_server_not_accessible_empty_allowed_servers() {
        let error = ServerNotAccessibleError {
            server_name: "any".to_string(),
            current_role: "restricted".to_string(),
            allowed_servers: vec![],
        };

        let msg = error.to_string();
        assert!(msg.contains("Allowed servers:"));
    }

    #[test]
    fn test_server_not_accessible_wildcard_in_allowed() {
        let error = ServerNotAccessibleError {
            server_name: "secret".to_string(),
            current_role: "user".to_string(),
            allowed_servers: vec!["*".to_string()],
        };

        assert_eq!(error.allowed_servers, vec!["*"]);
    }

    // ============== ToolNotAccessibleError Tests ==============

    #[test]
    fn test_tool_not_accessible_error() {
        let error = ToolNotAccessibleError {
            tool_name: "delete_file".to_string(),
            current_role: "viewer".to_string(),
            reason: "denied by policy".to_string(),
        };

        assert_eq!(error.tool_name, "delete_file");
        assert_eq!(error.current_role, "viewer");
        assert_eq!(error.reason, "denied by policy");
    }

    #[test]
    fn test_tool_not_accessible_message_format() {
        let error = ToolNotAccessibleError {
            tool_name: "exec_bash".to_string(),
            current_role: "guest".to_string(),
            reason: "high risk operation".to_string(),
        };

        let msg = error.to_string();
        assert!(msg.contains("exec_bash"));
        assert!(msg.contains("guest"));
        assert!(msg.contains("high risk operation"));
    }

    #[test]
    fn test_tool_not_accessible_prefixed_tool_name() {
        let error = ToolNotAccessibleError {
            tool_name: "filesystem__write_file".to_string(),
            current_role: "readonly".to_string(),
            reason: "write operations blocked".to_string(),
        };

        let msg = error.to_string();
        assert!(msg.contains("filesystem__write_file"));
    }

    // ============== AegisError Tests ==============

    #[test]
    fn test_aegis_error_from_role_not_found() {
        let role_error = RoleNotFoundError {
            role_id: "test".to_string(),
            available_roles: vec!["guest".to_string()],
        };

        let error: AegisError = role_error.into();
        assert!(matches!(error, AegisError::RoleNotFound(_)));
    }

    #[test]
    fn test_aegis_error_from_server_not_accessible() {
        let server_error = ServerNotAccessibleError {
            server_name: "db".to_string(),
            current_role: "user".to_string(),
            allowed_servers: vec![],
        };

        let error: AegisError = server_error.into();
        assert!(matches!(error, AegisError::ServerNotAccessible(_)));
    }

    #[test]
    fn test_aegis_error_from_tool_not_accessible() {
        let tool_error = ToolNotAccessibleError {
            tool_name: "tool".to_string(),
            current_role: "role".to_string(),
            reason: "reason".to_string(),
        };

        let error: AegisError = tool_error.into();
        assert!(matches!(error, AegisError::ToolNotAccessible(_)));
    }

    #[test]
    fn test_aegis_error_config() {
        let error = AegisError::Config("Invalid configuration".to_string());
        let msg = error.to_string();
        assert!(msg.contains("Invalid configuration"));
    }

    #[test]
    fn test_aegis_error_mcp() {
        let error = AegisError::Mcp("Connection failed".to_string());
        let msg = error.to_string();
        assert!(msg.contains("Connection failed"));
    }

    #[test]
    fn test_aegis_error_other() {
        let error = AegisError::Other("Custom error".to_string());
        assert_eq!(error.to_string(), "Custom error");
    }

    #[test]
    fn test_aegis_error_from_io_error() {
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let error: AegisError = io_error.into();
        assert!(matches!(error, AegisError::Io(_)));
    }

    #[test]
    fn test_aegis_error_from_json_error() {
        let json_error = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let error: AegisError = json_error.into();
        assert!(matches!(error, AegisError::Json(_)));
    }

    // ============== Error Debug Trait Tests ==============

    #[test]
    fn test_role_not_found_debug() {
        let error = RoleNotFoundError {
            role_id: "admin".to_string(),
            available_roles: vec!["guest".to_string()],
        };

        let debug = format!("{:?}", error);
        assert!(debug.contains("RoleNotFoundError"));
        assert!(debug.contains("admin"));
    }

    #[test]
    fn test_server_not_accessible_debug() {
        let error = ServerNotAccessibleError {
            server_name: "db".to_string(),
            current_role: "user".to_string(),
            allowed_servers: vec!["web".to_string()],
        };

        let debug = format!("{:?}", error);
        assert!(debug.contains("ServerNotAccessibleError"));
    }

    #[test]
    fn test_tool_not_accessible_debug() {
        let error = ToolNotAccessibleError {
            tool_name: "tool".to_string(),
            current_role: "role".to_string(),
            reason: "reason".to_string(),
        };

        let debug = format!("{:?}", error);
        assert!(debug.contains("ToolNotAccessibleError"));
    }

    #[test]
    fn test_aegis_error_debug() {
        let error = AegisError::Config("test".to_string());
        let debug = format!("{:?}", error);
        assert!(debug.contains("Config"));
    }

    // ============== Result Type Tests ==============

    #[test]
    fn test_result_ok() {
        let result: Result<i32> = Ok(42);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn test_result_err() {
        let result: Result<i32> = Err(AegisError::Other("error".to_string()));
        assert!(result.is_err());
    }
}
