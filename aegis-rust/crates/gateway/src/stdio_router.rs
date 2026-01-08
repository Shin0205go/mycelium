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

    #[test]
    fn test_router_creation() {
        let mut router = StdioRouter::new();

        router.add_server("test", MCPServerConfig {
            command: "echo".to_string(),
            args: vec!["hello".to_string()],
            env: HashMap::new(),
        });

        assert!(router.servers.contains_key("test"));
        assert!(!router.is_connected("test"));
    }
}
