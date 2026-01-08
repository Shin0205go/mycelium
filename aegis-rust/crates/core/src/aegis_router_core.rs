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
    use shared::NullLogger;

    #[test]
    fn test_router_creation() {
        let logger = Arc::new(NullLogger);
        let router = AegisRouterCore::new(logger, RouterConfig::default());

        assert!(!router.is_a2a_mode());
        assert!(router.current_role().is_none());
    }
}
