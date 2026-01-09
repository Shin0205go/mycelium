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

    // ============== Additional Edge Case Tests ==============

    #[test]
    fn test_config_from_file_nonexistent() {
        let result = DesktopConfig::from_file(std::path::Path::new("/nonexistent/path.json"));
        assert!(result.is_err());
    }

    #[test]
    fn test_mcp_config_camel_case_serialization() {
        let config = MCPServerConfig {
            command: "test".to_string(),
            args: vec!["a".to_string()],
            env: HashMap::new(),
        };

        let json = serde_json::to_string(&config).unwrap();
        // Should use camelCase
        assert!(json.contains("\"command\""));
        assert!(json.contains("\"args\""));
    }

    #[test]
    fn test_desktop_config_camel_case() {
        let mut servers = HashMap::new();
        servers.insert("test".to_string(), MCPServerConfig {
            command: "cmd".to_string(),
            args: vec![],
            env: HashMap::new(),
        });

        let config = DesktopConfig { mcp_servers: servers };
        let json = serde_json::to_string(&config).unwrap();

        // Should use mcpServers (camelCase)
        assert!(json.contains("mcpServers"));
    }

    #[test]
    fn test_mcp_config_empty_command() {
        let config = MCPServerConfig {
            command: "".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        assert!(config.command.is_empty());
    }

    #[test]
    fn test_mcp_config_whitespace_in_args() {
        let config = MCPServerConfig {
            command: "echo".to_string(),
            args: vec!["hello world".to_string(), "  spaced  ".to_string()],
            env: HashMap::new(),
        };

        assert_eq!(config.args[0], "hello world");
        assert_eq!(config.args[1], "  spaced  ");
    }

    #[test]
    fn test_mcp_config_special_env_values() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), "/usr/bin:/bin".to_string());
        env.insert("EMPTY".to_string(), "".to_string());
        env.insert("QUOTES".to_string(), "\"quoted\"".to_string());

        let config = MCPServerConfig {
            command: "cmd".to_string(),
            args: vec![],
            env,
        };

        assert_eq!(config.env.get("PATH"), Some(&"/usr/bin:/bin".to_string()));
        assert_eq!(config.env.get("EMPTY"), Some(&"".to_string()));
        assert_eq!(config.env.get("QUOTES"), Some(&"\"quoted\"".to_string()));
    }

    #[test]
    fn test_desktop_config_clone() {
        let mut servers = HashMap::new();
        servers.insert("test".to_string(), MCPServerConfig {
            command: "cmd".to_string(),
            args: vec!["arg".to_string()],
            env: HashMap::new(),
        });

        let config = DesktopConfig { mcp_servers: servers };
        let cloned = config.clone();

        assert_eq!(cloned.mcp_servers.len(), config.mcp_servers.len());
        assert!(cloned.mcp_servers.contains_key("test"));
    }

    #[test]
    fn test_desktop_config_debug() {
        let config = DesktopConfig { mcp_servers: HashMap::new() };
        let debug = format!("{:?}", config);
        assert!(debug.contains("DesktopConfig"));
    }

    #[test]
    fn test_mcp_config_very_long_command() {
        let long_command = "a".repeat(10000);
        let config = MCPServerConfig {
            command: long_command.clone(),
            args: vec![],
            env: HashMap::new(),
        };

        assert_eq!(config.command.len(), 10000);
    }

    #[test]
    fn test_config_from_file_invalid_json() {
        use std::io::Write;

        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("invalid_aegis_test.json");

        {
            let mut file = std::fs::File::create(&file_path).unwrap();
            file.write_all(b"{ invalid json }").unwrap();
        }

        let result = DesktopConfig::from_file(&file_path);
        assert!(result.is_err());

        // Cleanup
        let _ = std::fs::remove_file(&file_path);
    }

    #[test]
    fn test_config_from_file_valid() {
        use std::io::Write;

        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("valid_aegis_test.json");

        {
            let mut file = std::fs::File::create(&file_path).unwrap();
            file.write_all(br#"{"mcpServers": {"test": {"command": "cmd", "args": []}}}"#).unwrap();
        }

        let result = DesktopConfig::from_file(&file_path);
        assert!(result.is_ok());

        let config = result.unwrap();
        assert!(config.mcp_servers.contains_key("test"));

        // Cleanup
        let _ = std::fs::remove_file(&file_path);
    }

    #[test]
    fn test_logger_trait_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<ConsoleLogger>();
        assert_send_sync::<NullLogger>();
    }

    #[test]
    fn test_config_deserialization_missing_optional_fields() {
        let json = r#"{"mcpServers": {"s": {"command": "c"}}}"#;
        let config: DesktopConfig = serde_json::from_str(json).unwrap();

        let server = &config.mcp_servers["s"];
        // args and env should default to empty
        assert!(server.args.is_empty());
        assert!(server.env.is_empty());
    }

    #[test]
    fn test_mcp_config_with_all_fields() {
        let mut env = HashMap::new();
        env.insert("KEY".to_string(), "VALUE".to_string());

        let config = MCPServerConfig {
            command: "full-command".to_string(),
            args: vec!["arg1".to_string(), "arg2".to_string(), "arg3".to_string()],
            env,
        };

        assert_eq!(config.command, "full-command");
        assert_eq!(config.args.len(), 3);
        assert_eq!(config.env.len(), 1);
    }

    #[test]
    fn test_server_names_returns_all_names() {
        let json = r#"{
            "mcpServers": {
                "a": {"command": "a"},
                "b": {"command": "b"},
                "c": {"command": "c"},
                "d": {"command": "d"},
                "e": {"command": "e"}
            }
        }"#;

        let config: DesktopConfig = serde_json::from_str(json).unwrap();
        let names = config.server_names();

        assert_eq!(names.len(), 5);
        for name in ["a", "b", "c", "d", "e"] {
            assert!(names.contains(&name));
        }
    }

    #[test]
    fn test_console_logger_methods_dont_panic() {
        let logger = ConsoleLogger;

        // These produce output to stderr but shouldn't panic
        logger.debug("debug message", None);
        logger.info("info message", None);
        logger.warn("warn message", None);
        logger.error("error message", None);
    }

    #[test]
    fn test_logger_with_empty_metadata() {
        let logger = NullLogger;
        let meta = HashMap::new();

        logger.debug("test", Some(&meta));
        logger.info("test", Some(&meta));
        logger.warn("test", Some(&meta));
        logger.error("test", Some(&meta));
    }
}
