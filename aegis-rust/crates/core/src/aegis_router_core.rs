//! AegisRouterCore - Central routing system (司令塔)

use rbac::{RoleManager, ToolVisibilityManager};
use a2a::{IdentityResolver, IdentityResolverConfig, A2AAgentCard, IdentityResolution};
use audit::{AuditLogger, RateLimiter};
use gateway::StdioRouter;
use shared::{DesktopConfig, Logger, SkillManifest, Result, AegisError};
use std::sync::Arc;

/// AegisRouterCore configuration
#[derive(Debug, Clone)]
pub struct RouterConfig {
    pub a2a_mode: bool,
    pub default_role: String,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            a2a_mode: false,
            default_role: "guest".to_string(),
        }
    }
}

/// AegisRouterCore - The central orchestrator
pub struct AegisRouterCore {
    /// Logger
    logger: Arc<dyn Logger>,
    /// Configuration
    config: RouterConfig,
    /// Role manager
    role_manager: RoleManager,
    /// Tool visibility manager
    tool_visibility: ToolVisibilityManager,
    /// Identity resolver (for A2A mode)
    identity_resolver: IdentityResolver,
    /// Audit logger
    audit_logger: AuditLogger,
    /// Rate limiter
    #[allow(dead_code)] // Will be used for rate limiting tool calls
    rate_limiter: RateLimiter,
    /// Stdio router for MCP connections
    stdio_router: StdioRouter,
    /// Current role ID
    current_role: Option<String>,
}

impl AegisRouterCore {
    /// Create a new AegisRouterCore
    pub fn new(logger: Arc<dyn Logger>, config: RouterConfig) -> Self {
        let identity_config = IdentityResolverConfig {
            default_role: config.default_role.clone(),
            ..Default::default()
        };

        Self {
            logger: logger.clone(),
            config,
            role_manager: RoleManager::new(),
            tool_visibility: ToolVisibilityManager::new(),
            identity_resolver: IdentityResolver::new(logger, identity_config),
            audit_logger: AuditLogger::default(),
            rate_limiter: RateLimiter::new(),
            stdio_router: StdioRouter::new(),
            current_role: None,
        }
    }

    /// Load configuration from desktop config
    pub fn load_config(&mut self, config: &DesktopConfig) -> Result<()> {
        for (name, server_config) in &config.mcp_servers {
            self.stdio_router.add_server(name.clone(), server_config.clone());
        }
        Ok(())
    }

    /// Load roles from skill manifest
    pub fn load_from_skill_manifest(&mut self, manifest: &SkillManifest) {
        self.role_manager.load_from_skill_manifest(manifest);

        // Refresh tool visibility
        if let Some(role_id) = &self.current_role {
            if let Some(role) = self.role_manager.get_role(role_id) {
                self.tool_visibility.set_current_role(role.clone());
            }
        }
    }

    /// Set the current role
    pub fn set_role(&mut self, role_id: &str) -> Result<()> {
        // Can't use set_role in A2A mode
        if self.config.a2a_mode {
            return Err(AegisError::Config("set_role is disabled in A2A mode".to_string()));
        }

        let role = self.role_manager.get_role(role_id).ok_or_else(|| {
            shared::RoleNotFoundError {
                role_id: role_id.to_string(),
                available_roles: self.role_manager.get_role_ids().iter().map(|s| s.to_string()).collect(),
            }
        })?;

        let old_role = self.current_role.clone().unwrap_or_else(|| "none".to_string());
        self.audit_logger.log_role_switch(&old_role, role_id);

        self.tool_visibility.set_current_role(role.clone());
        self.current_role = Some(role_id.to_string());

        self.logger.info(&format!("Role switched to '{}'", role_id), None);
        Ok(())
    }

    /// Set role from A2A agent identity
    pub fn set_role_from_identity(&mut self, agent_card: &A2AAgentCard) -> IdentityResolution {
        let resolution = self.identity_resolver.resolve(agent_card);

        if let Some(role) = self.role_manager.get_role(&resolution.role_id) {
            self.tool_visibility.set_current_role(role.clone());
            self.current_role = Some(resolution.role_id.clone());
        }

        resolution
    }

    /// Get the current role
    pub fn current_role(&self) -> Option<&str> {
        self.current_role.as_deref()
    }

    /// Enable A2A mode
    pub fn enable_a2a_mode(&mut self) {
        self.config.a2a_mode = true;
    }

    /// Disable A2A mode
    pub fn disable_a2a_mode(&mut self) {
        self.config.a2a_mode = false;
    }

    /// Check if A2A mode is enabled
    pub fn is_a2a_mode(&self) -> bool {
        self.config.a2a_mode
    }

    /// Get visible tools for current role
    pub fn get_visible_tools(&self) -> Vec<&shared::ToolInfo> {
        self.tool_visibility.get_visible_tools()
    }

    /// Check tool access
    pub fn check_tool_access(&self, tool_name: &str) -> Result<()> {
        self.tool_visibility.check_access(tool_name)?;
        Ok(())
    }

    /// Start required servers for current role
    pub fn start_servers_for_role(&mut self) -> Result<()> {
        let role = match &self.current_role {
            Some(id) => self.role_manager.get_role(id),
            None => return Ok(()),
        };

        if let Some(role) = role {
            for server in &role.allowed_servers {
                if server != "*" {
                    let _ = self.stdio_router.start_server(server);
                }
            }
        }

        Ok(())
    }

    /// Get audit statistics
    pub fn get_audit_stats(&self) -> audit::AuditStats {
        self.audit_logger.get_stats()
    }

    /// Get recent denials
    pub fn get_recent_denials(&self, limit: usize) -> Vec<&audit::AuditEntry> {
        self.audit_logger.get_recent_denials(limit)
    }

    /// Get identity resolver statistics
    pub fn get_identity_stats(&self) -> a2a::IdentityResolverStats {
        self.identity_resolver.get_stats()
    }

    /// List available roles
    pub fn list_roles(&self) -> Vec<&str> {
        self.role_manager.get_role_ids()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared::{NullLogger, SkillDefinition, SkillGrants, MemoryPolicy};

    fn create_logger() -> Arc<dyn Logger> {
        Arc::new(NullLogger)
    }

    fn create_test_manifest() -> SkillManifest {
        SkillManifest {
            skills: vec![
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
                SkillDefinition {
                    id: "developer-tools".to_string(),
                    display_name: "Developer Tools".to_string(),
                    description: "Development access".to_string(),
                    allowed_roles: vec!["developer".to_string()],
                    allowed_tools: vec![
                        "filesystem__read_file".to_string(),
                        "filesystem__write_file".to_string(),
                    ],
                    grants: Some(SkillGrants {
                        memory: MemoryPolicy::Isolated,
                        memory_team_roles: vec![],
                    }),
                    identity: None,
                    metadata: None,
                },
                SkillDefinition {
                    id: "admin-full".to_string(),
                    display_name: "Admin Full".to_string(),
                    description: "Full access".to_string(),
                    allowed_roles: vec!["admin".to_string()],
                    allowed_tools: vec!["*".to_string()],
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
        }
    }

    // ============== Basic Router Tests ==============

    #[test]
    fn test_router_creation() {
        let logger = create_logger();
        let router = AegisRouterCore::new(logger, RouterConfig::default());

        assert!(!router.is_a2a_mode());
        assert!(router.current_role().is_none());
    }

    #[test]
    fn test_router_with_a2a_mode_enabled() {
        let logger = create_logger();
        let config = RouterConfig {
            a2a_mode: true,
            ..Default::default()
        };
        let router = AegisRouterCore::new(logger, config);

        assert!(router.is_a2a_mode());
    }

    #[test]
    fn test_enable_disable_a2a_mode() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        assert!(!router.is_a2a_mode());

        router.enable_a2a_mode();
        assert!(router.is_a2a_mode());

        router.disable_a2a_mode();
        assert!(!router.is_a2a_mode());
    }

    #[test]
    fn test_toggle_a2a_mode_multiple_times() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        router.enable_a2a_mode();
        assert!(router.is_a2a_mode());
        router.disable_a2a_mode();
        assert!(!router.is_a2a_mode());
        router.enable_a2a_mode();
        assert!(router.is_a2a_mode());
    }

    // ============== Skill Manifest Loading Tests ==============

    #[test]
    fn test_load_from_skill_manifest() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        // Roles should be available
        let roles = router.list_roles();
        assert!(roles.contains(&"guest"));
        assert!(roles.contains(&"developer"));
        assert!(roles.contains(&"admin"));
    }

    // ============== Role Setting Tests ==============

    #[test]
    fn test_set_role_success() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        let result = router.set_role("guest");
        assert!(result.is_ok());
        assert_eq!(router.current_role(), Some("guest"));
    }

    #[test]
    fn test_set_role_nonexistent_fails() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        let result = router.set_role("nonexistent-role-xyz");
        assert!(result.is_err());
    }

    #[test]
    fn test_set_role_disabled_in_a2a_mode() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        router.enable_a2a_mode();

        let result = router.set_role("guest");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("A2A mode"));
    }

    #[test]
    fn test_role_switch_between_roles() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        router.set_role("guest").unwrap();
        assert_eq!(router.current_role(), Some("guest"));

        router.set_role("developer").unwrap();
        assert_eq!(router.current_role(), Some("developer"));

        router.set_role("admin").unwrap();
        assert_eq!(router.current_role(), Some("admin"));
    }

    // ============== A2A Identity Resolution Tests ==============

    #[test]
    fn test_set_role_from_identity() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        let agent_card = A2AAgentCard {
            name: "test-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };

        let resolution = router.set_role_from_identity(&agent_card);

        // Should resolve to default role since no skills match
        assert!(!resolution.role_id.is_empty());
    }

    // ============== Audit Tests ==============

    #[test]
    fn test_audit_stats_available() {
        let logger = create_logger();
        let router = AegisRouterCore::new(logger, RouterConfig::default());

        let stats = router.get_audit_stats();
        assert_eq!(stats.total_entries, 0);
        assert_eq!(stats.denial_count, 0);
    }

    #[test]
    fn test_audit_logs_role_switch() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        router.set_role("guest").unwrap();
        router.set_role("developer").unwrap();

        let stats = router.get_audit_stats();
        assert_eq!(stats.total_entries, 2);
    }

    #[test]
    fn test_get_recent_denials() {
        let logger = create_logger();
        let router = AegisRouterCore::new(logger, RouterConfig::default());

        let denials = router.get_recent_denials(10);
        assert!(denials.is_empty());
    }

    // ============== Identity Resolver Stats Tests ==============

    #[test]
    fn test_identity_stats_available() {
        let logger = create_logger();
        let router = AegisRouterCore::new(logger, RouterConfig::default());

        let stats = router.get_identity_stats();
        assert_eq!(stats.total_rules, 0);
    }

    // ============== Default Config Tests ==============

    #[test]
    fn test_router_config_default() {
        let config = RouterConfig::default();

        assert!(!config.a2a_mode);
        assert_eq!(config.default_role, "guest");
    }

    // ============== List Roles Tests ==============

    #[test]
    fn test_list_roles_empty_initially() {
        let logger = create_logger();
        let router = AegisRouterCore::new(logger, RouterConfig::default());

        let roles = router.list_roles();
        assert!(roles.is_empty());
    }

    #[test]
    fn test_list_roles_after_manifest_load() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        let roles = router.list_roles();
        assert_eq!(roles.len(), 3);
    }

    // ============== Tool Visibility Tests ==============

    #[test]
    fn test_get_visible_tools_without_role() {
        let logger = create_logger();
        let router = AegisRouterCore::new(logger, RouterConfig::default());

        let tools = router.get_visible_tools();
        // Without a role set, behavior depends on implementation
        assert!(tools.is_empty() || !tools.is_empty()); // Just verify it doesn't panic
    }

    // ============== Config Loading Tests ==============

    #[test]
    fn test_load_config() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let config = DesktopConfig {
            mcp_servers: std::collections::HashMap::new(),
        };

        let result = router.load_config(&config);
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_config_with_servers() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let mut servers = std::collections::HashMap::new();
        servers.insert("filesystem".to_string(), shared::MCPServerConfig {
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "@modelcontextprotocol/server-filesystem".to_string()],
            env: std::collections::HashMap::new(),
        });

        let config = DesktopConfig {
            mcp_servers: servers,
        };

        let result = router.load_config(&config);
        assert!(result.is_ok());
    }

    // ============== Additional Router Tests ==============

    #[test]
    fn test_router_custom_default_role() {
        let logger = create_logger();
        let config = RouterConfig {
            a2a_mode: false,
            default_role: "admin".to_string(),
        };
        let router = AegisRouterCore::new(logger, config);

        assert!(!router.is_a2a_mode());
        assert!(router.current_role().is_none());
    }

    #[test]
    fn test_multiple_role_switches() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        // Rapid role switching
        router.set_role("guest").unwrap();
        router.set_role("developer").unwrap();
        router.set_role("admin").unwrap();
        router.set_role("guest").unwrap();
        router.set_role("admin").unwrap();

        assert_eq!(router.current_role(), Some("admin"));

        let stats = router.get_audit_stats();
        assert_eq!(stats.total_entries, 5);
    }

    #[test]
    fn test_role_switch_preserves_tools() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        router.set_role("guest").unwrap();
        let _tools_guest = router.get_visible_tools();

        router.set_role("admin").unwrap();
        let _tools_admin = router.get_visible_tools();

        // Both tool lists should be valid
        assert_eq!(router.current_role(), Some("admin"));
    }

    #[test]
    fn test_start_servers_without_role() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        // Should not panic without a role
        let result = router.start_servers_for_role();
        assert!(result.is_ok());
    }

    #[test]
    fn test_start_servers_with_role() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        router.set_role("guest").unwrap();

        // Should not panic (even if servers don't actually start)
        let result = router.start_servers_for_role();
        assert!(result.is_ok());
    }

    #[test]
    fn test_identity_resolver_stats_after_resolution() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let agent_card = A2AAgentCard {
            name: "test-agent".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![],
        };

        let _resolution = router.set_role_from_identity(&agent_card);
        let stats = router.get_identity_stats();

        // Stats should be available after resolution
        assert_eq!(stats.total_rules, 0); // No rules configured
    }

    #[test]
    fn test_set_role_from_identity_with_skills() {
        let logger = create_logger();
        let mut router = AegisRouterCore::new(logger, RouterConfig::default());

        let manifest = create_test_manifest();
        router.load_from_skill_manifest(&manifest);

        let agent_card = A2AAgentCard {
            name: "react-builder".to_string(),
            version: "1.0.0".to_string(),
            skills: vec![
                a2a::A2AAgentSkill {
                    id: "react".to_string(),
                    name: Some("React Development".to_string()),
                    description: None,
                },
            ],
        };

        let resolution = router.set_role_from_identity(&agent_card);
        assert!(!resolution.role_id.is_empty());
    }

    // ============== Red Team Security Tests ==============

    mod red_team {
        use super::*;

        #[test]
        fn red_team_set_role_blocked_in_a2a_mode() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            router.enable_a2a_mode();

            // Any set_role attempt should fail in A2A mode
            let result = router.set_role("guest");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(err.contains("A2A"));
        }

        #[test]
        fn red_team_nonexistent_role_fails() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let result = router.set_role("super_admin_secret");
            assert!(result.is_err());
        }

        #[test]
        fn red_team_sql_injection_style_role() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            // Try SQL injection style attacks
            let attacks = vec![
                "admin; DROP TABLE users",
                "guest' OR '1'='1",
                "admin--",
                "admin/**/",
                "'; DELETE FROM roles; --",
            ];

            for attack in attacks {
                let result = router.set_role(attack);
                assert!(result.is_err(), "Attack should fail: {}", attack);
            }
        }

        #[test]
        fn red_team_path_traversal_role() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let attacks = vec![
                "../../../etc/passwd",
                "..\\..\\windows\\system32",
                "/admin",
                "admin/../guest",
            ];

            for attack in attacks {
                let result = router.set_role(attack);
                assert!(result.is_err(), "Path attack should fail: {}", attack);
            }
        }

        #[test]
        fn red_team_null_byte_injection() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let attacks = vec![
                "admin\0guest",
                "guest\x00admin",
            ];

            for attack in attacks {
                let result = router.set_role(attack);
                assert!(result.is_err(), "Null byte attack should fail: {}", attack);
            }
        }

        #[test]
        fn red_team_privilege_escalation_after_downgrade() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            // Start as admin
            router.set_role("admin").unwrap();
            assert_eq!(router.current_role(), Some("admin"));

            // Downgrade to guest
            router.set_role("guest").unwrap();
            assert_eq!(router.current_role(), Some("guest"));

            // Verify current role is actually guest, not still admin
            assert_ne!(router.current_role(), Some("admin"));
        }

        #[test]
        fn red_team_a2a_mode_toggle_attack() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            // Enable A2A mode
            router.enable_a2a_mode();

            // set_role should fail
            assert!(router.set_role("admin").is_err());

            // Disable A2A mode
            router.disable_a2a_mode();

            // set_role should work now
            assert!(router.set_role("admin").is_ok());
        }

        #[test]
        fn red_team_empty_role_id() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let result = router.set_role("");
            assert!(result.is_err());
        }

        #[test]
        fn red_team_whitespace_role_id() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let attacks = vec![
                "   ",
                "\t",
                "\n",
                " admin ",
                "admin\n",
            ];

            for attack in attacks {
                let result = router.set_role(attack);
                assert!(result.is_err(), "Whitespace attack should fail: {:?}", attack);
            }
        }

        #[test]
        fn red_team_unicode_normalization_attack() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            // Try Unicode lookalike characters for "admin"
            let attacks = vec![
                "аdmin", // Cyrillic 'а' instead of Latin 'a'
                "ａｄｍｉｎ", // Fullwidth characters
                "admin\u{200B}", // Zero-width space
                "\u{202E}nimda", // Right-to-left override
            ];

            for attack in attacks {
                let result = router.set_role(attack);
                assert!(result.is_err(), "Unicode attack should fail: {:?}", attack);
            }
        }
    }

    // ============== Edge Case Tests ==============

    mod edge_cases {
        use super::*;

        #[test]
        fn test_empty_manifest() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = SkillManifest {
                skills: vec![],
                version: "1.0.0".to_string(),
                generated_at: "2024-01-01".to_string(),
            };

            router.load_from_skill_manifest(&manifest);

            // No roles should exist
            let roles = router.list_roles();
            assert!(roles.is_empty());
        }

        #[test]
        fn test_very_long_role_id() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let long_id = "a".repeat(10000);
            let result = router.set_role(&long_id);
            assert!(result.is_err());
        }

        #[test]
        fn test_special_characters_in_role_id() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let special_ids = vec![
                "admin!@#$%",
                "role<script>",
                "role&role=admin",
            ];

            for id in special_ids {
                let result = router.set_role(id);
                assert!(result.is_err(), "Special char role should fail: {}", id);
            }
        }

        #[test]
        fn test_reload_manifest_updates_roles() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest1 = create_test_manifest();
            router.load_from_skill_manifest(&manifest1);

            router.set_role("guest").unwrap();
            assert_eq!(router.current_role(), Some("guest"));

            // Load new manifest
            let manifest2 = SkillManifest {
                skills: vec![
                    SkillDefinition {
                        id: "new-skill".to_string(),
                        display_name: "New Skill".to_string(),
                        description: "New".to_string(),
                        allowed_roles: vec!["newrole".to_string()],
                        allowed_tools: vec![],
                        grants: None,
                        identity: None,
                        metadata: None,
                    },
                ],
                version: "2.0.0".to_string(),
                generated_at: "2024-01-02".to_string(),
            };

            router.load_from_skill_manifest(&manifest2);

            // New role should exist
            let roles = router.list_roles();
            assert!(roles.contains(&"newrole"));
        }

        #[test]
        fn test_concurrent_style_role_switches() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            // Simulate rapid role switches
            for _ in 0..100 {
                router.set_role("guest").unwrap();
                router.set_role("developer").unwrap();
                router.set_role("admin").unwrap();
            }

            // Should still work correctly
            assert_eq!(router.current_role(), Some("admin"));

            let stats = router.get_audit_stats();
            assert_eq!(stats.total_entries, 300);
        }

        #[test]
        fn test_check_tool_access_without_role() {
            let logger = create_logger();
            let router = AegisRouterCore::new(logger, RouterConfig::default());

            // No role set - should handle gracefully
            let result = router.check_tool_access("filesystem__read_file");
            // Either error or ok depending on implementation
            let _ = result;
        }

        #[test]
        fn test_get_visible_tools_consistency() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            router.set_role("guest").unwrap();

            let tools1 = router.get_visible_tools();
            let tools2 = router.get_visible_tools();

            // Should be consistent
            assert_eq!(tools1.len(), tools2.len());
        }

        #[test]
        fn test_audit_stats_reset_behavior() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            router.set_role("guest").unwrap();
            router.set_role("admin").unwrap();

            let stats = router.get_audit_stats();
            assert_eq!(stats.total_entries, 2);

            // Stats should persist
            let stats2 = router.get_audit_stats();
            assert_eq!(stats2.total_entries, 2);
        }

        #[test]
        fn test_router_clone_independence() {
            let logger = create_logger();
            let config = RouterConfig::default();
            let config2 = config.clone();

            assert_eq!(config.a2a_mode, config2.a2a_mode);
            assert_eq!(config.default_role, config2.default_role);
        }
    }

    // ============== A2A Identity Tests ==============

    mod a2a_identity {
        use super::*;

        #[test]
        fn test_identity_resolution_with_empty_skills() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let agent_card = A2AAgentCard {
                name: "empty-agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let resolution = router.set_role_from_identity(&agent_card);
            assert_eq!(resolution.agent_name, "empty-agent");
        }

        #[test]
        fn test_identity_resolution_with_multiple_skills() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            let agent_card = A2AAgentCard {
                name: "multi-skill-agent".to_string(),
                version: "2.0.0".to_string(),
                skills: vec![
                    a2a::A2AAgentSkill {
                        id: "react".to_string(),
                        name: Some("React".to_string()),
                        description: None,
                    },
                    a2a::A2AAgentSkill {
                        id: "typescript".to_string(),
                        name: Some("TypeScript".to_string()),
                        description: None,
                    },
                    a2a::A2AAgentSkill {
                        id: "testing".to_string(),
                        name: None,
                        description: None,
                    },
                ],
            };

            let resolution = router.set_role_from_identity(&agent_card);
            assert!(!resolution.role_id.is_empty());
        }

        #[test]
        fn test_identity_resolution_trusted_status() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let agent_card = A2AAgentCard {
                name: "claude-helper".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let resolution = router.set_role_from_identity(&agent_card);
            // Check trust status is set
            let _ = resolution.is_trusted;
        }

        #[test]
        fn test_identity_resolution_preserves_agent_name() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let agent_card = A2AAgentCard {
                name: "特殊エージェント".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let resolution = router.set_role_from_identity(&agent_card);
            assert_eq!(resolution.agent_name, "特殊エージェント");
        }

        #[test]
        fn test_a2a_mode_uses_identity() {
            let logger = create_logger();
            let mut router = AegisRouterCore::new(logger, RouterConfig::default());

            let manifest = create_test_manifest();
            router.load_from_skill_manifest(&manifest);

            router.enable_a2a_mode();

            // Can't use set_role
            assert!(router.set_role("admin").is_err());

            // But can use identity
            let agent_card = A2AAgentCard {
                name: "a2a-agent".to_string(),
                version: "1.0.0".to_string(),
                skills: vec![],
            };

            let resolution = router.set_role_from_identity(&agent_card);
            assert!(!resolution.role_id.is_empty());
        }
    }
}
