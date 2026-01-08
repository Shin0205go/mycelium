//! ToolVisibilityManager - Tool filtering by role

use shared::{Role, ToolInfo, ToolNotAccessibleError, tool::system_tools};
use std::collections::HashMap;

/// Manages tool discovery and role-based visibility
#[derive(Debug)]
pub struct ToolVisibilityManager {
    /// All registered tools (prefixed_name -> ToolInfo)
    tools: HashMap<String, ToolInfo>,
    /// Current role
    current_role: Option<Role>,
}

impl ToolVisibilityManager {
    /// Create a new ToolVisibilityManager
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            current_role: None,
        }
    }

    /// Register a tool from a backend server
    pub fn register_tool(&mut self, tool_info: ToolInfo) {
        self.tools.insert(tool_info.prefixed_name.clone(), tool_info);
        self.update_visibility();
    }

    /// Register multiple tools
    pub fn register_tools(&mut self, tools: impl IntoIterator<Item = ToolInfo>) {
        for tool in tools {
            self.tools.insert(tool.prefixed_name.clone(), tool);
        }
        self.update_visibility();
    }

    /// Set the current role
    pub fn set_current_role(&mut self, role: Role) {
        self.current_role = Some(role);
        self.update_visibility();
    }

    /// Clear the current role
    pub fn clear_current_role(&mut self) {
        self.current_role = None;
        self.update_visibility();
    }

    /// Get the current role
    pub fn current_role(&self) -> Option<&Role> {
        self.current_role.as_ref()
    }

    /// Update tool visibility based on current role
    fn update_visibility(&mut self) {
        let role = match &self.current_role {
            Some(r) => r,
            None => {
                // No role - hide all tools
                for tool in self.tools.values_mut() {
                    tool.hide("No role selected");
                }
                return;
            }
        };

        for tool in self.tools.values_mut() {
            // Check server access
            if !role.allows_server(&tool.source_server) {
                tool.hide(format!("Server '{}' not allowed for role '{}'", tool.source_server, role.id));
                continue;
            }

            // Check tool-level permissions
            if let Some(perms) = &role.tool_permissions {
                // Deny takes precedence
                if perms.deny.contains(&tool.prefixed_name) || perms.deny.contains(&tool.tool.name) {
                    tool.hide("Explicitly denied");
                    continue;
                }

                // Check deny patterns
                let denied_by_pattern = perms.deny_patterns.iter().any(|p| {
                    glob_match(p, &tool.prefixed_name) || glob_match(p, &tool.tool.name)
                });
                if denied_by_pattern {
                    tool.hide("Denied by pattern");
                    continue;
                }

                // Check if explicitly allowed or matches allow pattern
                let explicitly_allowed = perms.allow.contains(&tool.prefixed_name)
                    || perms.allow.contains(&tool.tool.name);

                let allowed_by_pattern = perms.allow_patterns.iter().any(|p| {
                    glob_match(p, &tool.prefixed_name) || glob_match(p, &tool.tool.name)
                });

                // If allow list is non-empty, tool must be in it
                if !perms.allow.is_empty() || !perms.allow_patterns.is_empty() {
                    if explicitly_allowed || allowed_by_pattern {
                        tool.show("Allowed by permission");
                    } else {
                        tool.hide("Not in allow list");
                    }
                } else {
                    // No allow list - server access implies tool access
                    tool.show("Server access granted");
                }
            } else {
                // No tool permissions - server access implies tool access
                tool.show("Server access granted");
            }
        }
    }

    /// Check if a tool is visible
    pub fn is_visible(&self, prefixed_name: &str) -> bool {
        // System tools are always visible
        if system_tools::is_system_tool(prefixed_name) {
            return true;
        }

        self.tools
            .get(prefixed_name)
            .map(|t| t.visible)
            .unwrap_or(false)
    }

    /// Check access and throw error if not accessible
    pub fn check_access(&self, prefixed_name: &str) -> Result<(), ToolNotAccessibleError> {
        // System tools are always accessible
        if system_tools::is_system_tool(prefixed_name) {
            return Ok(());
        }

        let tool = self.tools.get(prefixed_name);
        let role_id = self.current_role.as_ref().map(|r| r.id.as_str()).unwrap_or("none");

        match tool {
            Some(t) if t.visible => Ok(()),
            Some(t) => Err(ToolNotAccessibleError {
                tool_name: prefixed_name.to_string(),
                current_role: role_id.to_string(),
                reason: t.visibility_reason.clone().unwrap_or_else(|| "Hidden".to_string()),
            }),
            None => Err(ToolNotAccessibleError {
                tool_name: prefixed_name.to_string(),
                current_role: role_id.to_string(),
                reason: "Tool not registered".to_string(),
            }),
        }
    }

    /// Get all visible tools
    pub fn get_visible_tools(&self) -> Vec<&ToolInfo> {
        self.tools.values().filter(|t| t.visible).collect()
    }

    /// Get all tools (visible and hidden)
    pub fn get_all_tools(&self) -> Vec<&ToolInfo> {
        self.tools.values().collect()
    }
}

impl Default for ToolVisibilityManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Simple glob matching (supports * and ?)
fn glob_match(pattern: &str, text: &str) -> bool {
    let regex_pattern = pattern
        .replace('.', r"\.")
        .replace('*', ".*")
        .replace('?', ".");

    regex::Regex::new(&format!("^{}$", regex_pattern))
        .map(|r| r.is_match(text))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared::{Tool, ToolPermissions};

    #[test]
    fn test_tool_visibility() {
        let mut manager = ToolVisibilityManager::new();

        // Register tools
        let tool = Tool::new("read_file");
        let info = ToolInfo::new(tool, "filesystem");
        manager.register_tool(info);

        // No role - tool should be hidden
        assert!(!manager.is_visible("filesystem__read_file"));

        // Set role with access
        let role = Role::new("dev", "Developer")
            .with_servers(vec!["filesystem".to_string()]);
        manager.set_current_role(role);

        assert!(manager.is_visible("filesystem__read_file"));
    }

    #[test]
    fn test_system_tools_always_visible() {
        let manager = ToolVisibilityManager::new();

        // System tools should be visible even without a role
        assert!(manager.is_visible("set_role"));
        assert!(manager.is_visible("list_roles"));
    }

    #[test]
    fn test_tool_deny() {
        let mut manager = ToolVisibilityManager::new();

        let tool = Tool::new("delete_file");
        let info = ToolInfo::new(tool, "filesystem");
        manager.register_tool(info);

        let role = Role {
            id: "reader".to_string(),
            name: "Reader".to_string(),
            description: String::new(),
            inherits: None,
            allowed_servers: vec!["filesystem".to_string()],
            system_instruction: String::new(),
            remote_instruction: None,
            tool_permissions: Some(ToolPermissions {
                allow: vec![],
                deny: vec!["filesystem__delete_file".to_string()],
                allow_patterns: vec![],
                deny_patterns: vec![],
            }),
            metadata: None,
        };

        manager.set_current_role(role);
        assert!(!manager.is_visible("filesystem__delete_file"));
    }

    #[test]
    fn test_check_access_throws_for_hidden_tool() {
        let mut manager = ToolVisibilityManager::new();

        let tool = Tool::new("dangerous_tool");
        let info = ToolInfo::new(tool, "admin");
        manager.register_tool(info);

        let role = Role::new("guest", "Guest")
            .with_servers(vec!["filesystem".to_string()]);
        manager.set_current_role(role);

        let result = manager.check_access("admin__dangerous_tool");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.tool_name.contains("dangerous_tool"));
        assert!(err.current_role == "guest");
    }

    #[test]
    fn test_check_access_ok_for_visible_tool() {
        let mut manager = ToolVisibilityManager::new();

        let tool = Tool::new("read_file");
        let info = ToolInfo::new(tool, "filesystem");
        manager.register_tool(info);

        let role = Role::new("reader", "Reader")
            .with_servers(vec!["filesystem".to_string()]);
        manager.set_current_role(role);

        assert!(manager.check_access("filesystem__read_file").is_ok());
    }

    #[test]
    fn test_register_multiple_tools() {
        let mut manager = ToolVisibilityManager::new();

        let tools = vec![
            ToolInfo::new(Tool::new("read_file"), "filesystem"),
            ToolInfo::new(Tool::new("write_file"), "filesystem"),
            ToolInfo::new(Tool::new("query"), "database"),
        ];

        manager.register_tools(tools);

        let role = Role::new("admin", "Admin")
            .with_servers(vec!["*".to_string()]);
        manager.set_current_role(role);

        assert!(manager.is_visible("filesystem__read_file"));
        assert!(manager.is_visible("filesystem__write_file"));
        assert!(manager.is_visible("database__query"));
    }

    #[test]
    fn test_clear_current_role_hides_tools() {
        let mut manager = ToolVisibilityManager::new();

        let tool = Tool::new("read_file");
        let info = ToolInfo::new(tool, "filesystem");
        manager.register_tool(info);

        let role = Role::new("user", "User")
            .with_servers(vec!["filesystem".to_string()]);
        manager.set_current_role(role);
        assert!(manager.is_visible("filesystem__read_file"));

        manager.clear_current_role();
        assert!(!manager.is_visible("filesystem__read_file"));
    }

    #[test]
    fn test_get_visible_tools() {
        let mut manager = ToolVisibilityManager::new();

        manager.register_tools(vec![
            ToolInfo::new(Tool::new("read_file"), "filesystem"),
            ToolInfo::new(Tool::new("write_file"), "filesystem"),
            ToolInfo::new(Tool::new("query"), "database"),
        ]);

        let role = Role::new("fs_user", "FS User")
            .with_servers(vec!["filesystem".to_string()]);
        manager.set_current_role(role);

        let visible = manager.get_visible_tools();
        assert_eq!(visible.len(), 2);
    }

    #[test]
    fn test_get_all_tools() {
        let mut manager = ToolVisibilityManager::new();

        manager.register_tools(vec![
            ToolInfo::new(Tool::new("read_file"), "filesystem"),
            ToolInfo::new(Tool::new("query"), "database"),
        ]);

        let all = manager.get_all_tools();
        assert_eq!(all.len(), 2);
    }

    // Red Team Security Tests
    mod red_team {
        use super::*;

        fn create_dangerous_tools() -> Vec<ToolInfo> {
            vec![
                ToolInfo::new(Tool::new("delete_database"), "database"),
                ToolInfo::new(Tool::new("drop_table"), "database"),
                ToolInfo::new(Tool::new("run_command"), "execution"),
                ToolInfo::new(Tool::new("sudo"), "execution"),
                ToolInfo::new(Tool::new("delete_file"), "filesystem"),
                ToolInfo::new(Tool::new("rm_rf"), "filesystem"),
                ToolInfo::new(Tool::new("shutdown"), "system"),
            ]
        }

        fn create_safe_tools() -> Vec<ToolInfo> {
            vec![
                ToolInfo::new(Tool::new("read_file"), "filesystem"),
                ToolInfo::new(Tool::new("list_directory"), "filesystem"),
                ToolInfo::new(Tool::new("query"), "database"),
            ]
        }

        #[test]
        fn red_team_guest_cannot_access_dangerous_tools() {
            let mut manager = ToolVisibilityManager::new();
            manager.register_tools(create_dangerous_tools());
            manager.register_tools(create_safe_tools());

            let guest_role = Role::new("guest", "Guest")
                .with_servers(vec!["filesystem".to_string()]);
            manager.set_current_role(guest_role);

            // Guest should only see filesystem read tools
            assert!(!manager.is_visible("database__delete_database"));
            assert!(!manager.is_visible("database__drop_table"));
            assert!(!manager.is_visible("execution__run_command"));
            assert!(!manager.is_visible("execution__sudo"));
            assert!(!manager.is_visible("system__shutdown"));

            // But can see safe filesystem tools
            assert!(manager.is_visible("filesystem__read_file"));
            assert!(manager.is_visible("filesystem__list_directory"));
        }

        #[test]
        fn red_team_check_access_throws_for_unauthorized() {
            let mut manager = ToolVisibilityManager::new();
            manager.register_tools(create_dangerous_tools());

            let guest_role = Role::new("guest", "Guest")
                .with_servers(vec!["filesystem".to_string()]);
            manager.set_current_role(guest_role);

            let result = manager.check_access("database__delete_database");
            assert!(result.is_err());
            let err = result.unwrap_err();
            assert!(err.reason.contains("guest") || err.current_role == "guest");
        }

        #[test]
        fn red_team_role_switch_removes_access() {
            let mut manager = ToolVisibilityManager::new();
            manager.register_tools(create_dangerous_tools());
            manager.register_tools(create_safe_tools());

            // Start as admin with full access
            let admin_role = Role::new("admin", "Admin")
                .with_servers(vec!["*".to_string()]);
            manager.set_current_role(admin_role);
            assert!(manager.is_visible("database__delete_database"));

            // Downgrade to guest
            let guest_role = Role::new("guest", "Guest")
                .with_servers(vec!["filesystem".to_string()]);
            manager.set_current_role(guest_role);

            // Should no longer have access to dangerous tools
            assert!(!manager.is_visible("database__delete_database"));
            assert!(!manager.is_visible("execution__run_command"));
        }

        #[test]
        fn red_team_pattern_matching_exploit_prevention() {
            let mut manager = ToolVisibilityManager::new();

            // Register tools with attack patterns in names
            manager.register_tools(vec![
                ToolInfo::new(Tool::new("read_file"), "filesystem"),
                ToolInfo::new(Tool::new("read_file_and_delete"), "filesystem"),
                ToolInfo::new(Tool::new("read_file__evil"), "filesystem"),
            ]);

            // Role only allows read_file
            let role = Role {
                id: "reader".to_string(),
                name: "Reader".to_string(),
                description: String::new(),
                inherits: None,
                allowed_servers: vec!["filesystem".to_string()],
                system_instruction: String::new(),
                remote_instruction: None,
                tool_permissions: Some(ToolPermissions {
                    allow: vec!["filesystem__read_file".to_string()],
                    deny: vec![],
                    allow_patterns: vec![],
                    deny_patterns: vec![],
                }),
                metadata: None,
            };
            manager.set_current_role(role);

            // Exact match should work
            assert!(manager.is_visible("filesystem__read_file"));

            // Suffix injection should be blocked
            assert!(!manager.is_visible("filesystem__read_file_and_delete"));

            // Nested attack should be blocked
            assert!(!manager.is_visible("filesystem__read_file__evil"));
        }

        #[test]
        fn red_team_server_access_bypass_prevention() {
            let mut manager = ToolVisibilityManager::new();
            manager.register_tools(vec![
                ToolInfo::new(Tool::new("read_file"), "filesystem"),
                ToolInfo::new(Tool::new("query"), "database"),
            ]);

            // Role only has filesystem access
            let role = Role::new("fs_user", "FS User")
                .with_servers(vec!["filesystem".to_string()]);
            manager.set_current_role(role);

            // Should not be able to access database tools
            assert!(!manager.is_visible("database__query"));
            assert!(manager.check_access("database__query").is_err());
        }

        #[test]
        fn red_team_session_isolation() {
            // Create two separate managers (simulating sessions)
            let mut manager1 = ToolVisibilityManager::new();
            let mut manager2 = ToolVisibilityManager::new();

            let tools = create_safe_tools();
            manager1.register_tools(tools.clone());
            manager2.register_tools(tools);

            // Set different roles
            let admin = Role::new("admin", "Admin")
                .with_servers(vec!["*".to_string()]);
            let guest = Role::new("guest", "Guest")
                .with_servers(vec!["filesystem".to_string()]);

            manager1.set_current_role(admin);
            manager2.set_current_role(guest);

            // Admin can see database tools
            assert!(manager1.is_visible("database__query"));
            // Guest cannot
            assert!(!manager2.is_visible("database__query"));

            // Switching one doesn't affect the other
            manager1.set_current_role(Role::new("guest", "Guest")
                .with_servers(vec!["filesystem".to_string()]));
            assert!(!manager1.is_visible("database__query"));
            // manager2 is still guest (independent)
            assert!(!manager2.is_visible("database__query"));
        }

        #[test]
        fn red_team_deny_takes_precedence() {
            let mut manager = ToolVisibilityManager::new();
            manager.register_tools(vec![
                ToolInfo::new(Tool::new("read_file"), "filesystem"),
                ToolInfo::new(Tool::new("delete_file"), "filesystem"),
            ]);

            // Role has server access but explicit deny on delete
            let role = Role {
                id: "safe_user".to_string(),
                name: "Safe User".to_string(),
                description: String::new(),
                inherits: None,
                allowed_servers: vec!["filesystem".to_string()],
                system_instruction: String::new(),
                remote_instruction: None,
                tool_permissions: Some(ToolPermissions {
                    allow: vec![],
                    deny: vec!["filesystem__delete_file".to_string()],
                    allow_patterns: vec![],
                    deny_patterns: vec![],
                }),
                metadata: None,
            };
            manager.set_current_role(role);

            assert!(manager.is_visible("filesystem__read_file"));
            assert!(!manager.is_visible("filesystem__delete_file"));
        }
    }
}
