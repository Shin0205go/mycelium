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

    // ============== Tool Tests ==============

    #[test]
    fn test_tool_new() {
        let tool = Tool::new("my_tool");
        assert_eq!(tool.name, "my_tool");
        assert!(tool.description.is_none());
    }

    #[test]
    fn test_tool_with_description() {
        let tool = Tool::new("my_tool")
            .with_description("A test tool");

        assert_eq!(tool.name, "my_tool");
        assert_eq!(tool.description, Some("A test tool".to_string()));
    }

    #[test]
    fn test_tool_with_schema() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"}
            }
        });

        let tool = Tool::new("read_file")
            .with_schema(schema.clone());

        assert_eq!(tool.input_schema, schema);
    }

    #[test]
    fn test_tool_builder_chain() {
        let tool = Tool::new("complex_tool")
            .with_description("A complex tool")
            .with_schema(serde_json::json!({"type": "object"}));

        assert_eq!(tool.name, "complex_tool");
        assert!(tool.description.is_some());
    }

    #[test]
    fn test_tool_clone() {
        let tool = Tool::new("original").with_description("test");
        let cloned = tool.clone();

        assert_eq!(cloned.name, tool.name);
        assert_eq!(cloned.description, tool.description);
    }

    #[test]
    fn test_tool_debug() {
        let tool = Tool::new("debug_test");
        let debug = format!("{:?}", tool);
        assert!(debug.contains("Tool"));
        assert!(debug.contains("debug_test"));
    }

    #[test]
    fn test_tool_serialization() {
        let tool = Tool::new("test")
            .with_description("Test tool");

        let json = serde_json::to_string(&tool).unwrap();
        let parsed: Tool = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.name, tool.name);
        assert_eq!(parsed.description, tool.description);
    }

    #[test]
    fn test_tool_default_schema() {
        let tool = Tool::new("test");

        // Default schema should be an object type
        assert!(tool.input_schema.is_object());
        assert_eq!(tool.input_schema["type"], "object");
    }

    // ============== ToolInfo Tests ==============

    #[test]
    fn test_prefixed_name() {
        let tool = Tool::new("read_file");
        let info = ToolInfo::new(tool, "filesystem");

        assert_eq!(info.prefixed_name, "filesystem__read_file");
    }

    #[test]
    fn test_toolinfo_initial_visibility() {
        let tool = Tool::new("test");
        let info = ToolInfo::new(tool, "server");

        assert!(info.visible);
        assert!(info.visibility_reason.is_none());
    }

    #[test]
    fn test_toolinfo_hide() {
        let tool = Tool::new("test");
        let mut info = ToolInfo::new(tool, "server");

        info.hide("Not allowed for this role");

        assert!(!info.visible);
        assert_eq!(info.visibility_reason, Some("Not allowed for this role".to_string()));
    }

    #[test]
    fn test_toolinfo_show() {
        let tool = Tool::new("test");
        let mut info = ToolInfo::new(tool, "server");
        info.visible = false;

        info.show("Now allowed for admin");

        assert!(info.visible);
        assert_eq!(info.visibility_reason, Some("Now allowed for admin".to_string()));
    }

    #[test]
    fn test_toolinfo_hide_then_show() {
        let tool = Tool::new("test");
        let mut info = ToolInfo::new(tool, "server");

        info.hide("Hidden");
        assert!(!info.visible);

        info.show("Shown");
        assert!(info.visible);
    }

    #[test]
    fn test_toolinfo_source_server() {
        let tool = Tool::new("query");
        let info = ToolInfo::new(tool, "database");

        assert_eq!(info.source_server, "database");
    }

    #[test]
    fn test_make_prefixed_name() {
        let prefixed = ToolInfo::make_prefixed_name("filesystem", "read_file");
        assert_eq!(prefixed, "filesystem__read_file");
    }

    #[test]
    fn test_make_prefixed_name_special_chars() {
        let prefixed = ToolInfo::make_prefixed_name("server-name", "tool_name");
        assert_eq!(prefixed, "server-name__tool_name");
    }

    #[test]
    fn test_parse_prefixed_name() {
        let (server, tool) = ToolInfo::parse_prefixed_name("filesystem__read_file").unwrap();
        assert_eq!(server, "filesystem");
        assert_eq!(tool, "read_file");
    }

    #[test]
    fn test_parse_prefixed_name_no_separator() {
        let result = ToolInfo::parse_prefixed_name("notprefixed");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_prefixed_name_multiple_separators() {
        let (server, tool) = ToolInfo::parse_prefixed_name("server__nested__tool").unwrap();
        assert_eq!(server, "server");
        assert_eq!(tool, "nested__tool"); // Everything after first __
    }

    #[test]
    fn test_parse_prefixed_name_empty_server() {
        let (server, tool) = ToolInfo::parse_prefixed_name("__tool").unwrap();
        assert_eq!(server, "");
        assert_eq!(tool, "tool");
    }

    #[test]
    fn test_parse_prefixed_name_empty_tool() {
        let (server, tool) = ToolInfo::parse_prefixed_name("server__").unwrap();
        assert_eq!(server, "server");
        assert_eq!(tool, "");
    }

    #[test]
    fn test_toolinfo_clone() {
        let tool = Tool::new("test");
        let mut info = ToolInfo::new(tool, "server");
        info.hide("hidden");

        let cloned = info.clone();

        assert_eq!(cloned.prefixed_name, info.prefixed_name);
        assert_eq!(cloned.visible, info.visible);
        assert_eq!(cloned.visibility_reason, info.visibility_reason);
    }

    #[test]
    fn test_toolinfo_serialization() {
        let tool = Tool::new("test");
        let info = ToolInfo::new(tool, "server");

        let json = serde_json::to_string(&info).unwrap();
        let parsed: ToolInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.prefixed_name, info.prefixed_name);
        assert_eq!(parsed.source_server, info.source_server);
    }

    // ============== System Tools Tests ==============

    #[test]
    fn test_system_tools() {
        assert!(system_tools::is_system_tool("set_role"));
        assert!(system_tools::is_system_tool("list_roles"));
        assert!(!system_tools::is_system_tool("read_file"));
    }

    #[test]
    fn test_set_role_tool() {
        let tool = system_tools::set_role();

        assert_eq!(tool.name, "set_role");
        assert!(tool.description.is_some());
        assert!(tool.description.unwrap().contains("role"));
    }

    #[test]
    fn test_list_roles_tool() {
        let tool = system_tools::list_roles();

        assert_eq!(tool.name, "list_roles");
        assert!(tool.description.is_some());
    }

    #[test]
    fn test_set_role_schema() {
        let tool = system_tools::set_role();

        assert!(tool.input_schema.is_object());
        assert!(tool.input_schema["properties"]["role_id"].is_object());
        assert!(tool.input_schema["required"].as_array().unwrap().contains(&serde_json::json!("role_id")));
    }

    #[test]
    fn test_system_tools_case_sensitive() {
        assert!(!system_tools::is_system_tool("SET_ROLE"));
        assert!(!system_tools::is_system_tool("Set_Role"));
        assert!(!system_tools::is_system_tool("LIST_ROLES"));
    }

    #[test]
    fn test_system_tools_similar_names() {
        assert!(!system_tools::is_system_tool("set_role_custom"));
        assert!(!system_tools::is_system_tool("list_roles_all"));
        assert!(!system_tools::is_system_tool("pre_set_role"));
    }

    // ============== Edge Cases ==============

    #[test]
    fn test_tool_with_unicode_name() {
        let tool = Tool::new("日本語ツール");
        assert_eq!(tool.name, "日本語ツール");
    }

    #[test]
    fn test_tool_with_special_chars() {
        let tool = Tool::new("tool-with-dashes_and_underscores.v1");
        assert_eq!(tool.name, "tool-with-dashes_and_underscores.v1");
    }

    #[test]
    fn test_toolinfo_with_unicode_server() {
        let tool = Tool::new("ツール");
        let info = ToolInfo::new(tool, "サーバー");

        assert_eq!(info.source_server, "サーバー");
        assert_eq!(info.prefixed_name, "サーバー__ツール");
    }

    #[test]
    fn test_empty_tool_name() {
        let tool = Tool::new("");
        assert_eq!(tool.name, "");
    }

    #[test]
    fn test_very_long_tool_name() {
        let name = "a".repeat(10000);
        let tool = Tool::new(name.clone());
        assert_eq!(tool.name, name);
    }

    #[test]
    fn test_tool_description_none() {
        let tool = Tool::new("test");
        assert!(tool.description.is_none());
    }

    #[test]
    fn test_tool_description_empty_string() {
        let tool = Tool::new("test").with_description("");
        assert_eq!(tool.description, Some("".to_string()));
    }
}
