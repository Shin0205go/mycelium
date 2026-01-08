//! AuditLogger - Audit logging for AEGIS

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub timestamp: String,
    pub event_type: AuditEventType,
    pub role_id: String,
    pub tool_name: Option<String>,
    pub server_name: Option<String>,
    pub success: bool,
    pub reason: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Types of audit events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    RoleSwitch,
    ToolCall,
    ToolDenied,
    ServerAccess,
    ServerDenied,
    RateLimited,
}

/// Audit logger
#[derive(Debug)]
pub struct AuditLogger {
    entries: VecDeque<AuditEntry>,
    max_entries: usize,
}

impl AuditLogger {
    /// Create a new AuditLogger
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: VecDeque::with_capacity(max_entries),
            max_entries,
        }
    }

    /// Log an audit entry
    pub fn log(&mut self, entry: AuditEntry) {
        if self.entries.len() >= self.max_entries {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    /// Log a role switch
    pub fn log_role_switch(&mut self, from_role: &str, to_role: &str) {
        self.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: AuditEventType::RoleSwitch,
            role_id: to_role.to_string(),
            tool_name: None,
            server_name: None,
            success: true,
            reason: Some(format!("Switched from '{}'", from_role)),
            metadata: None,
        });
    }

    /// Log a tool call
    pub fn log_tool_call(&mut self, role_id: &str, tool_name: &str, success: bool, reason: Option<&str>) {
        self.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: if success { AuditEventType::ToolCall } else { AuditEventType::ToolDenied },
            role_id: role_id.to_string(),
            tool_name: Some(tool_name.to_string()),
            server_name: None,
            success,
            reason: reason.map(|s| s.to_string()),
            metadata: None,
        });
    }

    /// Get recent entries
    pub fn get_recent(&self, limit: usize) -> Vec<&AuditEntry> {
        self.entries.iter().rev().take(limit).collect()
    }

    /// Get recent denials
    pub fn get_recent_denials(&self, limit: usize) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .rev()
            .filter(|e| !e.success)
            .take(limit)
            .collect()
    }

    /// Get statistics
    pub fn get_stats(&self) -> AuditStats {
        let total = self.entries.len();
        let denials = self.entries.iter().filter(|e| !e.success).count();

        AuditStats {
            total_entries: total,
            denial_count: denials,
        }
    }

    /// Export as JSON
    pub fn export_json(&self) -> serde_json::Value {
        serde_json::to_value(&self.entries.iter().collect::<Vec<_>>()).unwrap_or_default()
    }
}

/// Audit statistics
#[derive(Debug, Clone)]
pub struct AuditStats {
    pub total_entries: usize,
    pub denial_count: usize,
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self::new(10000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_entry() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "filesystem__read_file", true, None);

        let stats = logger.get_stats();
        assert_eq!(stats.total_entries, 1);
        assert_eq!(stats.denial_count, 0);
    }

    #[test]
    fn test_log_role_switch() {
        let mut logger = AuditLogger::new(100);

        logger.log_role_switch("guest", "admin");

        let recent = logger.get_recent(1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].role_id, "admin");
        assert!(recent[0].reason.as_ref().unwrap().contains("guest"));
    }

    #[test]
    fn test_log_denied() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("guest", "admin__delete_all", false, Some("Permission denied"));

        let stats = logger.get_stats();
        assert_eq!(stats.denial_count, 1);

        let denials = logger.get_recent_denials(10);
        assert_eq!(denials.len(), 1);
        assert_eq!(denials[0].tool_name, Some("admin__delete_all".to_string()));
    }

    #[test]
    fn test_max_entries_limit() {
        let mut logger = AuditLogger::new(3);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("admin", "tool2", true, None);
        logger.log_tool_call("admin", "tool3", true, None);
        logger.log_tool_call("admin", "tool4", true, None);

        let stats = logger.get_stats();
        assert_eq!(stats.total_entries, 3);

        // Oldest entry should be removed
        let recent = logger.get_recent(10);
        let tool_names: Vec<_> = recent.iter()
            .filter_map(|e| e.tool_name.as_ref())
            .collect();
        assert!(!tool_names.contains(&&"tool1".to_string()));
    }

    #[test]
    fn test_get_recent() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("admin", "tool2", true, None);
        logger.log_tool_call("admin", "tool3", true, None);

        let recent = logger.get_recent(2);
        assert_eq!(recent.len(), 2);
        // Most recent should be first
        assert_eq!(recent[0].tool_name, Some("tool3".to_string()));
        assert_eq!(recent[1].tool_name, Some("tool2".to_string()));
    }

    #[test]
    fn test_get_recent_denials_only() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("guest", "tool2", false, Some("Denied"));
        logger.log_tool_call("admin", "tool3", true, None);
        logger.log_tool_call("guest", "tool4", false, Some("Denied"));

        let denials = logger.get_recent_denials(10);
        assert_eq!(denials.len(), 2);
        assert!(denials.iter().all(|e| !e.success));
    }

    #[test]
    fn test_export_json() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("guest", "tool2", false, Some("Denied"));

        let json = logger.export_json();
        assert!(json.is_array());
        assert_eq!(json.as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_event_types() {
        let mut logger = AuditLogger::new(100);

        // Tool call success
        logger.log_tool_call("admin", "tool", true, None);
        let recent = logger.get_recent(1);
        assert!(matches!(recent[0].event_type, AuditEventType::ToolCall));

        // Tool call denied
        logger.log_tool_call("guest", "tool", false, Some("Denied"));
        let recent = logger.get_recent(1);
        assert!(matches!(recent[0].event_type, AuditEventType::ToolDenied));

        // Role switch
        logger.log_role_switch("guest", "admin");
        let recent = logger.get_recent(1);
        assert!(matches!(recent[0].event_type, AuditEventType::RoleSwitch));
    }

    #[test]
    fn test_default_max_entries() {
        let logger = AuditLogger::default();
        assert_eq!(logger.max_entries, 10000);
    }
}
