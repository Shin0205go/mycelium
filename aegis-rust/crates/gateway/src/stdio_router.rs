//! StdioRouter - Stdio-based MCP routing

use shared::{MCPServerConfig, Tool, ToolInfo, AegisError, Result};
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
// Note: BufRead, BufReader, Write will be used for MCP protocol implementation

/// Connection to an upstream MCP server
#[derive(Debug)]
pub struct ServerConnection {
    #[allow(dead_code)] // Used for debugging and logging
    pub name: String,
    pub config: MCPServerConfig,
    process: Option<Child>,
    pub tools: Vec<Tool>,
    pub connected: bool,
}

impl ServerConnection {
    /// Create a new server connection (not yet started)
    pub fn new(name: impl Into<String>, config: MCPServerConfig) -> Self {
        Self {
            name: name.into(),
            config,
            process: None,
            tools: Vec::new(),
            connected: false,
        }
    }
}

/// StdioRouter manages connections to multiple upstream MCP servers
#[derive(Debug, Default)]
pub struct StdioRouter {
    servers: HashMap<String, ServerConnection>,
}

impl StdioRouter {
    /// Create a new StdioRouter
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a server configuration
    pub fn add_server(&mut self, name: impl Into<String>, config: MCPServerConfig) {
        let name = name.into();
        self.servers.insert(name.clone(), ServerConnection::new(name, config));
    }

    /// Start a server
    pub fn start_server(&mut self, name: &str) -> Result<()> {
        let server = self.servers.get_mut(name).ok_or_else(|| {
            AegisError::Config(format!("Server '{}' not configured", name))
        })?;

        if server.connected {
            return Ok(());
        }

        let mut cmd = Command::new(&server.config.command);
        cmd.args(&server.config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in &server.config.env {
            cmd.env(key, value);
        }

        let child = cmd.spawn().map_err(|e| {
            AegisError::Mcp(format!("Failed to start server '{}': {}", name, e))
        })?;

        server.process = Some(child);
        server.connected = true;

        // TODO: Perform MCP initialization handshake
        // TODO: Discover tools via tools/list

        Ok(())
    }

    /// Stop a server
    pub fn stop_server(&mut self, name: &str) -> Result<()> {
        if let Some(server) = self.servers.get_mut(name) {
            if let Some(mut child) = server.process.take() {
                let _ = child.kill();
            }
            server.connected = false;
        }
        Ok(())
    }

    /// Stop all servers
    pub fn stop_all(&mut self) {
        let names: Vec<String> = self.servers.keys().cloned().collect();
        for name in names {
            let _ = self.stop_server(&name);
        }
    }

    /// Get all tool infos from all connected servers
    pub fn get_all_tools(&self) -> Vec<ToolInfo> {
        let mut tools = Vec::new();

        for (server_name, server) in &self.servers {
            if server.connected {
                for tool in &server.tools {
                    tools.push(ToolInfo::new(tool.clone(), server_name.clone()));
                }
            }
        }

        tools
    }

    /// Check if a server is connected
    pub fn is_connected(&self, name: &str) -> bool {
        self.servers.get(name).map(|s| s.connected).unwrap_or(false)
    }

    /// Get server names
    pub fn server_names(&self) -> Vec<&str> {
        self.servers.keys().map(|s| s.as_str()).collect()
    }
}

impl Drop for StdioRouter {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> MCPServerConfig {
        MCPServerConfig {
            command: "echo".to_string(),
            args: vec!["hello".to_string()],
            env: HashMap::new(),
        }
    }

    // ============== Basic Router Tests ==============

    #[test]
    fn test_router_creation() {
        let mut router = StdioRouter::new();

        router.add_server("test", create_test_config());

        assert!(router.servers.contains_key("test"));
        assert!(!router.is_connected("test"));
    }

    #[test]
    fn test_router_default() {
        let router = StdioRouter::default();
        assert!(router.servers.is_empty());
    }

    #[test]
    fn test_add_multiple_servers() {
        let mut router = StdioRouter::new();

        router.add_server("server1", create_test_config());
        router.add_server("server2", create_test_config());
        router.add_server("server3", create_test_config());

        assert_eq!(router.servers.len(), 3);
        assert!(router.servers.contains_key("server1"));
        assert!(router.servers.contains_key("server2"));
        assert!(router.servers.contains_key("server3"));
    }

    #[test]
    fn test_server_names() {
        let mut router = StdioRouter::new();

        router.add_server("alpha", create_test_config());
        router.add_server("beta", create_test_config());

        let names = router.server_names();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"alpha"));
        assert!(names.contains(&"beta"));
    }

    #[test]
    fn test_is_connected_false_initially() {
        let mut router = StdioRouter::new();
        router.add_server("test", create_test_config());

        assert!(!router.is_connected("test"));
    }

    #[test]
    fn test_is_connected_unknown_server() {
        let router = StdioRouter::new();
        assert!(!router.is_connected("nonexistent"));
    }

    // ============== Server Connection Tests ==============

    #[test]
    fn test_server_connection_creation() {
        let config = create_test_config();
        let conn = ServerConnection::new("test", config);

        assert_eq!(conn.name, "test");
        assert!(!conn.connected);
        assert!(conn.tools.is_empty());
        assert!(conn.process.is_none());
    }

    // ============== Tool Discovery Tests ==============

    #[test]
    fn test_get_all_tools_empty() {
        let router = StdioRouter::new();
        let tools = router.get_all_tools();
        assert!(tools.is_empty());
    }

    #[test]
    fn test_get_all_tools_with_unconnected_server() {
        let mut router = StdioRouter::new();
        router.add_server("test", create_test_config());

        // Server not connected, so no tools
        let tools = router.get_all_tools();
        assert!(tools.is_empty());
    }

    // ============== Stop Server Tests ==============

    #[test]
    fn test_stop_nonexistent_server() {
        let mut router = StdioRouter::new();
        let result = router.stop_server("nonexistent");
        assert!(result.is_ok());
    }

    #[test]
    fn test_stop_all_empty() {
        let mut router = StdioRouter::new();
        router.stop_all();
        // Should not panic
    }

    // ============== Start Server Tests ==============

    #[test]
    fn test_start_unconfigured_server_fails() {
        let mut router = StdioRouter::new();
        let result = router.start_server("nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not configured"));
    }

    // ============== Config with Environment ==============

    #[test]
    fn test_server_with_environment() {
        let mut config = create_test_config();
        config.env.insert("MY_VAR".to_string(), "my_value".to_string());
        config.env.insert("ANOTHER_VAR".to_string(), "another_value".to_string());

        let mut router = StdioRouter::new();
        router.add_server("test", config.clone());

        let server = router.servers.get("test").unwrap();
        assert_eq!(server.config.env.len(), 2);
        assert_eq!(server.config.env.get("MY_VAR"), Some(&"my_value".to_string()));
    }

    // ============== Server Replacement ==============

    #[test]
    fn test_add_server_replaces_existing() {
        let mut router = StdioRouter::new();

        let config1 = MCPServerConfig {
            command: "cmd1".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        let config2 = MCPServerConfig {
            command: "cmd2".to_string(),
            args: vec![],
            env: HashMap::new(),
        };

        router.add_server("test", config1);
        assert_eq!(router.servers.get("test").unwrap().config.command, "cmd1");

        router.add_server("test", config2);
        assert_eq!(router.servers.get("test").unwrap().config.command, "cmd2");

        // Should still have only one server
        assert_eq!(router.servers.len(), 1);
    }
}
