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
}
