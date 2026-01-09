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

    /// Check if a role has any memory access
    pub fn has_memory_access(&self, role_id: &str) -> bool {
        let (policy, _) = self.get_effective_memory_permission(role_id);
        policy != MemoryPolicy::None
    }

    /// Check if a role can access all memories (admin level)
    pub fn can_access_all_memories(&self, role_id: &str) -> bool {
        let (policy, _) = self.get_effective_memory_permission(role_id);
        policy == MemoryPolicy::All
    }

    /// Check if source_role can access target_role's memory
    pub fn can_access_role_memory(&self, source_role: &str, target_role: &str) -> bool {
        let (policy, team_roles) = self.get_effective_memory_permission(source_role);

        match policy {
            MemoryPolicy::None => false,
            MemoryPolicy::Isolated => source_role == target_role,
            MemoryPolicy::Team => source_role == target_role || team_roles.contains(&target_role.to_string()),
            MemoryPolicy::All => true,
        }
    }

    /// Check if a tool is allowed for a role (considering patterns)
    pub fn is_tool_allowed_for_role(&self, role_id: &str, tool_name: &str, server: &str) -> bool {
        // Always allow system tools
        if tool_name == "set_role" {
            return true;
        }

        // Check if server is allowed
        if !self.can_access_server(role_id, server) {
            return false;
        }

        if let Some(role) = self.get_role(role_id) {
            if let Some(perms) = &role.tool_permissions {
                // Check explicit allow list
                if perms.allow.contains(&tool_name.to_string()) {
                    return true;
                }

                // Check allow patterns (e.g., "filesystem__*")
                for pattern in &perms.allow {
                    if pattern.ends_with("__*") {
                        let prefix = &pattern[..pattern.len() - 1]; // "filesystem__"
                        if tool_name.starts_with(prefix) {
                            return true;
                        }
                    }
                    if pattern == "*" {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Check if a server is allowed for a role
    pub fn is_server_allowed_for_role(&self, role_id: &str, server: &str) -> bool {
        self.can_access_server(role_id, server)
    }

    /// Check if role exists
    pub fn has_role(&self, role_id: &str) -> bool {
        self.roles.contains_key(role_id)
    }

    /// Get all skills for a role
    pub fn get_skills_for_role(&self, role_id: &str) -> Vec<&SkillDefinition> {
        self.skills
            .iter()
            .filter(|s| s.allows_role(role_id))
            .collect()
    }

    /// Generate role manifest from skills
    pub fn generate_role_manifest(&self, manifest: &SkillManifest) -> RoleManifestOutput {
        let mut roles: HashMap<String, DynamicRoleOutput> = HashMap::new();

        for skill in &manifest.skills {
            for role_id in &skill.allowed_roles {
                if role_id == "*" {
                    continue;
                }

                let entry = roles.entry(role_id.clone()).or_insert_with(|| DynamicRoleOutput {
                    id: role_id.clone(),
                    skills: Vec::new(),
                    tools: Vec::new(),
                });

                entry.skills.push(skill.id.clone());
                entry.tools.extend(skill.allowed_tools.clone());
            }
        }

        // Deduplicate tools
        for role in roles.values_mut() {
            role.tools.sort();
            role.tools.dedup();
        }

        RoleManifestOutput {
            roles,
            source_version: manifest.version.clone(),
        }
    }
}

/// Dynamic role output for manifest generation
#[derive(Debug, Clone)]
pub struct DynamicRoleOutput {
    pub id: String,
    pub skills: Vec<String>,
    pub tools: Vec<String>,
}

/// Role manifest output
#[derive(Debug, Clone)]
pub struct RoleManifestOutput {
    pub roles: HashMap<String, DynamicRoleOutput>,
    pub source_version: String,
}

impl Default for RoleManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared::SkillGrants;

    fn create_test_manifest() -> SkillManifest {
        SkillManifest {
            skills: vec![
                SkillDefinition {
                    id: "docx-handler".to_string(),
                    display_name: "DOCX Handler".to_string(),
                    description: "Handle DOCX files".to_string(),
                    allowed_roles: vec!["formatter".to_string(), "admin".to_string()],
                    allowed_tools: vec![
                        "filesystem__read_file".to_string(),
                        "filesystem__write_file".to_string(),
                        "docx__parse".to_string(),
                    ],
                    grants: None,
                    identity: None,
                    metadata: None,
                },
                SkillDefinition {
                    id: "code-review".to_string(),
                    display_name: "Code Review".to_string(),
                    description: "Review code".to_string(),
                    allowed_roles: vec!["reviewer".to_string(), "admin".to_string()],
                    allowed_tools: vec![
                        "filesystem__read_file".to_string(),
                        "git__diff".to_string(),
                    ],
                    grants: None,
                    identity: None,
                    metadata: None,
                },
                SkillDefinition {
                    id: "guest-access".to_string(),
                    display_name: "Guest Access".to_string(),
                    description: "Minimal read-only".to_string(),
                    allowed_roles: vec!["guest".to_string()],
                    allowed_tools: vec!["filesystem__read_file".to_string()],
                    grants: None,
                    identity: None,
                    metadata: None,
                },
            ],
            version: "1.0.0".to_string(),
            generated_at: "2024-01-01".to_string(),
        }
    }

    // ============== Basic Role Tests ==============

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

    #[test]
    fn test_load_from_skill_manifest() {
        let mut manager = RoleManager::new();
        let manifest = create_test_manifest();
        manager.load_from_skill_manifest(&manifest);

        assert!(manager.get_role("formatter").is_some());
        assert!(manager.get_role("admin").is_some());
        assert!(manager.get_role("reviewer").is_some());
        assert!(manager.get_role("guest").is_some());
    }

    #[test]
    fn test_circular_inheritance_protection() {
        let mut manager = RoleManager::new();

        let role_a = Role::new("role-a", "Role A")
            .with_servers(vec!["server-a".to_string()])
            .inherits_from("role-b");

        let role_b = Role::new("role-b", "Role B")
            .with_servers(vec!["server-b".to_string()])
            .inherits_from("role-a");

        manager.register_role(role_a);
        manager.register_role(role_b);

        // Should not infinite loop
        let chain = manager.get_inheritance_chain("role-a");
        assert!(chain.len() <= 2);
    }

    #[test]
    fn test_multi_level_inheritance() {
        let mut manager = RoleManager::new();

        let level1 = Role::new("level1", "Level 1")
            .with_servers(vec!["server1".to_string()]);

        let level2 = Role::new("level2", "Level 2")
            .with_servers(vec!["server2".to_string()])
            .inherits_from("level1");

        let level3 = Role::new("level3", "Level 3")
            .with_servers(vec!["server3".to_string()])
            .inherits_from("level2");

        manager.register_role(level1);
        manager.register_role(level2);
        manager.register_role(level3);

        let chain = manager.get_inheritance_chain("level3");
        assert_eq!(chain, vec!["level3", "level2", "level1"]);

        let servers = manager.get_effective_servers("level3");
        assert!(servers.contains(&"server1".to_string()));
        assert!(servers.contains(&"server2".to_string()));
        assert!(servers.contains(&"server3".to_string()));
    }

    #[test]
    fn test_effective_tool_permissions_inherited() {
        let mut manager = RoleManager::new();

        let base = Role {
            id: "base".to_string(),
            name: "Base".to_string(),
            description: String::new(),
            inherits: None,
            allowed_servers: vec!["*".to_string()],
            system_instruction: String::new(),
            remote_instruction: None,
            tool_permissions: Some(ToolPermissions {
                allow: vec!["read_file".to_string()],
                deny: vec![],
                allow_patterns: vec![],
                deny_patterns: vec![],
            }),
            metadata: None,
        };

        let child = Role {
            id: "child".to_string(),
            name: "Child".to_string(),
            description: String::new(),
            inherits: Some("base".to_string()),
            allowed_servers: vec!["*".to_string()],
            system_instruction: String::new(),
            remote_instruction: None,
            tool_permissions: Some(ToolPermissions {
                allow: vec!["write_file".to_string()],
                deny: vec![],
                allow_patterns: vec![],
                deny_patterns: vec![],
            }),
            metadata: None,
        };

        manager.register_role(base);
        manager.register_role(child);

        let perms = manager.get_effective_tool_permissions("child");
        assert!(perms.allow.contains(&"read_file".to_string()));
        assert!(perms.allow.contains(&"write_file".to_string()));
    }

    #[test]
    fn test_default_role() {
        let mut manager = RoleManager::new();
        assert_eq!(manager.default_role(), "guest");

        manager.set_default_role("admin");
        assert_eq!(manager.default_role(), "admin");
    }

    #[test]
    fn test_get_role_ids() {
        let mut manager = RoleManager::new();
        manager.register_role(Role::new("admin", "Admin"));
        manager.register_role(Role::new("user", "User"));

        let ids = manager.get_role_ids();
        assert!(ids.contains(&"admin"));
        assert!(ids.contains(&"user"));
    }

    #[test]
    fn test_has_role() {
        let mut manager = RoleManager::new();
        manager.register_role(Role::new("admin", "Admin"));

        assert!(manager.has_role("admin"));
        assert!(!manager.has_role("nonexistent"));
    }

    // ============== Memory Permission Tests ==============

    mod memory_permission {
        use super::*;

        #[test]
        fn test_deny_memory_when_no_skill_grants() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "basic-skill".to_string(),
                    display_name: "Basic".to_string(),
                    description: "No memory grants".to_string(),
                    allowed_roles: vec!["viewer".to_string()],
                    allowed_tools: vec!["read_file".to_string()],
                    grants: None,
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(!manager.has_memory_access("viewer"));
            let (policy, _) = manager.get_effective_memory_permission("viewer");
            assert_eq!(policy, MemoryPolicy::None);
        }

        #[test]
        fn test_deny_memory_when_explicit_none() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "no-memory".to_string(),
                    display_name: "No Memory".to_string(),
                    description: "Explicit none".to_string(),
                    allowed_roles: vec!["guest".to_string()],
                    allowed_tools: vec![],
                    grants: Some(SkillGrants {
                        memory: MemoryPolicy::None,
                        memory_team_roles: vec![],
                    }),
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(!manager.has_memory_access("guest"));
        }

        #[test]
        fn test_isolated_memory_access_via_skill() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "memory-basic".to_string(),
                    display_name: "Basic Memory".to_string(),
                    description: "Isolated memory".to_string(),
                    allowed_roles: vec!["developer".to_string()],
                    allowed_tools: vec![],
                    grants: Some(SkillGrants {
                        memory: MemoryPolicy::Isolated,
                        memory_team_roles: vec![],
                    }),
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(manager.has_memory_access("developer"));
            let (policy, _) = manager.get_effective_memory_permission("developer");
            assert_eq!(policy, MemoryPolicy::Isolated);
        }

        #[test]
        fn test_isolated_own_memory_only() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "memory-isolated".to_string(),
                    display_name: "Isolated".to_string(),
                    description: "Isolated access".to_string(),
                    allowed_roles: vec!["frontend".to_string(), "backend".to_string()],
                    allowed_tools: vec![],
                    grants: Some(SkillGrants {
                        memory: MemoryPolicy::Isolated,
                        memory_team_roles: vec![],
                    }),
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // Frontend can access own memory
            assert!(manager.can_access_role_memory("frontend", "frontend"));
            // Frontend cannot access backend's memory
            assert!(!manager.can_access_role_memory("frontend", "backend"));
            // Backend can access own memory
            assert!(manager.can_access_role_memory("backend", "backend"));
            // Backend cannot access frontend's memory
            assert!(!manager.can_access_role_memory("backend", "frontend"));
        }

        #[test]
        fn test_team_memory_access() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "team-memory".to_string(),
                        display_name: "Team Memory".to_string(),
                        description: "Team access".to_string(),
                        allowed_roles: vec!["lead".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::Team,
                            memory_team_roles: vec!["frontend".to_string(), "backend".to_string()],
                        }),
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "basic".to_string(),
                        display_name: "Basic".to_string(),
                        description: "Creates roles".to_string(),
                        allowed_roles: vec!["frontend".to_string(), "backend".to_string(), "security".to_string()],
                        allowed_tools: vec!["read".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(manager.has_memory_access("lead"));
            let (policy, _) = manager.get_effective_memory_permission("lead");
            assert_eq!(policy, MemoryPolicy::Team);

            // Lead can access own memory
            assert!(manager.can_access_role_memory("lead", "lead"));
            // Lead can access frontend's memory
            assert!(manager.can_access_role_memory("lead", "frontend"));
            // Lead can access backend's memory
            assert!(manager.can_access_role_memory("lead", "backend"));
            // Lead cannot access security's memory (not in team)
            assert!(!manager.can_access_role_memory("lead", "security"));
        }

        #[test]
        fn test_all_memory_access() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "admin-memory".to_string(),
                        display_name: "Admin Memory".to_string(),
                        description: "Full access".to_string(),
                        allowed_roles: vec!["admin".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::All,
                            memory_team_roles: vec![],
                        }),
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "isolated".to_string(),
                        display_name: "Isolated".to_string(),
                        description: "Isolated".to_string(),
                        allowed_roles: vec!["dev".to_string(), "ops".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::Isolated,
                            memory_team_roles: vec![],
                        }),
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(manager.has_memory_access("admin"));
            assert!(manager.can_access_all_memories("admin"));

            // Admin can access any role
            assert!(manager.can_access_role_memory("admin", "admin"));
            assert!(manager.can_access_role_memory("admin", "dev"));
            assert!(manager.can_access_role_memory("admin", "ops"));
            assert!(manager.can_access_role_memory("admin", "nonexistent"));
        }

        #[test]
        fn test_highest_policy_wins() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "isolated-skill".to_string(),
                        display_name: "Isolated".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["developer".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::Isolated,
                            memory_team_roles: vec![],
                        }),
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "team-skill".to_string(),
                        display_name: "Team".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["developer".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::Team,
                            memory_team_roles: vec!["qa".to_string()],
                        }),
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // team > isolated
            let (policy, _) = manager.get_effective_memory_permission("developer");
            assert_eq!(policy, MemoryPolicy::Team);
        }

        #[test]
        fn test_all_over_team_priority() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "team-skill".to_string(),
                        display_name: "Team".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["superuser".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::Team,
                            memory_team_roles: vec!["a".to_string(), "b".to_string()],
                        }),
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "all-skill".to_string(),
                        display_name: "All".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["superuser".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::All,
                            memory_team_roles: vec![],
                        }),
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // all > team
            let (policy, _) = manager.get_effective_memory_permission("superuser");
            assert_eq!(policy, MemoryPolicy::All);
            assert!(manager.can_access_all_memories("superuser"));
        }

        #[test]
        fn test_team_roles_merged() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "team-a".to_string(),
                        display_name: "Team A".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["coordinator".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::Team,
                            memory_team_roles: vec!["dev1".to_string(), "dev2".to_string()],
                        }),
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "team-b".to_string(),
                        display_name: "Team B".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["coordinator".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::Team,
                            memory_team_roles: vec!["ops1".to_string(), "ops2".to_string()],
                        }),
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            let (policy, team_roles) = manager.get_effective_memory_permission("coordinator");
            assert_eq!(policy, MemoryPolicy::Team);
            assert!(team_roles.contains(&"dev1".to_string()));
            assert!(team_roles.contains(&"dev2".to_string()));
            assert!(team_roles.contains(&"ops1".to_string()));
            assert!(team_roles.contains(&"ops2".to_string()));
        }

        #[test]
        fn test_handle_nonexistent_role() {
            let manager = RoleManager::new();
            assert!(!manager.has_memory_access("nonexistent"));
            let (policy, _) = manager.get_effective_memory_permission("nonexistent");
            assert_eq!(policy, MemoryPolicy::None);
        }

        #[test]
        fn test_empty_manifest() {
            let mut manager = RoleManager::new();
            let manifest = SkillManifest {
                skills: vec![],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(!manager.has_memory_access("any"));
        }
    }

    // ============== Tool Filtering Tests ==============

    mod tool_filtering {
        use super::*;

        fn create_tool_manifest() -> SkillManifest {
            SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "orchestration".to_string(),
                        display_name: "Orchestration".to_string(),
                        description: "Delegation only".to_string(),
                        allowed_roles: vec!["orchestrator".to_string()],
                        allowed_tools: vec![],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "frontend-dev".to_string(),
                        display_name: "Frontend Dev".to_string(),
                        description: "Frontend tasks".to_string(),
                        allowed_roles: vec!["frontend".to_string()],
                        allowed_tools: vec![
                            "filesystem__read_file".to_string(),
                            "filesystem__write_file".to_string(),
                            "filesystem__list_directory".to_string(),
                        ],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "guest-access".to_string(),
                        display_name: "Guest Access".to_string(),
                        description: "Read only".to_string(),
                        allowed_roles: vec!["guest".to_string()],
                        allowed_tools: vec![
                            "filesystem__read_file".to_string(),
                            "filesystem__list_directory".to_string(),
                        ],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "devops-full".to_string(),
                        display_name: "DevOps Full".to_string(),
                        description: "Full access".to_string(),
                        allowed_roles: vec!["devops".to_string()],
                        allowed_tools: vec![
                            "filesystem__*".to_string(),
                            "execution__*".to_string(),
                        ],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            }
        }

        #[test]
        fn test_orchestrator_no_tools() {
            let mut manager = RoleManager::new();
            manager.load_from_skill_manifest(&create_tool_manifest());

            // Orchestrator has no tools
            assert!(!manager.is_tool_allowed_for_role("orchestrator", "filesystem__read_file", "filesystem"));
            assert!(!manager.is_tool_allowed_for_role("orchestrator", "execution__run_command", "execution"));
        }

        #[test]
        fn test_orchestrator_set_role_allowed() {
            let mut manager = RoleManager::new();
            manager.load_from_skill_manifest(&create_tool_manifest());

            // set_role is always allowed
            assert!(manager.is_tool_allowed_for_role("orchestrator", "set_role", "aegis-router"));
        }

        #[test]
        fn test_frontend_read_write_allowed() {
            let mut manager = RoleManager::new();
            manager.load_from_skill_manifest(&create_tool_manifest());

            assert!(manager.is_tool_allowed_for_role("frontend", "filesystem__read_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("frontend", "filesystem__write_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("frontend", "filesystem__list_directory", "filesystem"));
        }

        #[test]
        fn test_frontend_delete_denied() {
            let mut manager = RoleManager::new();
            manager.load_from_skill_manifest(&create_tool_manifest());

            assert!(!manager.is_tool_allowed_for_role("frontend", "filesystem__delete_file", "filesystem"));
        }

        #[test]
        fn test_guest_read_only() {
            let mut manager = RoleManager::new();
            manager.load_from_skill_manifest(&create_tool_manifest());

            assert!(manager.is_tool_allowed_for_role("guest", "filesystem__read_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("guest", "filesystem__list_directory", "filesystem"));
            assert!(!manager.is_tool_allowed_for_role("guest", "filesystem__write_file", "filesystem"));
            assert!(!manager.is_tool_allowed_for_role("guest", "filesystem__delete_file", "filesystem"));
        }

        #[test]
        fn test_devops_wildcard_match() {
            let mut manager = RoleManager::new();
            manager.load_from_skill_manifest(&create_tool_manifest());

            // DevOps has filesystem__* and execution__*
            assert!(manager.is_tool_allowed_for_role("devops", "filesystem__read_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("devops", "filesystem__write_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("devops", "filesystem__delete_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("devops", "filesystem__any_operation", "filesystem"));

            assert!(manager.is_tool_allowed_for_role("devops", "execution__run_command", "execution"));
            assert!(manager.is_tool_allowed_for_role("devops", "execution__any_command", "execution"));
        }

        #[test]
        fn test_set_role_always_allowed_all_roles() {
            let mut manager = RoleManager::new();
            manager.load_from_skill_manifest(&create_tool_manifest());

            let roles = ["orchestrator", "frontend", "guest", "devops"];
            for role in roles {
                assert!(
                    manager.is_tool_allowed_for_role(role, "set_role", "aegis-router"),
                    "set_role should be allowed for {}",
                    role
                );
            }
        }
    }

    // ============== Role Switching Tests ==============

    mod role_switching {
        use super::*;

        #[test]
        fn test_different_tools_for_roles() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "editor-skill".to_string(),
                        display_name: "Editor".to_string(),
                        description: "Edit files".to_string(),
                        allowed_roles: vec!["editor".to_string()],
                        allowed_tools: vec![
                            "filesystem__read_file".to_string(),
                            "filesystem__write_file".to_string(),
                            "filesystem__delete_file".to_string(),
                        ],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "viewer-skill".to_string(),
                        display_name: "Viewer".to_string(),
                        description: "View only".to_string(),
                        allowed_roles: vec!["viewer".to_string()],
                        allowed_tools: vec![
                            "filesystem__read_file".to_string(),
                            "filesystem__list_directory".to_string(),
                        ],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // Editor can write and delete
            assert!(manager.is_tool_allowed_for_role("editor", "filesystem__write_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("editor", "filesystem__delete_file", "filesystem"));

            // Viewer cannot
            assert!(!manager.is_tool_allowed_for_role("viewer", "filesystem__write_file", "filesystem"));
            assert!(!manager.is_tool_allowed_for_role("viewer", "filesystem__delete_file", "filesystem"));
        }

        #[test]
        fn test_skill_assignment_per_role() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "docx-handler".to_string(),
                        display_name: "DOCX".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["doc-editor".to_string(), "admin".to_string()],
                        allowed_tools: vec!["docx__read".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "code-formatter".to_string(),
                        display_name: "Code".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["developer".to_string(), "admin".to_string()],
                        allowed_tools: vec!["prettier__format".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            let role_manifest = manager.generate_role_manifest(&manifest);

            // Doc editor has only docx-handler
            assert!(role_manifest.roles["doc-editor"].skills.contains(&"docx-handler".to_string()));
            assert!(!role_manifest.roles["doc-editor"].skills.contains(&"code-formatter".to_string()));

            // Developer has only code-formatter
            assert!(role_manifest.roles["developer"].skills.contains(&"code-formatter".to_string()));
            assert!(!role_manifest.roles["developer"].skills.contains(&"docx-handler".to_string()));

            // Admin has both
            assert!(role_manifest.roles["admin"].skills.contains(&"docx-handler".to_string()));
            assert!(role_manifest.roles["admin"].skills.contains(&"code-formatter".to_string()));
        }

        #[test]
        fn test_aggregate_tools_from_multiple_skills() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "skill-a".to_string(),
                        display_name: "A".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["multi-skill-user".to_string()],
                        allowed_tools: vec!["server1__tool1".to_string(), "server1__tool2".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "skill-b".to_string(),
                        display_name: "B".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["multi-skill-user".to_string()],
                        allowed_tools: vec!["server2__tool1".to_string(), "server1__tool1".to_string()], // Overlap
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);
            let role_manifest = manager.generate_role_manifest(&manifest);

            let role = &role_manifest.roles["multi-skill-user"];

            // Should have 2 skills
            assert_eq!(role.skills.len(), 2);

            // Should have 3 unique tools (deduplicated)
            assert!(role.tools.contains(&"server1__tool1".to_string()));
            assert!(role.tools.contains(&"server1__tool2".to_string()));
            assert!(role.tools.contains(&"server2__tool1".to_string()));
            assert_eq!(role.tools.len(), 3);
        }
    }

    // ============== Skill Integration Tests ==============

    mod skill_integration {
        use super::*;

        #[test]
        fn test_generate_roles_from_skills() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "docx-handler".to_string(),
                        display_name: "DOCX Handler".to_string(),
                        description: "Handle DOCX".to_string(),
                        allowed_roles: vec!["editor".to_string(), "admin".to_string()],
                        allowed_tools: vec!["filesystem__read_file".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "code-reviewer".to_string(),
                        display_name: "Code Reviewer".to_string(),
                        description: "Review code".to_string(),
                        allowed_roles: vec!["developer".to_string(), "admin".to_string()],
                        allowed_tools: vec!["git__status".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            let role_manifest = manager.generate_role_manifest(&manifest);

            // Should have 3 roles: editor, developer, admin
            assert_eq!(role_manifest.roles.len(), 3);

            // Editor has docx-handler
            assert!(role_manifest.roles["editor"].skills.contains(&"docx-handler".to_string()));
            assert!(!role_manifest.roles["editor"].skills.contains(&"code-reviewer".to_string()));

            // Developer has code-reviewer
            assert!(role_manifest.roles["developer"].skills.contains(&"code-reviewer".to_string()));
            assert!(!role_manifest.roles["developer"].skills.contains(&"docx-handler".to_string()));

            // Admin has both
            assert!(role_manifest.roles["admin"].skills.contains(&"docx-handler".to_string()));
            assert!(role_manifest.roles["admin"].skills.contains(&"code-reviewer".to_string()));
        }

        #[test]
        fn test_ignore_wildcard_role() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "public-skill".to_string(),
                        display_name: "Public".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["*".to_string()],
                        allowed_tools: vec!["public_tool".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "private-skill".to_string(),
                        display_name: "Private".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["admin".to_string()],
                        allowed_tools: vec!["private_tool".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            let role_manifest = manager.generate_role_manifest(&manifest);

            // Only admin role should exist (wildcard ignored)
            assert_eq!(role_manifest.roles.len(), 1);
            assert!(role_manifest.roles.contains_key("admin"));

            // Admin only has private skill
            assert!(role_manifest.roles["admin"].skills.contains(&"private-skill".to_string()));
            assert!(!role_manifest.roles["admin"].skills.contains(&"public-skill".to_string()));
        }

        #[test]
        fn test_load_creates_roles() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "test-skill".to_string(),
                    display_name: "Test".to_string(),
                    description: "Testing".to_string(),
                    allowed_roles: vec!["tester".to_string()],
                    allowed_tools: vec!["filesystem__read_file".to_string()],
                    grants: None,
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(manager.has_role("tester"));
        }

        #[test]
        fn test_frontend_backend_fullstack() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "frontend-skill".to_string(),
                        display_name: "Frontend".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["frontend".to_string(), "fullstack".to_string()],
                        allowed_tools: vec!["filesystem__read_file".to_string(), "filesystem__write_file".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "backend-skill".to_string(),
                        display_name: "Backend".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["backend".to_string(), "fullstack".to_string()],
                        allowed_tools: vec!["filesystem__read_file".to_string(), "database__query".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // Should have 3 roles
            assert!(manager.has_role("frontend"));
            assert!(manager.has_role("backend"));
            assert!(manager.has_role("fullstack"));

            // Frontend: read + write, no database
            assert!(manager.is_tool_allowed_for_role("frontend", "filesystem__read_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("frontend", "filesystem__write_file", "filesystem"));
            assert!(!manager.is_tool_allowed_for_role("frontend", "database__query", "database"));

            // Backend: read + database, no write
            assert!(manager.is_tool_allowed_for_role("backend", "filesystem__read_file", "filesystem"));
            assert!(!manager.is_tool_allowed_for_role("backend", "filesystem__write_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("backend", "database__query", "database"));

            // Fullstack: all
            assert!(manager.is_tool_allowed_for_role("fullstack", "filesystem__read_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("fullstack", "filesystem__write_file", "filesystem"));
            assert!(manager.is_tool_allowed_for_role("fullstack", "database__query", "database"));
        }
    }

    // ============== Red Team Security Tests ==============

    mod red_team {
        use super::*;

        #[test]
        fn test_sql_injection_in_role_id() {
            let mut manager = RoleManager::new();

            // Attempt SQL injection in role ID
            let malicious_id = "admin'; DROP TABLE users; --";
            let role = Role::new(malicious_id, "Malicious");
            manager.register_role(role);

            // Should be stored literally, not interpreted
            assert!(manager.has_role(malicious_id));
            assert!(!manager.has_role("admin"));
        }

        #[test]
        fn test_path_traversal_in_role_id() {
            let mut manager = RoleManager::new();

            let malicious_ids = vec![
                "../../../etc/passwd",
                "..\\..\\..\\windows\\system32",
                "role/../../admin",
                "role%2F..%2F..%2Fadmin",
            ];

            for id in malicious_ids {
                let role = Role::new(id, "Traversal Test");
                manager.register_role(role);
                assert!(manager.has_role(id));
            }
        }

        #[test]
        fn test_null_byte_injection_in_role_id() {
            let mut manager = RoleManager::new();

            let role = Role::new("admin\x00guest", "Null Injection");
            manager.register_role(role);

            // Should be stored as-is
            assert!(manager.has_role("admin\x00guest"));
            assert!(!manager.has_role("admin"));
            assert!(!manager.has_role("guest"));
        }

        #[test]
        fn test_unicode_normalization_attack() {
            let mut manager = RoleManager::new();

            // Different Unicode representations of "admin"
            let admin_variants = vec![
                "admin",           // Normal
                "аdmin",           // Cyrillic 'а' (U+0430)
                "ａdmin",          // Fullwidth 'ａ' (U+FF41)
            ];

            for admin in admin_variants {
                let role = Role::new(admin, "Admin Variant");
                manager.register_role(role);
            }

            // Each should be stored separately (no normalization)
            // The manager should not conflate different Unicode strings
            assert!(manager.has_role("admin"));
        }

        #[test]
        fn test_privilege_escalation_nonexistent_parent() {
            let mut manager = RoleManager::new();

            // Try to inherit from admin when admin doesn't exist
            let escalation = Role::new("guest", "Guest")
                .inherits_from("admin");

            manager.register_role(escalation);

            // Should not gain any admin powers
            let servers = manager.get_effective_servers("guest");
            assert!(servers.is_empty()); // No servers from nonexistent parent
        }

        #[test]
        fn test_privilege_escalation_via_wildcard() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "guest-skill".to_string(),
                        display_name: "Guest".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["guest".to_string()],
                        allowed_tools: vec!["filesystem__read_file".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // Guest should NOT be able to access dangerous tools
            assert!(!manager.is_tool_allowed_for_role("guest", "filesystem__delete_file", "filesystem"));
            assert!(!manager.is_tool_allowed_for_role("guest", "database__drop_table", "database"));
            assert!(!manager.is_tool_allowed_for_role("guest", "execution__run_shell", "execution"));
        }

        #[test]
        fn test_memory_policy_escalation() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "guest-skill".to_string(),
                        display_name: "Guest".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["guest".to_string()],
                        allowed_tools: vec![],
                        grants: Some(SkillGrants {
                            memory: MemoryPolicy::None,
                            memory_team_roles: vec![],
                        }),
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // Guest should NOT be able to access admin memory
            assert!(!manager.can_access_role_memory("guest", "admin"));
            assert!(!manager.can_access_all_memories("guest"));
        }

        #[test]
        fn test_deep_inheritance_chain_does_not_overflow() {
            let mut manager = RoleManager::new();

            // Create a very deep inheritance chain
            for i in 0..100 {
                let parent = if i == 0 { None } else { Some(format!("role{}", i - 1)) };
                let role = Role {
                    id: format!("role{}", i),
                    name: format!("Role {}", i),
                    description: String::new(),
                    inherits: parent,
                    allowed_servers: vec![format!("server{}", i)],
                    system_instruction: String::new(),
                    remote_instruction: None,
                    tool_permissions: None,
                    metadata: None,
                };
                manager.register_role(role);
            }

            // Should not stack overflow
            let chain = manager.get_inheritance_chain("role99");
            assert_eq!(chain.len(), 100);

            let servers = manager.get_effective_servers("role99");
            assert_eq!(servers.len(), 100);
        }

        #[test]
        fn test_triple_circular_inheritance() {
            let mut manager = RoleManager::new();

            let role_a = Role::new("a", "A").inherits_from("b");
            let role_b = Role::new("b", "B").inherits_from("c");
            let role_c = Role::new("c", "C").inherits_from("a");

            manager.register_role(role_a);
            manager.register_role(role_b);
            manager.register_role(role_c);

            // Should not infinite loop - all chains should be <= 3
            let chain_a = manager.get_inheritance_chain("a");
            let chain_b = manager.get_inheritance_chain("b");
            let chain_c = manager.get_inheritance_chain("c");

            assert!(chain_a.len() <= 3);
            assert!(chain_b.len() <= 3);
            assert!(chain_c.len() <= 3);
        }

        #[test]
        fn test_self_referential_inheritance() {
            let mut manager = RoleManager::new();

            let self_ref = Role::new("self", "Self").inherits_from("self");
            manager.register_role(self_ref);

            // Should not infinite loop
            let chain = manager.get_inheritance_chain("self");
            assert_eq!(chain.len(), 1);
            assert_eq!(chain[0], "self");
        }

        #[test]
        fn test_tool_name_with_injection_attempt() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "test".to_string(),
                    display_name: "Test".to_string(),
                    description: "".to_string(),
                    allowed_roles: vec!["tester".to_string()],
                    allowed_tools: vec!["safe__tool".to_string()],
                    grants: None,
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // Injection attempts in tool names should not work
            assert!(!manager.is_tool_allowed_for_role("tester", "safe__tool; rm -rf /", "safe"));
            assert!(!manager.is_tool_allowed_for_role("tester", "safe__tool\n dangerous__tool", "safe"));
            assert!(!manager.is_tool_allowed_for_role("tester", "dangerous__tool", "dangerous"));
        }
    }

    // ============== Edge Cases ==============

    mod edge_cases {
        use super::*;

        #[test]
        fn test_empty_role_id() {
            let mut manager = RoleManager::new();
            let role = Role::new("", "Empty ID");
            manager.register_role(role);

            assert!(manager.has_role(""));
            assert!(manager.get_role("").is_some());
        }

        #[test]
        fn test_very_long_role_id() {
            let mut manager = RoleManager::new();
            let long_id = "a".repeat(10000);
            let role = Role::new(long_id.clone(), "Long ID");
            manager.register_role(role);

            assert!(manager.has_role(&long_id));
        }

        #[test]
        fn test_unicode_role_id() {
            let mut manager = RoleManager::new();
            let role = Role::new("管理者ロール", "Japanese Admin");
            manager.register_role(role);

            assert!(manager.has_role("管理者ロール"));
        }

        #[test]
        fn test_emoji_role_id() {
            let mut manager = RoleManager::new();
            let role = Role::new("👑admin👑", "Emoji Admin");
            manager.register_role(role);

            assert!(manager.has_role("👑admin👑"));
        }

        #[test]
        fn test_whitespace_role_id() {
            let mut manager = RoleManager::new();
            let role = Role::new("   ", "Whitespace");
            manager.register_role(role);

            assert!(manager.has_role("   "));
            assert!(!manager.has_role(""));
        }

        #[test]
        fn test_newline_in_role_id() {
            let mut manager = RoleManager::new();
            let role = Role::new("role\nwith\nnewlines", "Newline Role");
            manager.register_role(role);

            assert!(manager.has_role("role\nwith\nnewlines"));
        }

        #[test]
        fn test_replace_existing_role() {
            let mut manager = RoleManager::new();

            let role1 = Role::new("admin", "Admin V1")
                .with_servers(vec!["server1".to_string()]);
            manager.register_role(role1);

            let role2 = Role::new("admin", "Admin V2")
                .with_servers(vec!["server2".to_string()]);
            manager.register_role(role2);

            let role = manager.get_role("admin").unwrap();
            assert_eq!(role.name, "Admin V2");
            assert!(role.allowed_servers.contains(&"server2".to_string()));
        }

        #[test]
        fn test_get_nonexistent_role() {
            let manager = RoleManager::new();
            assert!(manager.get_role("nonexistent").is_none());
        }

        #[test]
        fn test_default_trait() {
            let manager = RoleManager::default();
            assert_eq!(manager.default_role(), "guest");
        }

        #[test]
        fn test_debug_trait() {
            let mut manager = RoleManager::new();
            manager.register_role(Role::new("test", "Test"));

            let debug = format!("{:?}", manager);
            assert!(debug.contains("RoleManager"));
        }

        #[test]
        fn test_can_access_server_nonexistent_role() {
            let manager = RoleManager::new();
            assert!(!manager.can_access_server("nonexistent", "any-server"));
        }

        #[test]
        fn test_get_effective_servers_nonexistent() {
            let manager = RoleManager::new();
            let servers = manager.get_effective_servers("nonexistent");
            assert!(servers.is_empty());
        }

        #[test]
        fn test_get_inheritance_chain_nonexistent() {
            let manager = RoleManager::new();
            let chain = manager.get_inheritance_chain("nonexistent");
            // Chain includes the requested role_id even if not found,
            // but won't traverse to parents since the role doesn't exist
            assert_eq!(chain.len(), 1);
            assert_eq!(chain[0], "nonexistent");
        }

        #[test]
        fn test_empty_skill_manifest() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(manager.get_role_ids().is_empty());
        }

        #[test]
        fn test_skill_with_empty_allowed_roles() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "orphan".to_string(),
                    display_name: "Orphan".to_string(),
                    description: "".to_string(),
                    allowed_roles: vec![],
                    allowed_tools: vec!["tool".to_string()],
                    grants: None,
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // No roles should be created
            assert!(manager.get_role_ids().is_empty());
        }

        #[test]
        fn test_skill_with_empty_allowed_tools() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "no-tools".to_string(),
                    display_name: "No Tools".to_string(),
                    description: "".to_string(),
                    allowed_roles: vec!["limited".to_string()],
                    allowed_tools: vec![],
                    grants: None,
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            assert!(manager.has_role("limited"));
            // Only set_role should be allowed
            assert!(manager.is_tool_allowed_for_role("limited", "set_role", "aegis"));
            assert!(!manager.is_tool_allowed_for_role("limited", "any_tool", "any"));
        }

        #[test]
        fn test_get_skills_for_role() {
            let mut manager = RoleManager::new();
            let manifest = create_test_manifest();
            manager.load_from_skill_manifest(&manifest);

            let skills = manager.get_skills_for_role("admin");
            assert_eq!(skills.len(), 2); // docx-handler and code-review

            let skill_ids: Vec<&str> = skills.iter().map(|s| s.id.as_str()).collect();
            assert!(skill_ids.contains(&"docx-handler"));
            assert!(skill_ids.contains(&"code-review"));
        }

        #[test]
        fn test_get_skills_for_nonexistent_role() {
            let mut manager = RoleManager::new();
            let manifest = create_test_manifest();
            manager.load_from_skill_manifest(&manifest);

            let skills = manager.get_skills_for_role("nonexistent");
            assert!(skills.is_empty());
        }

        #[test]
        fn test_wildcard_server_access() {
            let mut manager = RoleManager::new();

            let role = Role::new("admin", "Admin")
                .with_servers(vec!["*".to_string()]);
            manager.register_role(role);

            assert!(manager.can_access_server("admin", "any-server"));
            assert!(manager.can_access_server("admin", "filesystem"));
            assert!(manager.can_access_server("admin", "database"));
        }

        #[test]
        fn test_pattern_match_tool_permissions() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![SkillDefinition {
                    id: "pattern-skill".to_string(),
                    display_name: "Pattern".to_string(),
                    description: "".to_string(),
                    allowed_roles: vec!["pattern-user".to_string()],
                    allowed_tools: vec![
                        "fs__*".to_string(),      // All fs tools
                        "*".to_string(),          // All tools (admin-like)
                    ],
                    grants: None,
                    identity: None,
                    metadata: None,
                }],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            manager.load_from_skill_manifest(&manifest);

            // With wildcard *, all tools should be allowed
            assert!(manager.is_tool_allowed_for_role("pattern-user", "any__tool", "any"));
            assert!(manager.is_tool_allowed_for_role("pattern-user", "fs__read", "fs"));
        }

        #[test]
        fn test_duplicate_tools_deduplicated() {
            let mut manager = RoleManager::new();

            let manifest = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "skill1".to_string(),
                        display_name: "1".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["multi".to_string()],
                        allowed_tools: vec!["tool__a".to_string(), "tool__b".to_string()],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                    SkillDefinition {
                        id: "skill2".to_string(),
                        display_name: "2".to_string(),
                        description: "".to_string(),
                        allowed_roles: vec!["multi".to_string()],
                        allowed_tools: vec!["tool__a".to_string(), "tool__c".to_string()], // Overlapping
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            let role_manifest = manager.generate_role_manifest(&manifest);
            let role = &role_manifest.roles["multi"];

            // Should have 3 unique tools
            assert_eq!(role.tools.len(), 3);
            assert!(role.tools.contains(&"tool__a".to_string()));
            assert!(role.tools.contains(&"tool__b".to_string()));
            assert!(role.tools.contains(&"tool__c".to_string()));
        }
    }

    // ============== Role Manifest Output Tests ==============

    mod role_manifest_output {
        use super::*;

        #[test]
        fn test_role_manifest_source_version() {
            let manager = RoleManager::new();
            let manifest = create_test_manifest();

            let role_manifest = manager.generate_role_manifest(&manifest);
            assert_eq!(role_manifest.source_version, "1.0.0");
        }

        #[test]
        fn test_dynamic_role_output_clone() {
            let role = DynamicRoleOutput {
                id: "test".to_string(),
                skills: vec!["skill1".to_string()],
                tools: vec!["tool1".to_string()],
            };

            let cloned = role.clone();
            assert_eq!(cloned.id, role.id);
            assert_eq!(cloned.skills, role.skills);
            assert_eq!(cloned.tools, role.tools);
        }

        #[test]
        fn test_dynamic_role_output_debug() {
            let role = DynamicRoleOutput {
                id: "test".to_string(),
                skills: vec![],
                tools: vec![],
            };

            let debug = format!("{:?}", role);
            assert!(debug.contains("DynamicRoleOutput"));
            assert!(debug.contains("test"));
        }

        #[test]
        fn test_role_manifest_output_clone() {
            let manager = RoleManager::new();
            let manifest = create_test_manifest();

            let role_manifest = manager.generate_role_manifest(&manifest);
            let cloned = role_manifest.clone();

            assert_eq!(cloned.source_version, role_manifest.source_version);
            assert_eq!(cloned.roles.len(), role_manifest.roles.len());
        }

        #[test]
        fn test_role_manifest_output_debug() {
            let manager = RoleManager::new();
            let manifest = create_test_manifest();

            let role_manifest = manager.generate_role_manifest(&manifest);
            let debug = format!("{:?}", role_manifest);

            assert!(debug.contains("RoleManifestOutput"));
        }
    }
}
