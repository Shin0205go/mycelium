//! Role configuration types

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tool-level permissions for fine-grained access control
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissions {
    /// Explicitly allowed tools (overrides server-level permissions)
    #[serde(default)]
    pub allow: Vec<String>,

    /// Explicitly denied tools (overrides allow list)
    #[serde(default)]
    pub deny: Vec<String>,

    /// Tool patterns to allow (glob-style, e.g., 'filesystem__read*')
    #[serde(default)]
    pub allow_patterns: Vec<String>,

    /// Tool patterns to deny
    #[serde(default)]
    pub deny_patterns: Vec<String>,
}

/// Role metadata for management and auditing
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMetadata {
    /// Role version
    pub version: Option<String>,

    /// When the role was created
    pub created_at: Option<String>,

    /// Who created the role
    pub created_by: Option<String>,

    /// Last modification time
    pub last_modified: Option<String>,

    /// Role priority (higher = more privileged)
    pub priority: Option<i32>,

    /// Tags for categorization
    #[serde(default)]
    pub tags: Vec<String>,

    /// Whether this role is currently active
    #[serde(default = "default_active")]
    pub active: bool,

    /// Skills assigned to this role
    #[serde(default)]
    pub skills: Vec<String>,
}

fn default_active() -> bool {
    true
}

/// Configuration for fetching system instruction from a remote MCP server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInstruction {
    /// Backend/server name that provides the prompt
    pub backend: String,

    /// Name of the prompt to fetch via prompts/get
    pub prompt_name: String,

    /// Optional arguments to pass to the prompt
    #[serde(default)]
    pub arguments: HashMap<String, String>,

    /// Cache TTL in seconds (0 = no cache, default = 300)
    #[serde(default = "default_cache_ttl")]
    pub cache_ttl: u64,

    /// Fallback instruction if remote fetch fails
    pub fallback: Option<String>,
}

fn default_cache_ttl() -> u64 {
    300
}

/// Role definition that determines which servers/tools are accessible
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    /// Unique role identifier (e.g., 'frontend', 'db_admin', 'security')
    pub id: String,

    /// Human-readable role name
    pub name: String,

    /// Role description
    pub description: String,

    /// Parent role ID to inherit permissions from
    pub inherits: Option<String>,

    /// List of allowed upstream server names
    #[serde(default)]
    pub allowed_servers: Vec<String>,

    /// System instruction/prompt for this role
    #[serde(default)]
    pub system_instruction: String,

    /// Remote instruction configuration if this role fetches prompt from MCP server
    pub remote_instruction: Option<RemoteInstruction>,

    /// Optional tool-level permissions within allowed servers
    pub tool_permissions: Option<ToolPermissions>,

    /// Role metadata
    pub metadata: Option<RoleMetadata>,
}

impl Role {
    /// Create a new role with minimal configuration
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let id = id.into();
        let name = name.into();
        Self {
            id: id.clone(),
            name,
            description: String::new(),
            inherits: None,
            allowed_servers: Vec::new(),
            system_instruction: String::new(),
            remote_instruction: None,
            tool_permissions: None,
            metadata: None,
        }
    }

    /// Builder: set description
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    /// Builder: set allowed servers
    pub fn with_servers(mut self, servers: Vec<String>) -> Self {
        self.allowed_servers = servers;
        self
    }

    /// Builder: set inheritance
    pub fn inherits_from(mut self, parent: impl Into<String>) -> Self {
        self.inherits = Some(parent.into());
        self
    }

    /// Builder: set system instruction
    pub fn with_instruction(mut self, instruction: impl Into<String>) -> Self {
        self.system_instruction = instruction.into();
        self
    }

    /// Check if this role allows all servers (wildcard)
    pub fn allows_all_servers(&self) -> bool {
        self.allowed_servers.iter().any(|s| s == "*")
    }

    /// Check if this role allows a specific server
    pub fn allows_server(&self, server: &str) -> bool {
        self.allows_all_servers() || self.allowed_servers.iter().any(|s| s == server)
    }
}

/// Options for listing available roles
#[derive(Debug, Clone, Default)]
pub struct ListRolesOptions {
    /// Include inactive roles
    pub include_inactive: bool,

    /// Filter by tags
    pub tags: Vec<String>,
}

/// Summary info for a role in listings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub server_count: usize,
    pub tool_count: usize,
    pub skills: Vec<String>,
    pub is_active: bool,
    pub is_current: bool,
}

/// Result of listing roles
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRolesResult {
    /// Available roles
    pub roles: Vec<RoleSummary>,

    /// Current role ID
    pub current_role: Option<String>,

    /// Default role ID
    pub default_role: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============== Role Creation Tests ==============

    #[test]
    fn test_role_creation() {
        let role = Role::new("admin", "Administrator")
            .with_description("Full system access")
            .with_servers(vec!["*".to_string()]);

        assert_eq!(role.id, "admin");
        assert!(role.allows_all_servers());
        assert!(role.allows_server("any-server"));
    }

    #[test]
    fn test_role_server_check() {
        let role = Role::new("frontend", "Frontend Developer")
            .with_servers(vec!["filesystem".to_string(), "git".to_string()]);

        assert!(role.allows_server("filesystem"));
        assert!(role.allows_server("git"));
        assert!(!role.allows_server("database"));
    }

    #[test]
    fn test_role_new_minimal() {
        let role = Role::new("test", "Test Role");

        assert_eq!(role.id, "test");
        assert_eq!(role.name, "Test Role");
        assert!(role.description.is_empty());
        assert!(role.allowed_servers.is_empty());
        assert!(role.inherits.is_none());
    }

    #[test]
    fn test_role_builder_chain() {
        let role = Role::new("dev", "Developer")
            .with_description("Development role")
            .with_servers(vec!["server1".to_string()])
            .with_instruction("You are a developer")
            .inherits_from("base");

        assert_eq!(role.description, "Development role");
        assert!(role.allowed_servers.contains(&"server1".to_string()));
        assert_eq!(role.system_instruction, "You are a developer");
        assert_eq!(role.inherits, Some("base".to_string()));
    }

    #[test]
    fn test_role_allows_all_servers_with_wildcard() {
        let role = Role::new("admin", "Admin")
            .with_servers(vec!["specific".to_string(), "*".to_string()]);

        assert!(role.allows_all_servers());
        assert!(role.allows_server("any"));
        assert!(role.allows_server("specific"));
    }

    #[test]
    fn test_role_does_not_allow_unlisted_server() {
        let role = Role::new("limited", "Limited")
            .with_servers(vec!["only_this".to_string()]);

        assert!(!role.allows_all_servers());
        assert!(role.allows_server("only_this"));
        assert!(!role.allows_server("other"));
    }

    // ============== ToolPermissions Tests ==============

    #[test]
    fn test_tool_permissions_default() {
        let perms = ToolPermissions::default();

        assert!(perms.allow.is_empty());
        assert!(perms.deny.is_empty());
        assert!(perms.allow_patterns.is_empty());
        assert!(perms.deny_patterns.is_empty());
    }

    #[test]
    fn test_tool_permissions_custom() {
        let perms = ToolPermissions {
            allow: vec!["read_file".to_string()],
            deny: vec!["delete_file".to_string()],
            allow_patterns: vec!["read*".to_string()],
            deny_patterns: vec!["*_delete".to_string()],
        };

        assert!(perms.allow.contains(&"read_file".to_string()));
        assert!(perms.deny.contains(&"delete_file".to_string()));
    }

    // ============== RoleMetadata Tests ==============

    #[test]
    fn test_role_metadata_default() {
        let metadata = RoleMetadata::default();

        // Note: Default derive uses bool::default() which is false
        // The serde default function is only used during deserialization
        assert!(!metadata.active);
        assert!(metadata.version.is_none());
        assert!(metadata.tags.is_empty());
    }

    #[test]
    fn test_role_metadata_custom() {
        let metadata = RoleMetadata {
            version: Some("2.0.0".to_string()),
            priority: Some(10),
            tags: vec!["admin".to_string(), "core".to_string()],
            active: true,
            skills: vec!["skill1".to_string()],
            ..Default::default()
        };

        assert_eq!(metadata.version, Some("2.0.0".to_string()));
        assert_eq!(metadata.priority, Some(10));
        assert!(metadata.tags.contains(&"admin".to_string()));
    }

    // ============== RemoteInstruction Tests ==============

    #[test]
    fn test_remote_instruction_creation() {
        let remote = RemoteInstruction {
            backend: "prompt-server".to_string(),
            prompt_name: "system-prompt".to_string(),
            arguments: HashMap::new(),
            cache_ttl: 300,
            fallback: Some("Default instruction".to_string()),
        };

        assert_eq!(remote.backend, "prompt-server");
        assert_eq!(remote.prompt_name, "system-prompt");
        assert_eq!(remote.cache_ttl, 300);
    }

    #[test]
    fn test_remote_instruction_with_arguments() {
        let mut args = HashMap::new();
        args.insert("type".to_string(), "admin".to_string());
        args.insert("mode".to_string(), "safe".to_string());

        let remote = RemoteInstruction {
            backend: "server".to_string(),
            prompt_name: "prompt".to_string(),
            arguments: args,
            cache_ttl: 600,
            fallback: None,
        };

        assert_eq!(remote.arguments.get("type"), Some(&"admin".to_string()));
        assert_eq!(remote.arguments.get("mode"), Some(&"safe".to_string()));
    }

    // ============== ListRolesOptions Tests ==============

    #[test]
    fn test_list_roles_options_default() {
        let options = ListRolesOptions::default();

        assert!(!options.include_inactive);
        assert!(options.tags.is_empty());
    }

    #[test]
    fn test_list_roles_options_custom() {
        let options = ListRolesOptions {
            include_inactive: true,
            tags: vec!["admin".to_string()],
        };

        assert!(options.include_inactive);
        assert!(options.tags.contains(&"admin".to_string()));
    }

    // ============== RoleSummary Tests ==============

    #[test]
    fn test_role_summary_creation() {
        let summary = RoleSummary {
            id: "admin".to_string(),
            name: "Administrator".to_string(),
            description: "Full access".to_string(),
            server_count: 5,
            tool_count: 20,
            skills: vec!["admin-skill".to_string()],
            is_active: true,
            is_current: true,
        };

        assert_eq!(summary.id, "admin");
        assert_eq!(summary.server_count, 5);
        assert!(summary.is_current);
    }

    // ============== ListRolesResult Tests ==============

    #[test]
    fn test_list_roles_result() {
        let result = ListRolesResult {
            roles: vec![
                RoleSummary {
                    id: "admin".to_string(),
                    name: "Admin".to_string(),
                    description: "".to_string(),
                    server_count: 10,
                    tool_count: 50,
                    skills: vec![],
                    is_active: true,
                    is_current: true,
                },
                RoleSummary {
                    id: "guest".to_string(),
                    name: "Guest".to_string(),
                    description: "".to_string(),
                    server_count: 1,
                    tool_count: 5,
                    skills: vec![],
                    is_active: true,
                    is_current: false,
                },
            ],
            current_role: Some("admin".to_string()),
            default_role: "guest".to_string(),
        };

        assert_eq!(result.roles.len(), 2);
        assert_eq!(result.current_role, Some("admin".to_string()));
        assert_eq!(result.default_role, "guest");
    }

    // ============== Serialization Tests ==============

    #[test]
    fn test_role_serialization() {
        let role = Role::new("test", "Test")
            .with_description("Test role")
            .with_servers(vec!["server".to_string()]);

        let json = serde_json::to_string(&role).unwrap();
        assert!(json.contains("\"id\":\"test\""));
        assert!(json.contains("\"name\":\"Test\""));
    }

    #[test]
    fn test_role_deserialization() {
        let json = r#"{
            "id": "admin",
            "name": "Administrator",
            "description": "Full access",
            "allowedServers": ["*"],
            "systemInstruction": "You are an admin"
        }"#;

        let role: Role = serde_json::from_str(json).unwrap();
        assert_eq!(role.id, "admin");
        assert!(role.allows_all_servers());
    }

    #[test]
    fn test_tool_permissions_serialization() {
        let perms = ToolPermissions {
            allow: vec!["tool1".to_string()],
            deny: vec!["tool2".to_string()],
            allow_patterns: vec!["read*".to_string()],
            deny_patterns: vec![],
        };

        let json = serde_json::to_string(&perms).unwrap();
        assert!(json.contains("tool1"));
        assert!(json.contains("tool2"));
    }

    #[test]
    fn test_role_summary_serialization() {
        let summary = RoleSummary {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            server_count: 1,
            tool_count: 2,
            skills: vec![],
            is_active: true,
            is_current: false,
        };

        let json = serde_json::to_string(&summary).unwrap();
        assert!(json.contains("\"serverCount\":1"));
        assert!(json.contains("\"toolCount\":2"));
    }

    // ============== Edge Cases ==============

    #[test]
    fn test_role_empty_allowed_servers() {
        let role = Role::new("empty", "Empty");

        assert!(!role.allows_all_servers());
        assert!(!role.allows_server("any"));
    }

    #[test]
    fn test_role_with_special_characters_in_id() {
        let role = Role::new("role-with-dashes", "Role With Dashes");
        assert_eq!(role.id, "role-with-dashes");
    }

    #[test]
    fn test_role_with_unicode_name() {
        let role = Role::new("japanese", "日本語ロール");
        assert_eq!(role.name, "日本語ロール");
    }
}
