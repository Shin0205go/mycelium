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
}
