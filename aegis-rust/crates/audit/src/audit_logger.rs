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
