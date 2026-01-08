//! RoleManager - Role definitions and permission checking

use shared::{Role, SkillDefinition, SkillManifest, ToolPermissions, MemoryPolicy};
use std::collections::HashMap;

/// RoleManager handles role definitions and permission checking
#[derive(Debug)]
pub struct RoleManager {
    /// All registered roles
    roles: HashMap<String, Role>,
    /// Default role ID
    default_role: String,
    /// Skill definitions (for dynamic role generation)
    skills: Vec<SkillDefinition>,
}

impl RoleManager {
    /// Create a new RoleManager
    pub fn new() -> Self {
        Self {
            roles: HashMap::new(),
            default_role: "guest".to_string(),
            skills: Vec::new(),
        }
    }

    /// Register a role
    pub fn register_role(&mut self, role: Role) {
        self.roles.insert(role.id.clone(), role);
    }

    /// Get a role by ID
    pub fn get_role(&self, id: &str) -> Option<&Role> {
        self.roles.get(id)
    }

    /// Get all role IDs
    pub fn get_role_ids(&self) -> Vec<&str> {
        self.roles.keys().map(|s| s.as_str()).collect()
    }

    /// Set the default role
    pub fn set_default_role(&mut self, role_id: impl Into<String>) {
        self.default_role = role_id.into();
    }

    /// Get the default role ID
    pub fn default_role(&self) -> &str {
        &self.default_role
    }

    /// Load roles dynamically from skill manifest
    pub fn load_from_skill_manifest(&mut self, manifest: &SkillManifest) {
        self.skills = manifest.skills.clone();

        // Generate roles from skills (inverted RBAC)
        let mut role_tools: HashMap<String, Vec<String>> = HashMap::new();
        let mut role_skills: HashMap<String, Vec<String>> = HashMap::new();

        for skill in &manifest.skills {
            for role_id in &skill.allowed_roles {
                if role_id == "*" {
                    continue;
                }

                role_tools
                    .entry(role_id.clone())
                    .or_default()
                    .extend(skill.allowed_tools.clone());

                role_skills
                    .entry(role_id.clone())
                    .or_default()
                    .push(skill.id.clone());
            }
        }

        // Create roles from aggregated data
        for (role_id, tools) in role_tools {
            let skills = role_skills.get(&role_id).cloned().unwrap_or_default();

            let role = Role {
                id: role_id.clone(),
                name: role_id.clone(),
                description: format!("Auto-generated role from skills: {}", skills.join(", ")),
                inherits: None,
                allowed_servers: vec!["*".to_string()], // Will be filtered by tools
                system_instruction: String::new(),
                remote_instruction: None,
                tool_permissions: Some(ToolPermissions {
                    allow: tools,
                    deny: Vec::new(),
                    allow_patterns: Vec::new(),
                    deny_patterns: Vec::new(),
                }),
                metadata: None,
            };

            self.roles.insert(role_id, role);
        }
    }

    /// Check if a role can access a server
    pub fn can_access_server(&self, role_id: &str, server: &str) -> bool {
        self.get_role(role_id)
            .map(|r| r.allows_server(server))
            .unwrap_or(false)
    }

    /// Get effective servers for a role (including inherited)
    pub fn get_effective_servers(&self, role_id: &str) -> Vec<String> {
        let mut servers = Vec::new();
        let mut visited = std::collections::HashSet::new();
        self.collect_servers(role_id, &mut servers, &mut visited);
        servers.sort();
        servers.dedup();
        servers
    }

    fn collect_servers(
        &self,
        role_id: &str,
        servers: &mut Vec<String>,
        visited: &mut std::collections::HashSet<String>,
    ) {
        if visited.contains(role_id) {
            return; // Circular inheritance protection
        }
        visited.insert(role_id.to_string());

        if let Some(role) = self.get_role(role_id) {
            servers.extend(role.allowed_servers.clone());

            if let Some(parent) = &role.inherits {
                self.collect_servers(parent, servers, visited);
            }
        }
    }

    /// Get effective tool permissions for a role (including inherited)
    pub fn get_effective_tool_permissions(&self, role_id: &str) -> ToolPermissions {
        let mut perms = ToolPermissions::default();
        let mut visited = std::collections::HashSet::new();
        self.collect_tool_permissions(role_id, &mut perms, &mut visited);
        perms
    }

    fn collect_tool_permissions(
        &self,
        role_id: &str,
        perms: &mut ToolPermissions,
        visited: &mut std::collections::HashSet<String>,
    ) {
        if visited.contains(role_id) {
            return;
        }
        visited.insert(role_id.to_string());

        if let Some(role) = self.get_role(role_id) {
            if let Some(role_perms) = &role.tool_permissions {
                perms.allow.extend(role_perms.allow.clone());
                perms.deny.extend(role_perms.deny.clone());
                perms.allow_patterns.extend(role_perms.allow_patterns.clone());
                perms.deny_patterns.extend(role_perms.deny_patterns.clone());
            }

            if let Some(parent) = &role.inherits {
                self.collect_tool_permissions(parent, perms, visited);
            }
        }
    }

    /// Get the inheritance chain for a role
    pub fn get_inheritance_chain(&self, role_id: &str) -> Vec<String> {
        let mut chain = Vec::new();
        let mut visited = std::collections::HashSet::new();
        self.collect_inheritance_chain(role_id, &mut chain, &mut visited);
        chain
    }

    fn collect_inheritance_chain(
        &self,
        role_id: &str,
        chain: &mut Vec<String>,
        visited: &mut std::collections::HashSet<String>,
    ) {
        if visited.contains(role_id) {
            return;
        }
        visited.insert(role_id.to_string());
        chain.push(role_id.to_string());

        if let Some(role) = self.get_role(role_id) {
            if let Some(parent) = &role.inherits {
                self.collect_inheritance_chain(parent, chain, visited);
            }
        }
    }

    /// Get effective memory permission for a role
    pub fn get_effective_memory_permission(&self, role_id: &str) -> (MemoryPolicy, Vec<String>) {
        let mut highest_policy = MemoryPolicy::None;
        let mut team_roles: Vec<String> = Vec::new();

        for skill in &self.skills {
            if skill.allows_role(role_id) {
                if let Some(grants) = &skill.grants {
                    if grants.memory.is_higher_than(&highest_policy) {
                        highest_policy = grants.memory;
                    }
                    if grants.memory == MemoryPolicy::Team {
                        team_roles.extend(grants.memory_team_roles.clone());
                    }
                }
            }
        }

        team_roles.sort();
        team_roles.dedup();
        (highest_policy, team_roles)
    }
}

impl Default for RoleManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_registration() {
        let mut manager = RoleManager::new();

        let role = Role::new("admin", "Administrator")
            .with_servers(vec!["*".to_string()]);

        manager.register_role(role);

        assert!(manager.get_role("admin").is_some());
        assert!(manager.can_access_server("admin", "any-server"));
    }

    #[test]
    fn test_role_inheritance() {
        let mut manager = RoleManager::new();

        let base = Role::new("base", "Base Role")
            .with_servers(vec!["filesystem".to_string()]);

        let child = Role::new("child", "Child Role")
            .with_servers(vec!["git".to_string()])
            .inherits_from("base");

        manager.register_role(base);
        manager.register_role(child);

        let servers = manager.get_effective_servers("child");
        assert!(servers.contains(&"filesystem".to_string()));
        assert!(servers.contains(&"git".to_string()));
    }
}
