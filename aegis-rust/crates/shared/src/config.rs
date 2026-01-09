//! Configuration types for AEGIS

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for an MCP server process
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPServerConfig {
    /// Command to execute
    pub command: String,

    /// Command line arguments
    #[serde(default)]
    pub args: Vec<String>,

    /// Environment variables
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// Desktop configuration format (claude_desktop_config.json / config.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    /// MCP server configurations
    pub mcp_servers: HashMap<String, MCPServerConfig>,
}

impl DesktopConfig {
    /// Load configuration from a JSON file
    pub fn from_file(path: &std::path::Path) -> crate::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: Self = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Get server names
    pub fn server_names(&self) -> Vec<&str> {
        self.mcp_servers.keys().map(|s| s.as_str()).collect()
    }
}

/// Logger interface for dependency injection
pub trait Logger: Send + Sync {
    fn debug(&self, message: &str, meta: Option<&HashMap<String, String>>);
    fn info(&self, message: &str, meta: Option<&HashMap<String, String>>);
    fn warn(&self, message: &str, meta: Option<&HashMap<String, String>>);
    fn error(&self, message: &str, meta: Option<&HashMap<String, String>>);
}

/// Simple console logger implementation
#[derive(Debug, Clone, Default)]
pub struct ConsoleLogger;

impl Logger for ConsoleLogger {
    fn debug(&self, message: &str, _meta: Option<&HashMap<String, String>>) {
        eprintln!("[DEBUG] {}", message);
    }

    fn info(&self, message: &str, _meta: Option<&HashMap<String, String>>) {
        eprintln!("[INFO] {}", message);
    }

    fn warn(&self, message: &str, _meta: Option<&HashMap<String, String>>) {
        eprintln!("[WARN] {}", message);
    }

    fn error(&self, message: &str, _meta: Option<&HashMap<String, String>>) {
        eprintln!("[ERROR] {}", message);
    }
}

/// No-op logger for testing
#[derive(Debug, Clone, Default)]
pub struct NullLogger;

impl Logger for NullLogger {
    fn debug(&self, _message: &str, _meta: Option<&HashMap<String, String>>) {}
    fn info(&self, _message: &str, _meta: Option<&HashMap<String, String>>) {}
    fn warn(&self, _message: &str, _meta: Option<&HashMap<String, String>>) {}
    fn error(&self, _message: &str, _meta: Option<&HashMap<String, String>>) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============== MCPServerConfig Tests ==============

    #[test]
    fn test_mcp_server_config_basic() {
        let config = MCPServerConfig {
            command: "node".to_string(),
            args: vec!["server.js".to_string()],
            env: HashMap::new(),
        };

        assert_eq!(config.command, "node");
        assert_eq!(config.args.len(), 1);
    }

    #[test]
    fn test_mcp_server_config_with_env() {
        let mut env = HashMap::new();
        env.insert("DEBUG".to_string(), "true".to_string());
        env.insert("PORT".to_string(), "3000".to_string());

        let config = MCPServerConfig {
            command: "npm".to_string(),
            args: vec!["start".to_string()],
            env,
        };

        assert_eq!(config.env.get("DEBUG"), Some(&"true".to_string()));
        assert_eq!(config.env.get("PORT"), Some(&"3000".to_string()));
    }

    #[test]
    fn test_mcp_server_config_serialization() {
        let config = MCPServerConfig {
            command: "node".to_string(),
            args: vec!["app.js".to_string()],
            env: HashMap::new(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: MCPServerConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.command, config.command);
        assert_eq!(parsed.args, config.args);
    }

    #[test]
    fn test_mcp_server_config_deserialization() {
        let json = r#"{"command": "npx", "args": ["-y", "server"]}"#;
        let config: MCPServerConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.command, "npx");
        assert_eq!(config.args, vec!["-y", "server"]);
        assert!(config.env.is_empty()); // default empty
    }

    #[test]
    fn test_mcp_server_config_clone() {
        let config = MCPServerConfig {
            command: "cmd".to_string(),
            args: vec!["arg1".to_string()],
            env: HashMap::new(),
        };

        let cloned = config.clone();
        assert_eq!(cloned.command, config.command);
    }

    #[test]
    fn test_mcp_server_config_debug() {
        let config = MCPServerConfig {
            command: "test".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        let debug = format!("{:?}", config);
        assert!(debug.contains("MCPServerConfig"));
    }

    // ============== DesktopConfig Tests ==============

    #[test]
    fn test_config_parse() {
        let json = r#"{
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"]
                }
            }
        }"#;

        let config: DesktopConfig = serde_json::from_str(json).unwrap();
        assert!(config.mcp_servers.contains_key("filesystem"));
    }

    #[test]
    fn test_config_empty_servers() {
        let json = r#"{"mcpServers": {}}"#;
        let config: DesktopConfig = serde_json::from_str(json).unwrap();

        assert!(config.mcp_servers.is_empty());
        assert!(config.server_names().is_empty());
    }

    #[test]
    fn test_config_multiple_servers() {
        let json = r#"{
            "mcpServers": {
                "filesystem": {"command": "fs-server", "args": []},
                "database": {"command": "db-server", "args": []},
                "git": {"command": "git-server", "args": []}
            }
        }"#;

        let config: DesktopConfig = serde_json::from_str(json).unwrap();
        let names = config.server_names();

        assert_eq!(names.len(), 3);
        assert!(names.contains(&"filesystem"));
        assert!(names.contains(&"database"));
        assert!(names.contains(&"git"));
    }

    #[test]
    fn test_config_server_names() {
        let mut servers = HashMap::new();
        servers.insert("server1".to_string(), MCPServerConfig {
            command: "cmd".to_string(),
            args: vec![],
            env: HashMap::new(),
        });
        servers.insert("server2".to_string(), MCPServerConfig {
            command: "cmd".to_string(),
            args: vec![],
            env: HashMap::new(),
        });

        let config = DesktopConfig { mcp_servers: servers };
        let names = config.server_names();

        assert_eq!(names.len(), 2);
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let mut servers = HashMap::new();
        servers.insert("test".to_string(), MCPServerConfig {
            command: "node".to_string(),
            args: vec!["server.js".to_string()],
            env: HashMap::new(),
        });

        let config = DesktopConfig { mcp_servers: servers };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: DesktopConfig = serde_json::from_str(&json).unwrap();

        assert!(parsed.mcp_servers.contains_key("test"));
    }

    #[test]
    fn test_config_with_environment_variables() {
        let json = r#"{
            "mcpServers": {
                "test": {
                    "command": "node",
                    "args": [],
                    "env": {
                        "API_KEY": "secret",
                        "DEBUG": "true"
                    }
                }
            }
        }"#;

        let config: DesktopConfig = serde_json::from_str(json).unwrap();
        let server = &config.mcp_servers["test"];

        assert_eq!(server.env.get("API_KEY"), Some(&"secret".to_string()));
        assert_eq!(server.env.get("DEBUG"), Some(&"true".to_string()));
    }

    // ============== Logger Tests ==============

    #[test]
    fn test_console_logger_creation() {
        let logger = ConsoleLogger::default();
        // Just verify it can be created
        let _ = format!("{:?}", logger);
    }

    #[test]
    fn test_null_logger_creation() {
        let logger = NullLogger::default();
        // Just verify it can be created
        let _ = format!("{:?}", logger);
    }

    #[test]
    fn test_null_logger_all_methods() {
        let logger = NullLogger;

        // All methods should be no-ops (not panic)
        logger.debug("test", None);
        logger.info("test", None);
        logger.warn("test", None);
        logger.error("test", None);

        let mut meta = HashMap::new();
        meta.insert("key".to_string(), "value".to_string());

        logger.debug("test", Some(&meta));
        logger.info("test", Some(&meta));
        logger.warn("test", Some(&meta));
        logger.error("test", Some(&meta));
    }

    #[test]
    fn test_logger_with_metadata() {
        let logger = NullLogger;
        let mut meta = HashMap::new();
        meta.insert("component".to_string(), "test".to_string());
        meta.insert("action".to_string(), "unit_test".to_string());

        // Should not panic with metadata
        logger.info("Test message", Some(&meta));
    }

    #[test]
    fn test_console_logger_clone() {
        let logger = ConsoleLogger;
        let cloned = logger.clone();
        // Both should work
        let _ = format!("{:?}", cloned);
    }

    #[test]
    fn test_null_logger_clone() {
        let logger = NullLogger;
        let cloned = logger.clone();
        cloned.info("test", None);
    }

    // ============== Edge Cases ==============

    #[test]
    fn test_config_special_characters_in_names() {
        let json = r#"{
            "mcpServers": {
                "server-with-dashes": {"command": "cmd", "args": []},
                "server_with_underscores": {"command": "cmd", "args": []},
                "server.with.dots": {"command": "cmd", "args": []}
            }
        }"#;

        let config: DesktopConfig = serde_json::from_str(json).unwrap();
        assert!(config.mcp_servers.contains_key("server-with-dashes"));
        assert!(config.mcp_servers.contains_key("server_with_underscores"));
        assert!(config.mcp_servers.contains_key("server.with.dots"));
    }

    #[test]
    fn test_config_unicode_values() {
        let json = r#"{
            "mcpServers": {
                "日本語サーバー": {"command": "コマンド", "args": ["引数"]}
            }
        }"#;

        let config: DesktopConfig = serde_json::from_str(json).unwrap();
        assert!(config.mcp_servers.contains_key("日本語サーバー"));
        assert_eq!(config.mcp_servers["日本語サーバー"].command, "コマンド");
    }

    #[test]
    fn test_mcp_server_config_empty_args() {
        let json = r#"{"command": "cmd", "args": []}"#;
        let config: MCPServerConfig = serde_json::from_str(json).unwrap();

        assert!(config.args.is_empty());
    }

    #[test]
    fn test_mcp_server_config_many_args() {
        let args: Vec<String> = (0..100).map(|i| format!("arg{}", i)).collect();
        let config = MCPServerConfig {
            command: "cmd".to_string(),
            args,
            env: HashMap::new(),
        };

        assert_eq!(config.args.len(), 100);
    }
}
