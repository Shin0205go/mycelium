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

    #[test]
    fn test_role_with_empty_id() {
        let role = Role::new("", "Empty ID");
        assert_eq!(role.id, "");
    }

    #[test]
    fn test_role_with_very_long_id() {
        let long_id = "a".repeat(10000);
        let role = Role::new(long_id.clone(), "Long");
        assert_eq!(role.id, long_id);
    }

    #[test]
    fn test_role_with_emoji_in_name() {
        let role = Role::new("admin", "👑 Admin 👑");
        assert_eq!(role.name, "👑 Admin 👑");
    }

    #[test]
    fn test_role_with_whitespace_in_id() {
        let role = Role::new("   ", "Whitespace");
        assert_eq!(role.id, "   ");
    }

    #[test]
    fn test_role_with_newline_in_description() {
        let role = Role::new("test", "Test")
            .with_description("Line 1\nLine 2\nLine 3");
        assert!(role.description.contains('\n'));
    }

    #[test]
    fn test_role_clone() {
        let role = Role::new("admin", "Admin")
            .with_description("Test")
            .with_servers(vec!["server".to_string()])
            .inherits_from("base");

        let cloned = role.clone();
        assert_eq!(cloned.id, role.id);
        assert_eq!(cloned.name, role.name);
        assert_eq!(cloned.inherits, role.inherits);
    }

    #[test]
    fn test_role_debug_trait() {
        let role = Role::new("test", "Test");
        let debug = format!("{:?}", role);
        assert!(debug.contains("Role"));
        assert!(debug.contains("test"));
    }

    #[test]
    fn test_tool_permissions_clone() {
        let perms = ToolPermissions {
            allow: vec!["tool".to_string()],
            deny: vec!["other".to_string()],
            allow_patterns: vec!["pattern*".to_string()],
            deny_patterns: vec![],
        };

        let cloned = perms.clone();
        assert_eq!(cloned.allow, perms.allow);
        assert_eq!(cloned.deny, perms.deny);
    }

    #[test]
    fn test_tool_permissions_debug() {
        let perms = ToolPermissions::default();
        let debug = format!("{:?}", perms);
        assert!(debug.contains("ToolPermissions"));
    }

    #[test]
    fn test_role_metadata_clone() {
        let metadata = RoleMetadata {
            version: Some("1.0".to_string()),
            active: true,
            priority: Some(5),
            ..Default::default()
        };

        let cloned = metadata.clone();
        assert_eq!(cloned.version, metadata.version);
        assert_eq!(cloned.active, metadata.active);
    }

    #[test]
    fn test_role_metadata_debug() {
        let metadata = RoleMetadata::default();
        let debug = format!("{:?}", metadata);
        assert!(debug.contains("RoleMetadata"));
    }

    #[test]
    fn test_remote_instruction_clone() {
        let remote = RemoteInstruction {
            backend: "backend".to_string(),
            prompt_name: "prompt".to_string(),
            arguments: HashMap::new(),
            cache_ttl: 100,
            fallback: Some("fallback".to_string()),
        };

        let cloned = remote.clone();
        assert_eq!(cloned.backend, remote.backend);
        assert_eq!(cloned.cache_ttl, remote.cache_ttl);
    }

    #[test]
    fn test_remote_instruction_debug() {
        let remote = RemoteInstruction {
            backend: "test".to_string(),
            prompt_name: "test".to_string(),
            arguments: HashMap::new(),
            cache_ttl: 0,
            fallback: None,
        };
        let debug = format!("{:?}", remote);
        assert!(debug.contains("RemoteInstruction"));
    }

    #[test]
    fn test_list_roles_options_debug() {
        let options = ListRolesOptions::default();
        let debug = format!("{:?}", options);
        assert!(debug.contains("ListRolesOptions"));
    }

    #[test]
    fn test_list_roles_options_clone() {
        let options = ListRolesOptions {
            include_inactive: true,
            tags: vec!["tag".to_string()],
        };
        let cloned = options.clone();
        assert_eq!(cloned.include_inactive, options.include_inactive);
    }

    #[test]
    fn test_role_summary_debug() {
        let summary = RoleSummary {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: "".to_string(),
            server_count: 0,
            tool_count: 0,
            skills: vec![],
            is_active: true,
            is_current: false,
        };
        let debug = format!("{:?}", summary);
        assert!(debug.contains("RoleSummary"));
    }

    #[test]
    fn test_role_summary_clone() {
        let summary = RoleSummary {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: "Desc".to_string(),
            server_count: 5,
            tool_count: 10,
            skills: vec!["skill".to_string()],
            is_active: true,
            is_current: true,
        };
        let cloned = summary.clone();
        assert_eq!(cloned.id, summary.id);
        assert_eq!(cloned.server_count, summary.server_count);
    }

    #[test]
    fn test_list_roles_result_debug() {
        let result = ListRolesResult {
            roles: vec![],
            current_role: None,
            default_role: "guest".to_string(),
        };
        let debug = format!("{:?}", result);
        assert!(debug.contains("ListRolesResult"));
    }

    #[test]
    fn test_list_roles_result_clone() {
        let result = ListRolesResult {
            roles: vec![],
            current_role: Some("admin".to_string()),
            default_role: "guest".to_string(),
        };
        let cloned = result.clone();
        assert_eq!(cloned.current_role, result.current_role);
    }

    #[test]
    fn test_role_allows_server_case_sensitive() {
        let role = Role::new("test", "Test")
            .with_servers(vec!["FileSystem".to_string()]);

        assert!(role.allows_server("FileSystem"));
        assert!(!role.allows_server("filesystem"));
        assert!(!role.allows_server("FILESYSTEM"));
    }

    #[test]
    fn test_role_allows_server_multiple_wildcards() {
        let role = Role::new("admin", "Admin")
            .with_servers(vec!["*".to_string(), "*".to_string()]);

        assert!(role.allows_all_servers());
    }

    #[test]
    fn test_role_deserialization_with_optional_fields() {
        let json = r#"{
            "id": "minimal",
            "name": "Minimal",
            "description": ""
        }"#;

        let role: Role = serde_json::from_str(json).unwrap();
        assert_eq!(role.id, "minimal");
        assert!(role.allowed_servers.is_empty());
        assert!(role.inherits.is_none());
        assert!(role.tool_permissions.is_none());
    }

    #[test]
    fn test_role_serialization_roundtrip() {
        let role = Role::new("test", "Test")
            .with_description("Description")
            .with_servers(vec!["server1".to_string(), "server2".to_string()])
            .with_instruction("Instruction")
            .inherits_from("parent");

        let json = serde_json::to_string(&role).unwrap();
        let parsed: Role = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, role.id);
        assert_eq!(parsed.name, role.name);
        assert_eq!(parsed.description, role.description);
        assert_eq!(parsed.allowed_servers, role.allowed_servers);
        assert_eq!(parsed.inherits, role.inherits);
    }

    #[test]
    fn test_remote_instruction_serialization_roundtrip() {
        let mut args = HashMap::new();
        args.insert("key".to_string(), "value".to_string());

        let remote = RemoteInstruction {
            backend: "server".to_string(),
            prompt_name: "prompt".to_string(),
            arguments: args,
            cache_ttl: 500,
            fallback: Some("fallback".to_string()),
        };

        let json = serde_json::to_string(&remote).unwrap();
        let parsed: RemoteInstruction = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.backend, remote.backend);
        assert_eq!(parsed.arguments.get("key"), Some(&"value".to_string()));
    }

    #[test]
    fn test_role_metadata_serialization_roundtrip() {
        let metadata = RoleMetadata {
            version: Some("1.0.0".to_string()),
            created_at: Some("2024-01-01".to_string()),
            created_by: Some("admin".to_string()),
            last_modified: Some("2024-01-02".to_string()),
            priority: Some(10),
            tags: vec!["admin".to_string(), "core".to_string()],
            active: true,
            skills: vec!["skill1".to_string()],
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let parsed: RoleMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.version, metadata.version);
        assert_eq!(parsed.priority, metadata.priority);
        assert_eq!(parsed.tags, metadata.tags);
    }

    #[test]
    fn test_list_roles_result_serialization_roundtrip() {
        let result = ListRolesResult {
            roles: vec![RoleSummary {
                id: "admin".to_string(),
                name: "Admin".to_string(),
                description: "Full access".to_string(),
                server_count: 5,
                tool_count: 20,
                skills: vec!["admin-skill".to_string()],
                is_active: true,
                is_current: true,
            }],
            current_role: Some("admin".to_string()),
            default_role: "guest".to_string(),
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: ListRolesResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.roles.len(), 1);
        assert_eq!(parsed.current_role, result.current_role);
    }

    // ============== Additional Role Tests ==============

    mod additional_role_tests {
        use super::*;

        #[test]
        fn test_role_with_remote_instruction() {
            let role = Role {
                id: "test".to_string(),
                name: "Test".to_string(),
                description: "Test role".to_string(),
                inherits: None,
                allowed_servers: vec!["server".to_string()],
                system_instruction: String::new(),
                remote_instruction: Some(RemoteInstruction {
                    backend: "backend".to_string(),
                    prompt_name: "prompt".to_string(),
                    arguments: HashMap::new(),
                    cache_ttl: 300,
                    fallback: None,
                }),
                tool_permissions: None,
                metadata: None,
            };

            assert!(role.remote_instruction.is_some());
            assert_eq!(role.remote_instruction.as_ref().unwrap().backend, "backend");
        }

        #[test]
        fn test_role_with_metadata() {
            let role = Role {
                id: "meta".to_string(),
                name: "Meta".to_string(),
                description: "".to_string(),
                inherits: None,
                allowed_servers: vec![],
                system_instruction: String::new(),
                remote_instruction: None,
                tool_permissions: None,
                metadata: Some(RoleMetadata {
                    version: Some("2.0".to_string()),
                    priority: Some(100),
                    active: true,
                    ..Default::default()
                }),
            };

            assert!(role.metadata.is_some());
            assert_eq!(role.metadata.as_ref().unwrap().priority, Some(100));
        }

        #[test]
        fn test_role_many_servers() {
            let servers: Vec<String> = (0..100).map(|i| format!("server_{}", i)).collect();
            let role = Role::new("multi", "Multi").with_servers(servers.clone());

            assert_eq!(role.allowed_servers.len(), 100);
            assert!(role.allows_server("server_50"));
            assert!(!role.allows_server("server_999"));
        }

        #[test]
        fn test_role_server_empty_string() {
            let role = Role::new("test", "Test")
                .with_servers(vec!["".to_string(), "valid".to_string()]);

            assert!(role.allows_server(""));
            assert!(role.allows_server("valid"));
        }

        #[test]
        fn test_role_deserialization_with_all_fields() {
            let json = r#"{
                "id": "full",
                "name": "Full Role",
                "description": "A complete role",
                "inherits": "base",
                "allowedServers": ["server1", "server2"],
                "systemInstruction": "Be helpful",
                "toolPermissions": {
                    "allow": ["read"],
                    "deny": ["delete"],
                    "allowPatterns": ["read_*"],
                    "denyPatterns": ["*_delete"]
                },
                "metadata": {
                    "version": "1.0",
                    "active": true,
                    "priority": 10
                }
            }"#;

            let role: Role = serde_json::from_str(json).unwrap();
            assert_eq!(role.id, "full");
            assert_eq!(role.inherits, Some("base".to_string()));
            assert!(role.tool_permissions.is_some());
            assert!(role.metadata.is_some());
        }

        #[test]
        fn test_role_summary_many_skills() {
            let skills: Vec<String> = (0..50).map(|i| format!("skill_{}", i)).collect();
            let summary = RoleSummary {
                id: "test".to_string(),
                name: "Test".to_string(),
                description: "".to_string(),
                server_count: 10,
                tool_count: 100,
                skills,
                is_active: true,
                is_current: false,
            };

            assert_eq!(summary.skills.len(), 50);
        }

        #[test]
        fn test_list_roles_result_many_roles() {
            let roles: Vec<RoleSummary> = (0..100).map(|i| RoleSummary {
                id: format!("role_{}", i),
                name: format!("Role {}", i),
                description: "".to_string(),
                server_count: i,
                tool_count: i * 2,
                skills: vec![],
                is_active: i % 2 == 0,
                is_current: i == 0,
            }).collect();

            let result = ListRolesResult {
                roles,
                current_role: Some("role_0".to_string()),
                default_role: "role_1".to_string(),
            };

            assert_eq!(result.roles.len(), 100);
        }

        #[test]
        fn test_tool_permissions_many_patterns() {
            let perms = ToolPermissions {
                allow: (0..50).map(|i| format!("allow_{}", i)).collect(),
                deny: (0..50).map(|i| format!("deny_{}", i)).collect(),
                allow_patterns: (0..50).map(|i| format!("allow_*_{}", i)).collect(),
                deny_patterns: (0..50).map(|i| format!("deny_*_{}", i)).collect(),
            };

            assert_eq!(perms.allow.len(), 50);
            assert_eq!(perms.deny.len(), 50);
            assert_eq!(perms.allow_patterns.len(), 50);
            assert_eq!(perms.deny_patterns.len(), 50);
        }

        #[test]
        fn test_role_metadata_all_fields() {
            let metadata = RoleMetadata {
                version: Some("3.0.0".to_string()),
                created_at: Some("2024-01-01T00:00:00Z".to_string()),
                created_by: Some("admin@example.com".to_string()),
                last_modified: Some("2024-06-01T12:00:00Z".to_string()),
                priority: Some(999),
                tags: vec!["admin".to_string(), "security".to_string(), "core".to_string()],
                active: true,
                skills: vec!["skill1".to_string(), "skill2".to_string()],
            };

            assert_eq!(metadata.version, Some("3.0.0".to_string()));
            assert_eq!(metadata.priority, Some(999));
            assert_eq!(metadata.tags.len(), 3);
            assert_eq!(metadata.skills.len(), 2);
        }

        #[test]
        fn test_remote_instruction_with_many_arguments() {
            let mut args = HashMap::new();
            for i in 0..50 {
                args.insert(format!("arg_{}", i), format!("value_{}", i));
            }

            let remote = RemoteInstruction {
                backend: "server".to_string(),
                prompt_name: "prompt".to_string(),
                arguments: args,
                cache_ttl: 1000,
                fallback: Some("fallback".to_string()),
            };

            assert_eq!(remote.arguments.len(), 50);
        }

        #[test]
        fn test_role_with_null_byte_in_name() {
            let role = Role::new("test", "Test\x00Role");
            assert_eq!(role.name, "Test\x00Role");
        }

        #[test]
        fn test_role_server_prefix_matching() {
            let role = Role::new("test", "Test")
                .with_servers(vec!["fs".to_string(), "db".to_string()]);

            // Should not match substrings
            assert!(!role.allows_server("filesystem"));
            assert!(!role.allows_server("database"));
            assert!(role.allows_server("fs"));
            assert!(role.allows_server("db"));
        }

        #[test]
        fn test_list_roles_options_with_many_tags() {
            let options = ListRolesOptions {
                include_inactive: true,
                tags: (0..100).map(|i| format!("tag_{}", i)).collect(),
            };

            assert_eq!(options.tags.len(), 100);
        }

        #[test]
        fn test_role_inherits_from_chained() {
            let role = Role::new("child", "Child")
                .inherits_from("parent")
                .with_servers(vec!["server".to_string()])
                .with_description("A child role")
                .with_instruction("Be good");

            assert_eq!(role.inherits, Some("parent".to_string()));
            assert_eq!(role.allowed_servers, vec!["server".to_string()]);
            assert_eq!(role.description, "A child role");
            assert_eq!(role.system_instruction, "Be good");
        }

        #[test]
        fn test_role_summary_zero_counts() {
            let summary = RoleSummary {
                id: "empty".to_string(),
                name: "Empty".to_string(),
                description: "".to_string(),
                server_count: 0,
                tool_count: 0,
                skills: vec![],
                is_active: false,
                is_current: false,
            };

            assert_eq!(summary.server_count, 0);
            assert_eq!(summary.tool_count, 0);
        }

        #[test]
        fn test_role_summary_max_counts() {
            let summary = RoleSummary {
                id: "max".to_string(),
                name: "Max".to_string(),
                description: "".to_string(),
                server_count: usize::MAX,
                tool_count: usize::MAX,
                skills: vec![],
                is_active: true,
                is_current: true,
            };

            assert_eq!(summary.server_count, usize::MAX);
            assert_eq!(summary.tool_count, usize::MAX);
        }

        #[test]
        fn test_list_roles_result_no_current_role() {
            let result = ListRolesResult {
                roles: vec![],
                current_role: None,
                default_role: "guest".to_string(),
            };

            assert!(result.current_role.is_none());
        }

        #[test]
        fn test_role_metadata_negative_priority() {
            let metadata = RoleMetadata {
                priority: Some(-100),
                ..Default::default()
            };

            assert_eq!(metadata.priority, Some(-100));
        }

        #[test]
        fn test_remote_instruction_zero_ttl() {
            let remote = RemoteInstruction {
                backend: "server".to_string(),
                prompt_name: "prompt".to_string(),
                arguments: HashMap::new(),
                cache_ttl: 0,
                fallback: None,
            };

            assert_eq!(remote.cache_ttl, 0);
        }

        #[test]
        fn test_remote_instruction_max_ttl() {
            let remote = RemoteInstruction {
                backend: "server".to_string(),
                prompt_name: "prompt".to_string(),
                arguments: HashMap::new(),
                cache_ttl: u64::MAX,
                fallback: None,
            };

            assert_eq!(remote.cache_ttl, u64::MAX);
        }
    }
}
