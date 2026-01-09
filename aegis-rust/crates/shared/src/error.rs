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

    // ============== Edge Cases ==============

    #[test]
    fn test_role_not_found_empty_role_id() {
        let error = RoleNotFoundError {
            role_id: "".to_string(),
            available_roles: vec!["admin".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("not found"));
    }

    #[test]
    fn test_role_not_found_unicode_role_id() {
        let error = RoleNotFoundError {
            role_id: "管理者".to_string(),
            available_roles: vec!["ユーザー".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("管理者"));
        assert!(msg.contains("ユーザー"));
    }

    #[test]
    fn test_role_not_found_many_available_roles() {
        let available: Vec<String> = (0..100).map(|i| format!("role_{}", i)).collect();
        let error = RoleNotFoundError {
            role_id: "missing".to_string(),
            available_roles: available.clone(),
        };

        let msg = error.to_string();
        assert!(msg.contains("role_0"));
        assert!(msg.contains("role_99"));
    }

    #[test]
    fn test_server_not_accessible_unicode() {
        let error = ServerNotAccessibleError {
            server_name: "データベース".to_string(),
            current_role: "ゲスト".to_string(),
            allowed_servers: vec!["ファイル".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("データベース"));
        assert!(msg.contains("ゲスト"));
    }

    #[test]
    fn test_server_not_accessible_empty_server_name() {
        let error = ServerNotAccessibleError {
            server_name: "".to_string(),
            current_role: "user".to_string(),
            allowed_servers: vec!["server".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("not accessible"));
    }

    #[test]
    fn test_tool_not_accessible_empty_reason() {
        let error = ToolNotAccessibleError {
            tool_name: "tool".to_string(),
            current_role: "role".to_string(),
            reason: "".to_string(),
        };

        let msg = error.to_string();
        assert!(msg.contains("tool"));
        assert!(msg.contains("role"));
    }

    #[test]
    fn test_tool_not_accessible_unicode() {
        let error = ToolNotAccessibleError {
            tool_name: "削除ツール".to_string(),
            current_role: "閲覧者".to_string(),
            reason: "権限不足".to_string(),
        };

        let msg = error.to_string();
        assert!(msg.contains("削除ツール"));
        assert!(msg.contains("権限不足"));
    }

    #[test]
    fn test_tool_not_accessible_long_reason() {
        let long_reason = "x".repeat(10000);
        let error = ToolNotAccessibleError {
            tool_name: "tool".to_string(),
            current_role: "role".to_string(),
            reason: long_reason.clone(),
        };

        let msg = error.to_string();
        assert!(msg.contains(&long_reason));
    }

    #[test]
    fn test_aegis_error_config_empty_message() {
        let error = AegisError::Config("".to_string());
        let msg = error.to_string();
        assert!(msg.contains("Configuration error"));
    }

    #[test]
    fn test_aegis_error_config_unicode() {
        let error = AegisError::Config("設定エラー".to_string());
        let msg = error.to_string();
        assert!(msg.contains("設定エラー"));
    }

    #[test]
    fn test_aegis_error_mcp_empty_message() {
        let error = AegisError::Mcp("".to_string());
        let msg = error.to_string();
        assert!(msg.contains("MCP error"));
    }

    #[test]
    fn test_aegis_error_other_empty() {
        let error = AegisError::Other("".to_string());
        assert_eq!(error.to_string(), "");
    }

    #[test]
    fn test_aegis_error_io_different_kinds() {
        let kinds = vec![
            std::io::ErrorKind::NotFound,
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::ConnectionRefused,
            std::io::ErrorKind::TimedOut,
        ];

        for kind in kinds {
            let io_error = std::io::Error::new(kind, "test");
            let error: AegisError = io_error.into();
            assert!(matches!(error, AegisError::Io(_)));
        }
    }

    #[test]
    fn test_result_map() {
        let ok_result: Result<i32> = Ok(5);
        let mapped = ok_result.map(|x| x * 2);
        assert_eq!(mapped.unwrap(), 10);
    }

    #[test]
    fn test_result_and_then() {
        let ok_result: Result<i32> = Ok(5);
        let chained = ok_result.and_then(|x| Ok(x * 2));
        assert_eq!(chained.unwrap(), 10);
    }

    #[test]
    fn test_result_unwrap_or() {
        let err_result: Result<i32> = Err(AegisError::Other("error".to_string()));
        let value = err_result.unwrap_or(42);
        assert_eq!(value, 42);
    }

    #[test]
    fn test_error_source_chain() {
        use std::error::Error;

        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let error: AegisError = io_error.into();

        // AegisError should have a source
        assert!(error.source().is_some());
    }

    #[test]
    fn test_role_not_found_error_source() {
        use std::error::Error;

        let error = RoleNotFoundError {
            role_id: "test".to_string(),
            available_roles: vec![],
        };

        // RoleNotFoundError doesn't wrap another error
        assert!(error.source().is_none());
    }

    // ============== Special Character Tests ==============

    #[test]
    fn test_role_not_found_with_newlines() {
        let error = RoleNotFoundError {
            role_id: "role\nwith\nnewlines".to_string(),
            available_roles: vec!["normal".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("role\nwith\nnewlines"));
    }

    #[test]
    fn test_server_not_accessible_with_special_chars() {
        let error = ServerNotAccessibleError {
            server_name: "server:8080/path".to_string(),
            current_role: "user@domain".to_string(),
            allowed_servers: vec!["other:9090".to_string()],
        };

        let msg = error.to_string();
        assert!(msg.contains("server:8080/path"));
        assert!(msg.contains("user@domain"));
    }

    #[test]
    fn test_tool_not_accessible_with_quotes() {
        let error = ToolNotAccessibleError {
            tool_name: "tool\"with\"quotes".to_string(),
            current_role: "role'with'quotes".to_string(),
            reason: "reason: \"quoted\"".to_string(),
        };

        let msg = error.to_string();
        assert!(msg.contains("tool\"with\"quotes"));
    }

    // ============== Clone Tests ==============

    #[test]
    fn test_aegis_error_debug_all_variants() {
        let errors: Vec<AegisError> = vec![
            AegisError::RoleNotFound(RoleNotFoundError {
                role_id: "test".to_string(),
                available_roles: vec![],
            }),
            AegisError::ServerNotAccessible(ServerNotAccessibleError {
                server_name: "s".to_string(),
                current_role: "r".to_string(),
                allowed_servers: vec![],
            }),
            AegisError::ToolNotAccessible(ToolNotAccessibleError {
                tool_name: "t".to_string(),
                current_role: "r".to_string(),
                reason: "x".to_string(),
            }),
            AegisError::Config("c".to_string()),
            AegisError::Mcp("m".to_string()),
            AegisError::Other("o".to_string()),
        ];

        for error in errors {
            let debug = format!("{:?}", error);
            assert!(!debug.is_empty());
        }
    }

    // ============== Additional Error Tests ==============

    mod additional_error_tests {
        use super::*;

        #[test]
        fn test_error_display_consistency() {
            let error = AegisError::Config("test".to_string());
            let display = error.to_string();
            let debug = format!("{:?}", error);

            // Both should contain the message
            assert!(display.contains("test"));
            assert!(debug.contains("test"));
        }

        #[test]
        fn test_role_not_found_long_list() {
            let roles: Vec<String> = (0..1000).map(|i| format!("role_{}", i)).collect();
            let error = RoleNotFoundError {
                role_id: "missing".to_string(),
                available_roles: roles,
            };

            let msg = error.to_string();
            assert!(msg.contains("missing"));
            assert!(msg.contains("role_0"));
        }

        #[test]
        fn test_server_not_accessible_with_wildcard() {
            let error = ServerNotAccessibleError {
                server_name: "secret".to_string(),
                current_role: "limited".to_string(),
                allowed_servers: vec!["public*".to_string()],
            };

            let msg = error.to_string();
            assert!(msg.contains("secret"));
            assert!(msg.contains("public*"));
        }

        #[test]
        fn test_tool_not_accessible_complex_reason() {
            let error = ToolNotAccessibleError {
                tool_name: "dangerous_tool".to_string(),
                current_role: "guest".to_string(),
                reason: "Tool is denied by pattern '*_dangerous_*' and role lacks permission 'admin.tools.execute'".to_string(),
            };

            let msg = error.to_string();
            assert!(msg.contains("dangerous_tool"));
            assert!(msg.contains("pattern"));
        }

        #[test]
        fn test_aegis_error_chain() {
            use std::error::Error;

            let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "inner");
            let aegis_err: AegisError = io_err.into();

            // Should have a source
            assert!(aegis_err.source().is_some());
        }

        #[test]
        fn test_result_unwrap_or_else() {
            let err_result: Result<i32> = Err(AegisError::Other("failed".to_string()));
            let value = err_result.unwrap_or_else(|e| {
                if e.to_string().contains("failed") { 42 } else { 0 }
            });
            assert_eq!(value, 42);
        }

        #[test]
        fn test_error_with_newlines_in_message() {
            let error = AegisError::Config("line1\nline2\nline3".to_string());
            let msg = error.to_string();
            assert!(msg.contains("line1"));
            assert!(msg.contains("line3"));
        }

        #[test]
        fn test_multiple_error_conversions() {
            // Create multiple errors and convert
            for _ in 0..10 {
                let role_err = RoleNotFoundError {
                    role_id: "x".to_string(),
                    available_roles: vec![],
                };
                let _: AegisError = role_err.into();
            }
        }
    }
}
