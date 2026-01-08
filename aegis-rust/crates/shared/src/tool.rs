//! Tool types for AEGIS

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// MCP Tool definition (matches @modelcontextprotocol/sdk)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    /// Tool name
    pub name: String,

    /// Tool description
    #[serde(default)]
    pub description: Option<String>,

    /// JSON Schema for input parameters
    #[serde(default)]
    pub input_schema: Value,
}

impl Tool {
    /// Create a new tool
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    /// Builder: set description
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Builder: set input schema
    pub fn with_schema(mut self, schema: Value) -> Self {
        self.input_schema = schema;
        self
    }
}

/// Extended tool information with source tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    /// Original tool definition
    pub tool: Tool,

    /// Source server name
    pub source_server: String,

    /// Prefixed tool name (serverName__toolName)
    pub prefixed_name: String,

    /// Whether this tool is currently visible
    pub visible: bool,

    /// Why this tool is visible/hidden
    pub visibility_reason: Option<String>,
}

impl ToolInfo {
    /// Create tool info from a tool and server name
    pub fn new(tool: Tool, source_server: impl Into<String>) -> Self {
        let source_server = source_server.into();
        let prefixed_name = format!("{}__{}", source_server, tool.name);
        Self {
            tool,
            source_server,
            prefixed_name,
            visible: true,
            visibility_reason: None,
        }
    }

    /// Create the prefixed name from server and tool name
    pub fn make_prefixed_name(server: &str, tool: &str) -> String {
        format!("{}__{}", server, tool)
    }

    /// Parse a prefixed name into (server, tool)
    pub fn parse_prefixed_name(prefixed: &str) -> Option<(&str, &str)> {
        prefixed.split_once("__")
    }

    /// Hide this tool with a reason
    pub fn hide(&mut self, reason: impl Into<String>) {
        self.visible = false;
        self.visibility_reason = Some(reason.into());
    }

    /// Show this tool with a reason
    pub fn show(&mut self, reason: impl Into<String>) {
        self.visible = true;
        self.visibility_reason = Some(reason.into());
    }
}

/// System tools that are always available
pub mod system_tools {
    use super::*;

    /// The set_role tool for switching roles
    pub fn set_role() -> Tool {
        Tool {
            name: "set_role".to_string(),
            description: Some("Switch to a different role. This changes which tools are available.".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "role_id": {
                        "type": "string",
                        "description": "The ID of the role to switch to"
                    }
                },
                "required": ["role_id"]
            }),
        }
    }

    /// The list_roles tool for discovering available roles
    pub fn list_roles() -> Tool {
        Tool {
            name: "list_roles".to_string(),
            description: Some("List all available roles and their descriptions.".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    /// Check if a tool name is a system tool
    pub fn is_system_tool(name: &str) -> bool {
        matches!(name, "set_role" | "list_roles")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prefixed_name() {
        let tool = Tool::new("read_file");
        let info = ToolInfo::new(tool, "filesystem");

        assert_eq!(info.prefixed_name, "filesystem__read_file");
    }

    #[test]
    fn test_parse_prefixed_name() {
        let (server, tool) = ToolInfo::parse_prefixed_name("filesystem__read_file").unwrap();
        assert_eq!(server, "filesystem");
        assert_eq!(tool, "read_file");
    }

    #[test]
    fn test_system_tools() {
        assert!(system_tools::is_system_tool("set_role"));
        assert!(system_tools::is_system_tool("list_roles"));
        assert!(!system_tools::is_system_tool("read_file"));
    }
}
