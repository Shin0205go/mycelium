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
}
