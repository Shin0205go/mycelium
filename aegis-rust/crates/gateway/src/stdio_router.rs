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

    // ============== Edge Case Tests ==============

    mod edge_cases {
        use super::*;

        #[test]
        fn test_empty_server_name() {
            let mut router = StdioRouter::new();
            router.add_server("", create_test_config());

            assert!(router.servers.contains_key(""));
            assert!(!router.is_connected(""));
        }

        #[test]
        fn test_unicode_server_name() {
            let mut router = StdioRouter::new();
            router.add_server("日本語サーバー", create_test_config());

            assert!(router.servers.contains_key("日本語サーバー"));
            let names = router.server_names();
            assert!(names.contains(&"日本語サーバー"));
        }

        #[test]
        fn test_special_chars_in_server_name() {
            let mut router = StdioRouter::new();

            let names_to_test = vec![
                "server-with-dash",
                "server_with_underscore",
                "server.with.dots",
                "server:with:colons",
            ];

            for name in &names_to_test {
                router.add_server(*name, create_test_config());
            }

            assert_eq!(router.servers.len(), names_to_test.len());
            for name in names_to_test {
                assert!(router.servers.contains_key(name));
            }
        }

        #[test]
        fn test_very_long_server_name() {
            let mut router = StdioRouter::new();
            let long_name = "a".repeat(10000);

            router.add_server(long_name.clone(), create_test_config());

            assert!(router.servers.contains_key(&long_name));
        }

        #[test]
        fn test_server_with_empty_args() {
            let mut router = StdioRouter::new();

            let config = MCPServerConfig {
                command: "cmd".to_string(),
                args: vec![],
                env: HashMap::new(),
            };

            router.add_server("empty-args", config);
            let server = router.servers.get("empty-args").unwrap();
            assert!(server.config.args.is_empty());
        }

        #[test]
        fn test_server_with_many_args() {
            let mut router = StdioRouter::new();

            let config = MCPServerConfig {
                command: "cmd".to_string(),
                args: (0..100).map(|i| format!("arg{}", i)).collect(),
                env: HashMap::new(),
            };

            router.add_server("many-args", config);
            let server = router.servers.get("many-args").unwrap();
            assert_eq!(server.config.args.len(), 100);
        }

        #[test]
        fn test_server_with_many_env_vars() {
            let mut router = StdioRouter::new();

            let mut env = HashMap::new();
            for i in 0..50 {
                env.insert(format!("VAR_{}", i), format!("value_{}", i));
            }

            let config = MCPServerConfig {
                command: "cmd".to_string(),
                args: vec![],
                env,
            };

            router.add_server("many-env", config);
            let server = router.servers.get("many-env").unwrap();
            assert_eq!(server.config.env.len(), 50);
        }

        #[test]
        fn test_stop_already_stopped_server() {
            let mut router = StdioRouter::new();
            router.add_server("test", create_test_config());

            // Server is not connected, so stopping should be no-op
            let result = router.stop_server("test");
            assert!(result.is_ok());

            // Stop again should still be ok
            let result = router.stop_server("test");
            assert!(result.is_ok());
        }

        #[test]
        fn test_stop_all_with_multiple_servers() {
            let mut router = StdioRouter::new();

            for i in 0..10 {
                router.add_server(format!("server{}", i), create_test_config());
            }

            router.stop_all();

            // All servers should be marked as not connected
            for i in 0..10 {
                assert!(!router.is_connected(&format!("server{}", i)));
            }
        }
    }

    // ============== Server Connection Tests ==============

    mod server_connection_tests {
        use super::*;

        #[test]
        fn test_connection_initial_state() {
            let config = create_test_config();
            let conn = ServerConnection::new("test-server", config);

            assert_eq!(conn.name, "test-server");
            assert!(!conn.connected);
            assert!(conn.tools.is_empty());
            assert!(conn.process.is_none());
        }

        #[test]
        fn test_connection_with_custom_config() {
            let mut env = HashMap::new();
            env.insert("KEY".to_string(), "VALUE".to_string());

            let config = MCPServerConfig {
                command: "custom_cmd".to_string(),
                args: vec!["arg1".to_string(), "arg2".to_string()],
                env,
            };

            let conn = ServerConnection::new("custom", config);

            assert_eq!(conn.config.command, "custom_cmd");
            assert_eq!(conn.config.args.len(), 2);
            assert_eq!(conn.config.env.get("KEY"), Some(&"VALUE".to_string()));
        }

        #[test]
        fn test_connection_debug_trait() {
            let conn = ServerConnection::new("debug-test", create_test_config());
            let debug = format!("{:?}", conn);
            assert!(debug.contains("ServerConnection"));
            assert!(debug.contains("debug-test"));
        }
    }

    // ============== Router Debug Tests ==============

    mod router_debug {
        use super::*;

        #[test]
        fn test_router_debug_empty() {
            let router = StdioRouter::new();
            let debug = format!("{:?}", router);
            assert!(debug.contains("StdioRouter"));
        }

        #[test]
        fn test_router_debug_with_servers() {
            let mut router = StdioRouter::new();
            router.add_server("server1", create_test_config());
            router.add_server("server2", create_test_config());

            let debug = format!("{:?}", router);
            assert!(debug.contains("StdioRouter"));
        }
    }

    // ============== Tool Discovery Extension Tests ==============

    mod tool_discovery_extension {
        use super::*;

        #[test]
        fn test_tools_from_disconnected_servers_not_included() {
            let mut router = StdioRouter::new();
            router.add_server("server1", create_test_config());
            router.add_server("server2", create_test_config());

            // Neither server is connected
            let tools = router.get_all_tools();
            assert!(tools.is_empty());
        }

        #[test]
        fn test_server_names_order_independence() {
            let mut router = StdioRouter::new();

            router.add_server("zebra", create_test_config());
            router.add_server("alpha", create_test_config());
            router.add_server("middle", create_test_config());

            let names = router.server_names();
            assert_eq!(names.len(), 3);
            // All names should be present regardless of order
            assert!(names.contains(&"zebra"));
            assert!(names.contains(&"alpha"));
            assert!(names.contains(&"middle"));
        }
    }

    // ============== Concurrency-Style Tests ==============

    mod concurrency_style {
        use super::*;

        #[test]
        fn test_rapid_add_remove() {
            let mut router = StdioRouter::new();

            for i in 0..100 {
                router.add_server(format!("server{}", i), create_test_config());
            }

            assert_eq!(router.servers.len(), 100);

            for i in 0..100 {
                let _ = router.stop_server(&format!("server{}", i));
            }

            // Servers are still in the map, just not connected
            assert_eq!(router.servers.len(), 100);
        }

        #[test]
        fn test_replace_server_multiple_times() {
            let mut router = StdioRouter::new();

            for i in 0..50 {
                let config = MCPServerConfig {
                    command: format!("cmd{}", i),
                    args: vec![],
                    env: HashMap::new(),
                };
                router.add_server("same-name", config);
            }

            // Should only have one server
            assert_eq!(router.servers.len(), 1);
            // With the last command
            assert_eq!(router.servers.get("same-name").unwrap().config.command, "cmd49");
        }
    }
}
