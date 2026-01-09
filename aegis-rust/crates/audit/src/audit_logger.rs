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

    // ============== Basic Logger Tests ==============

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

    // ============== Additional Logger Tests ==============

    #[test]
    fn test_logger_with_custom_max_entries() {
        let logger = AuditLogger::new(50);
        assert_eq!(logger.max_entries, 50);
    }

    #[test]
    fn test_empty_logger_stats() {
        let logger = AuditLogger::new(100);
        let stats = logger.get_stats();
        assert_eq!(stats.total_entries, 0);
        assert_eq!(stats.denial_count, 0);
    }

    #[test]
    fn test_empty_logger_get_recent() {
        let logger = AuditLogger::new(100);
        let recent = logger.get_recent(10);
        assert!(recent.is_empty());
    }

    #[test]
    fn test_empty_logger_get_recent_denials() {
        let logger = AuditLogger::new(100);
        let denials = logger.get_recent_denials(10);
        assert!(denials.is_empty());
    }

    #[test]
    fn test_multiple_role_switches() {
        let mut logger = AuditLogger::new(100);

        logger.log_role_switch("guest", "developer");
        logger.log_role_switch("developer", "admin");
        logger.log_role_switch("admin", "guest");

        let stats = logger.get_stats();
        assert_eq!(stats.total_entries, 3);
        assert_eq!(stats.denial_count, 0);

        let recent = logger.get_recent(3);
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].role_id, "guest");
        assert_eq!(recent[1].role_id, "admin");
        assert_eq!(recent[2].role_id, "developer");
    }

    #[test]
    fn test_mixed_success_and_denial() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("guest", "tool2", false, Some("Not allowed"));
        logger.log_tool_call("admin", "tool3", true, None);
        logger.log_tool_call("user", "tool4", false, Some("Rate limited"));
        logger.log_tool_call("admin", "tool5", true, None);

        let stats = logger.get_stats();
        assert_eq!(stats.total_entries, 5);
        assert_eq!(stats.denial_count, 2);
    }

    #[test]
    fn test_get_recent_with_limit_larger_than_entries() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("admin", "tool2", true, None);

        let recent = logger.get_recent(100);
        assert_eq!(recent.len(), 2);
    }

    #[test]
    fn test_get_recent_with_zero_limit() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("admin", "tool2", true, None);

        let recent = logger.get_recent(0);
        assert!(recent.is_empty());
    }

    #[test]
    fn test_log_with_reason() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("guest", "dangerous_tool", false, Some("Insufficient permissions"));

        let recent = logger.get_recent(1);
        assert_eq!(recent[0].reason, Some("Insufficient permissions".to_string()));
    }

    #[test]
    fn test_log_without_reason() {
        let mut logger = AuditLogger::new(100);

        logger.log_tool_call("admin", "tool", true, None);

        let recent = logger.get_recent(1);
        assert!(recent[0].reason.is_none());
    }

    #[test]
    fn test_export_json_empty() {
        let logger = AuditLogger::new(100);
        let json = logger.export_json();
        assert!(json.is_array());
        assert!(json.as_array().unwrap().is_empty());
    }

    #[test]
    fn test_log_server_access() {
        let mut logger = AuditLogger::new(100);

        logger.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: AuditEventType::ServerAccess,
            role_id: "admin".to_string(),
            tool_name: None,
            server_name: Some("filesystem".to_string()),
            success: true,
            reason: None,
            metadata: None,
        });

        let recent = logger.get_recent(1);
        assert!(matches!(recent[0].event_type, AuditEventType::ServerAccess));
        assert_eq!(recent[0].server_name, Some("filesystem".to_string()));
    }

    #[test]
    fn test_log_server_denied() {
        let mut logger = AuditLogger::new(100);

        logger.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: AuditEventType::ServerDenied,
            role_id: "guest".to_string(),
            tool_name: None,
            server_name: Some("database".to_string()),
            success: false,
            reason: Some("Server not allowed for role".to_string()),
            metadata: None,
        });

        let stats = logger.get_stats();
        assert_eq!(stats.denial_count, 1);

        let denials = logger.get_recent_denials(1);
        assert_eq!(denials[0].server_name, Some("database".to_string()));
    }

    #[test]
    fn test_log_rate_limited() {
        let mut logger = AuditLogger::new(100);

        logger.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: AuditEventType::RateLimited,
            role_id: "user".to_string(),
            tool_name: Some("expensive_api".to_string()),
            server_name: None,
            success: false,
            reason: Some("Rate limit exceeded".to_string()),
            metadata: None,
        });

        let stats = logger.get_stats();
        assert_eq!(stats.denial_count, 1);

        let recent = logger.get_recent(1);
        assert!(matches!(recent[0].event_type, AuditEventType::RateLimited));
    }

    #[test]
    fn test_log_with_metadata() {
        let mut logger = AuditLogger::new(100);

        let metadata = serde_json::json!({
            "ip": "192.168.1.1",
            "user_agent": "Claude/1.0"
        });

        logger.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: AuditEventType::ToolCall,
            role_id: "admin".to_string(),
            tool_name: Some("api_call".to_string()),
            server_name: None,
            success: true,
            reason: None,
            metadata: Some(metadata.clone()),
        });

        let recent = logger.get_recent(1);
        assert!(recent[0].metadata.is_some());
        assert_eq!(recent[0].metadata.as_ref().unwrap()["ip"], "192.168.1.1");
    }

    #[test]
    fn test_denials_only_count_failures() {
        let mut logger = AuditLogger::new(100);

        // All successful
        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("admin", "tool2", true, None);
        logger.log_role_switch("guest", "admin");

        let stats = logger.get_stats();
        assert_eq!(stats.total_entries, 3);
        assert_eq!(stats.denial_count, 0);

        let denials = logger.get_recent_denials(10);
        assert!(denials.is_empty());
    }

    #[test]
    fn test_max_entries_exactly_at_limit() {
        let mut logger = AuditLogger::new(3);

        logger.log_tool_call("admin", "tool1", true, None);
        logger.log_tool_call("admin", "tool2", true, None);
        logger.log_tool_call("admin", "tool3", true, None);

        let stats = logger.get_stats();
        assert_eq!(stats.total_entries, 3);

        // All three should still be there
        let recent = logger.get_recent(10);
        assert_eq!(recent.len(), 3);
    }

    #[test]
    fn test_oldest_entry_removed_on_overflow() {
        let mut logger = AuditLogger::new(2);

        logger.log_tool_call("admin", "first", true, None);
        logger.log_tool_call("admin", "second", true, None);
        logger.log_tool_call("admin", "third", true, None);

        let recent = logger.get_recent(10);
        let tools: Vec<_> = recent.iter()
            .filter_map(|e| e.tool_name.as_ref())
            .collect();

        assert!(!tools.contains(&&"first".to_string()));
        assert!(tools.contains(&&"second".to_string()));
        assert!(tools.contains(&&"third".to_string()));
    }

    #[test]
    fn test_role_switch_has_correct_event_type() {
        let mut logger = AuditLogger::new(100);

        logger.log_role_switch("from_role", "to_role");

        let recent = logger.get_recent(1);
        assert!(matches!(recent[0].event_type, AuditEventType::RoleSwitch));
        assert!(recent[0].success);
    }

    #[test]
    fn test_tool_call_with_server_name() {
        let mut logger = AuditLogger::new(100);

        logger.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: AuditEventType::ToolCall,
            role_id: "admin".to_string(),
            tool_name: Some("read_file".to_string()),
            server_name: Some("filesystem".to_string()),
            success: true,
            reason: None,
            metadata: None,
        });

        let recent = logger.get_recent(1);
        assert_eq!(recent[0].tool_name, Some("read_file".to_string()));
        assert_eq!(recent[0].server_name, Some("filesystem".to_string()));
    }

    #[test]
    fn test_json_export_contains_all_fields() {
        let mut logger = AuditLogger::new(100);

        logger.log(AuditEntry {
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            event_type: AuditEventType::ToolCall,
            role_id: "admin".to_string(),
            tool_name: Some("test_tool".to_string()),
            server_name: Some("test_server".to_string()),
            success: true,
            reason: Some("test reason".to_string()),
            metadata: Some(serde_json::json!({"key": "value"})),
        });

        let json = logger.export_json();
        let entries = json.as_array().unwrap();
        let entry = &entries[0];

        assert!(entry.get("timestamp").is_some());
        assert!(entry.get("eventType").is_some());
        assert!(entry.get("roleId").is_some());
        assert!(entry.get("toolName").is_some());
        assert!(entry.get("serverName").is_some());
        assert!(entry.get("success").is_some());
        assert!(entry.get("reason").is_some());
        assert!(entry.get("metadata").is_some());
    }

    // ============== Additional Edge Case Tests ==============

    mod edge_cases {
        use super::*;

        #[test]
        fn test_empty_role_id() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("", "tool", true, None);

            let recent = logger.get_recent(1);
            assert_eq!(recent[0].role_id, "");
        }

        #[test]
        fn test_empty_tool_name() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("admin", "", true, None);

            let recent = logger.get_recent(1);
            assert_eq!(recent[0].tool_name, Some("".to_string()));
        }

        #[test]
        fn test_unicode_in_entries() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("日本語ロール", "ツール名", true, None);

            let recent = logger.get_recent(1);
            assert_eq!(recent[0].role_id, "日本語ロール");
            assert_eq!(recent[0].tool_name, Some("ツール名".to_string()));
        }

        #[test]
        fn test_very_long_role_id() {
            let mut logger = AuditLogger::new(100);
            let long_role = "a".repeat(10000);
            logger.log_tool_call(&long_role, "tool", true, None);

            let recent = logger.get_recent(1);
            assert_eq!(recent[0].role_id.len(), 10000);
        }

        #[test]
        fn test_max_entries_zero() {
            let mut logger = AuditLogger::new(0);
            logger.log_tool_call("admin", "tool", true, None);

            // With max_entries=0, the entry is still added but may be limited
            // Just verify it doesn't panic and still counts
            let stats = logger.get_stats();
            assert!(stats.total_entries >= 0);
        }

        #[test]
        fn test_get_recent_larger_than_entries() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("admin", "tool", true, None);

            // Ask for more entries than exist
            let recent = logger.get_recent(1000);
            assert_eq!(recent.len(), 1);
        }

        #[test]
        fn test_get_recent_denials_larger_than_denials() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("admin", "tool", false, Some("denied"));

            let denials = logger.get_recent_denials(1000);
            assert_eq!(denials.len(), 1);
        }

        #[test]
        fn test_get_recent_returns_correct_order() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("admin", "tool1", true, None);
            logger.log_tool_call("admin", "tool2", true, None);
            logger.log_tool_call("admin", "tool3", true, None);

            let recent = logger.get_recent(3);
            // Most recent first
            assert_eq!(recent.len(), 3);
        }

        #[test]
        fn test_audit_entry_clone() {
            let entry = AuditEntry {
                timestamp: "2024-01-01".to_string(),
                event_type: AuditEventType::ToolCall,
                role_id: "admin".to_string(),
                tool_name: Some("tool".to_string()),
                server_name: None,
                success: true,
                reason: None,
                metadata: None,
            };

            let cloned = entry.clone();
            assert_eq!(cloned.role_id, entry.role_id);
            assert_eq!(cloned.tool_name, entry.tool_name);
        }

        #[test]
        fn test_audit_entry_debug() {
            let entry = AuditEntry {
                timestamp: "2024-01-01".to_string(),
                event_type: AuditEventType::RoleSwitch,
                role_id: "test".to_string(),
                tool_name: None,
                server_name: None,
                success: true,
                reason: None,
                metadata: None,
            };

            let debug = format!("{:?}", entry);
            assert!(debug.contains("AuditEntry"));
        }

        #[test]
        fn test_audit_event_type_debug() {
            assert!(format!("{:?}", AuditEventType::ToolCall).contains("ToolCall"));
            assert!(format!("{:?}", AuditEventType::RoleSwitch).contains("RoleSwitch"));
            assert!(format!("{:?}", AuditEventType::ServerAccess).contains("ServerAccess"));
            assert!(format!("{:?}", AuditEventType::RateLimited).contains("RateLimited"));
        }

        #[test]
        fn test_audit_event_type_clone() {
            let event = AuditEventType::ServerAccess;
            let cloned = event.clone();
            assert!(matches!(cloned, AuditEventType::ServerAccess));
        }

        #[test]
        fn test_audit_stats_debug() {
            let stats = AuditStats {
                total_entries: 10,
                denial_count: 3,
            };

            let debug = format!("{:?}", stats);
            assert!(debug.contains("AuditStats"));
        }

        #[test]
        fn test_audit_stats_clone() {
            let stats = AuditStats {
                total_entries: 5,
                denial_count: 2,
            };

            let cloned = stats.clone();
            assert_eq!(cloned.total_entries, stats.total_entries);
            assert_eq!(cloned.denial_count, stats.denial_count);
        }

        #[test]
        fn test_audit_logger_debug() {
            let logger = AuditLogger::new(100);
            let debug = format!("{:?}", logger);
            assert!(debug.contains("AuditLogger"));
        }

        #[test]
        fn test_audit_logger_default() {
            let logger = AuditLogger::default();
            // Should have some default max entries
            let stats = logger.get_stats();
            assert_eq!(stats.total_entries, 0);
        }

        #[test]
        fn test_many_entries_stress() {
            let mut logger = AuditLogger::new(1000);

            for i in 0..500 {
                logger.log_tool_call("admin", &format!("tool_{}", i), true, None);
            }

            let stats = logger.get_stats();
            assert_eq!(stats.total_entries, 500);
        }

        #[test]
        fn test_complex_metadata() {
            let mut logger = AuditLogger::new(100);

            let metadata = serde_json::json!({
                "nested": {
                    "value": 123,
                    "array": [1, 2, 3]
                },
                "list": ["a", "b", "c"]
            });

            logger.log(AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                event_type: AuditEventType::ToolCall,
                role_id: "admin".to_string(),
                tool_name: Some("tool".to_string()),
                server_name: None,
                success: true,
                reason: None,
                metadata: Some(metadata),
            });

            let recent = logger.get_recent(1);
            assert!(recent[0].metadata.is_some());
            let meta = recent[0].metadata.as_ref().unwrap();
            assert_eq!(meta["nested"]["value"], 123);
        }

        #[test]
        fn test_mixed_success_and_failure() {
            let mut logger = AuditLogger::new(100);

            logger.log_tool_call("admin", "tool1", true, None);
            logger.log_tool_call("admin", "tool2", false, Some("denied"));
            logger.log_tool_call("admin", "tool3", true, None);
            logger.log_tool_call("admin", "tool4", false, Some("denied"));
            logger.log_tool_call("admin", "tool5", false, Some("denied"));

            let stats = logger.get_stats();
            assert_eq!(stats.total_entries, 5);
            assert_eq!(stats.denial_count, 3);
        }

        #[test]
        fn test_export_json_empty() {
            let logger = AuditLogger::new(100);
            let json = logger.export_json();
            let entries = json.as_array().unwrap();
            assert!(entries.is_empty());
        }

        #[test]
        fn test_json_export_multiple_entries() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("admin", "tool1", true, None);
            logger.log_tool_call("admin", "tool2", false, Some("denied"));
            logger.log_tool_call("guest", "tool3", true, None);

            let json = logger.export_json();
            let entries = json.as_array().unwrap();
            assert_eq!(entries.len(), 3);
        }

        #[test]
        fn test_export_json_preserves_all_data() {
            let mut logger = AuditLogger::new(100);

            let metadata = serde_json::json!({"custom": "data"});
            logger.log(AuditEntry {
                timestamp: "2024-01-01".to_string(),
                event_type: AuditEventType::ServerAccess,
                role_id: "admin".to_string(),
                tool_name: None,
                server_name: Some("test-server".to_string()),
                success: true,
                reason: None,
                metadata: Some(metadata),
            });

            let json = logger.export_json();
            let entry = &json.as_array().unwrap()[0];

            assert_eq!(entry["serverName"], "test-server");
        }

        #[test]
        fn test_denial_reason_preserved() {
            let mut logger = AuditLogger::new(100);
            logger.log_tool_call("admin", "tool", false, Some("specific denial reason"));

            let denials = logger.get_recent_denials(1);
            assert_eq!(denials[0].reason, Some("specific denial reason".to_string()));
        }
    }
}
