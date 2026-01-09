//! RateLimiter - Rate limiting for AEGIS

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Rate limit quota configuration
#[derive(Debug, Clone)]
pub struct RoleQuota {
    pub max_calls_per_minute: usize,
    pub max_calls_per_hour: usize,
    pub max_concurrent: usize,
    pub tool_limits: HashMap<String, ToolQuota>,
}

impl Default for RoleQuota {
    fn default() -> Self {
        Self {
            max_calls_per_minute: 60,
            max_calls_per_hour: 1000,
            max_concurrent: 10,
            tool_limits: HashMap::new(),
        }
    }
}

/// Per-tool quota
#[derive(Debug, Clone)]
pub struct ToolQuota {
    pub max_calls_per_minute: usize,
}

/// Usage tracking for a session
#[derive(Debug, Clone, Default)]
pub struct UsageStats {
    pub calls_this_minute: usize,
    pub calls_this_hour: usize,
    pub calls_this_day: usize,
    pub concurrent: usize,
    pub last_minute_reset: Option<Instant>,
    pub last_hour_reset: Option<Instant>,
}

/// Rate limiter
#[derive(Debug, Default)]
pub struct RateLimiter {
    quotas: HashMap<String, RoleQuota>,
    usage: HashMap<String, UsageStats>,
    enabled: bool,
}

impl RateLimiter {
    /// Create a new RateLimiter
    pub fn new() -> Self {
        Self {
            quotas: HashMap::new(),
            usage: HashMap::new(),
            enabled: true,
        }
    }

    /// Check if rate limiting is enabled
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Enable rate limiting
    pub fn enable(&mut self) {
        self.enabled = true;
    }

    /// Disable rate limiting
    pub fn disable(&mut self) {
        self.enabled = false;
    }

    /// Set quota for a role
    pub fn set_quota(&mut self, role_id: impl Into<String>, quota: RoleQuota) {
        self.quotas.insert(role_id.into(), quota);
    }

    /// Set quotas for multiple roles
    pub fn set_quotas(&mut self, quotas: HashMap<String, RoleQuota>) {
        for (role_id, quota) in quotas {
            self.quotas.insert(role_id, quota);
        }
    }

    /// Get quota for a role
    pub fn get_quota(&self, role_id: &str) -> Option<&RoleQuota> {
        self.quotas.get(role_id)
    }

    /// Check if a call is allowed
    pub fn check(&self, role_id: &str, _session_id: &str, tool_name: Option<&str>) -> RateLimitResult {
        if !self.enabled {
            return RateLimitResult::Allowed;
        }

        let quota = match self.quotas.get(role_id) {
            Some(q) => q,
            None => return RateLimitResult::Allowed, // No quota = no limit
        };

        // Check tool-specific limits
        if let Some(tool) = tool_name {
            if let Some(tool_quota) = quota.tool_limits.get(tool) {
                // Placeholder: actual implementation would check usage
                if tool_quota.max_calls_per_minute == 0 {
                    return RateLimitResult::Denied {
                        reason: format!("Tool '{}' rate limit exceeded", tool),
                        retry_after_secs: 60,
                    };
                }
            }
        }

        RateLimitResult::Allowed
    }

    /// Consume a rate limit credit
    pub fn consume(&mut self, _role_id: &str, session_id: &str, _tool_name: Option<&str>) {
        if !self.enabled {
            return;
        }

        let usage = self.usage.entry(session_id.to_string()).or_default();
        usage.calls_this_minute += 1;
        usage.calls_this_hour += 1;
        usage.calls_this_day += 1;
    }

    /// Start tracking a concurrent operation
    pub fn start_concurrent(&mut self, session_id: &str) {
        if !self.enabled {
            return;
        }

        let usage = self.usage.entry(session_id.to_string()).or_default();
        usage.concurrent += 1;
    }

    /// End tracking a concurrent operation
    pub fn end_concurrent(&mut self, session_id: &str) {
        let usage = self.usage.entry(session_id.to_string()).or_default();
        if usage.concurrent > 0 {
            usage.concurrent -= 1;
        }
    }

    /// Get usage stats for a session
    pub fn get_usage(&self, session_id: &str) -> UsageStats {
        self.usage.get(session_id).cloned().unwrap_or_default()
    }

    /// Reset usage for a session
    pub fn reset_usage(&mut self, session_id: &str) {
        self.usage.remove(session_id);
    }

    /// Reset all usage
    pub fn reset_all_usage(&mut self) {
        self.usage.clear();
    }

    /// Record a call (alias for consume)
    pub fn record_call(&mut self, role_id: &str, tool_name: &str) {
        self.consume(role_id, "default", Some(tool_name));
    }
}

/// Result of rate limit check
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitResult {
    Allowed,
    Denied { reason: String, retry_after_secs: u64 },
}

impl RateLimitResult {
    /// Check if the result is allowed
    pub fn is_allowed(&self) -> bool {
        matches!(self, RateLimitResult::Allowed)
    }

    /// Check if the result is denied
    pub fn is_denied(&self) -> bool {
        matches!(self, RateLimitResult::Denied { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============== Basic Tests ==============

    #[test]
    fn test_create_rate_limiter() {
        let limiter = RateLimiter::new();
        assert!(limiter.quotas.is_empty());
        assert!(limiter.is_enabled());
    }

    #[test]
    fn test_enable_disable() {
        let mut limiter = RateLimiter::new();

        assert!(limiter.is_enabled());

        limiter.disable();
        assert!(!limiter.is_enabled());

        limiter.enable();
        assert!(limiter.is_enabled());
    }

    // ============== Quota Management Tests ==============

    #[test]
    fn test_set_quota() {
        let mut limiter = RateLimiter::new();

        let quota = RoleQuota {
            max_calls_per_minute: 10,
            max_calls_per_hour: 100,
            max_concurrent: 3,
            tool_limits: HashMap::new(),
        };

        limiter.set_quota("guest", quota);
        assert!(limiter.quotas.contains_key("guest"));
    }

    #[test]
    fn test_set_quotas_multiple() {
        let mut limiter = RateLimiter::new();

        let mut quotas = HashMap::new();
        quotas.insert("guest".to_string(), RoleQuota::default());
        quotas.insert("admin".to_string(), RoleQuota::default());

        limiter.set_quotas(quotas);

        assert!(limiter.quotas.contains_key("guest"));
        assert!(limiter.quotas.contains_key("admin"));
    }

    #[test]
    fn test_get_quota() {
        let mut limiter = RateLimiter::new();

        let quota = RoleQuota {
            max_calls_per_minute: 10,
            max_calls_per_hour: 100,
            max_concurrent: 3,
            tool_limits: HashMap::new(),
        };

        limiter.set_quota("guest", quota);

        let retrieved = limiter.get_quota("guest");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().max_calls_per_minute, 10);
    }

    #[test]
    fn test_get_quota_unknown_role() {
        let limiter = RateLimiter::new();
        assert!(limiter.get_quota("unknown").is_none());
    }

    // ============== Check Tests ==============

    #[test]
    fn test_check_allows_when_no_quota() {
        let limiter = RateLimiter::new();

        let result = limiter.check("unknown_role", "session-1", None);
        assert_eq!(result, RateLimitResult::Allowed);
    }

    #[test]
    fn test_check_allows_with_quota() {
        let mut limiter = RateLimiter::new();

        let quota = RoleQuota {
            max_calls_per_minute: 10,
            max_calls_per_hour: 100,
            max_concurrent: 3,
            tool_limits: HashMap::new(),
        };

        limiter.set_quota("guest", quota);

        let result = limiter.check("guest", "session-1", None);
        assert_eq!(result, RateLimitResult::Allowed);
    }

    #[test]
    fn test_check_allows_when_disabled() {
        let mut limiter = RateLimiter::new();
        limiter.set_quota("guest", RoleQuota::default());
        limiter.disable();

        let result = limiter.check("guest", "session-1", None);
        assert!(result.is_allowed());
    }

    // ============== Tool Quota Tests ==============

    #[test]
    fn test_tool_quota() {
        let mut tool_limits = HashMap::new();
        tool_limits.insert("expensive_tool".to_string(), ToolQuota {
            max_calls_per_minute: 2,
        });

        let quota = RoleQuota {
            max_calls_per_minute: 100,
            max_calls_per_hour: 1000,
            max_concurrent: 10,
            tool_limits,
        };

        let mut limiter = RateLimiter::new();
        limiter.set_quota("user", quota);

        let result = limiter.check("user", "session-1", Some("expensive_tool"));
        assert_eq!(result, RateLimitResult::Allowed);
    }

    #[test]
    fn test_tool_with_zero_limit() {
        let mut tool_limits = HashMap::new();
        tool_limits.insert("blocked_tool".to_string(), ToolQuota {
            max_calls_per_minute: 0,
        });

        let quota = RoleQuota {
            max_calls_per_minute: 100,
            max_calls_per_hour: 1000,
            max_concurrent: 10,
            tool_limits,
        };

        let mut limiter = RateLimiter::new();
        limiter.set_quota("user", quota);

        let result = limiter.check("user", "session-1", Some("blocked_tool"));
        assert!(result.is_denied());
    }

    // ============== Usage Tracking Tests ==============

    #[test]
    fn test_consume() {
        let mut limiter = RateLimiter::new();

        limiter.consume("guest", "session-1", None);
        limiter.consume("guest", "session-1", None);

        let usage = limiter.get_usage("session-1");
        assert_eq!(usage.calls_this_minute, 2);
        assert_eq!(usage.calls_this_hour, 2);
        assert_eq!(usage.calls_this_day, 2);
    }

    #[test]
    fn test_consume_disabled() {
        let mut limiter = RateLimiter::new();
        limiter.disable();

        limiter.consume("guest", "session-1", None);

        let usage = limiter.get_usage("session-1");
        assert_eq!(usage.calls_this_minute, 0);
    }

    // ============== Concurrent Tracking Tests ==============

    #[test]
    fn test_start_concurrent() {
        let mut limiter = RateLimiter::new();

        limiter.start_concurrent("session-1");
        limiter.start_concurrent("session-1");

        let usage = limiter.get_usage("session-1");
        assert_eq!(usage.concurrent, 2);
    }

    #[test]
    fn test_end_concurrent() {
        let mut limiter = RateLimiter::new();

        limiter.start_concurrent("session-1");
        limiter.start_concurrent("session-1");
        limiter.end_concurrent("session-1");

        let usage = limiter.get_usage("session-1");
        assert_eq!(usage.concurrent, 1);
    }

    #[test]
    fn test_end_concurrent_no_negative() {
        let mut limiter = RateLimiter::new();

        limiter.end_concurrent("session-1");

        let usage = limiter.get_usage("session-1");
        assert_eq!(usage.concurrent, 0);
    }

    #[test]
    fn test_start_concurrent_disabled() {
        let mut limiter = RateLimiter::new();
        limiter.disable();

        limiter.start_concurrent("session-1");

        let usage = limiter.get_usage("session-1");
        assert_eq!(usage.concurrent, 0);
    }

    // ============== Usage Management Tests ==============

    #[test]
    fn test_get_usage_unknown_session() {
        let limiter = RateLimiter::new();
        let usage = limiter.get_usage("unknown");

        assert_eq!(usage.calls_this_minute, 0);
        assert_eq!(usage.calls_this_hour, 0);
        assert_eq!(usage.concurrent, 0);
    }

    #[test]
    fn test_reset_usage() {
        let mut limiter = RateLimiter::new();

        limiter.consume("guest", "session-1", None);
        limiter.consume("guest", "session-1", None);
        assert_eq!(limiter.get_usage("session-1").calls_this_minute, 2);

        limiter.reset_usage("session-1");
        assert_eq!(limiter.get_usage("session-1").calls_this_minute, 0);
    }

    #[test]
    fn test_reset_all_usage() {
        let mut limiter = RateLimiter::new();

        limiter.consume("guest", "session-1", None);
        limiter.consume("guest", "session-2", None);

        limiter.reset_all_usage();

        assert_eq!(limiter.get_usage("session-1").calls_this_minute, 0);
        assert_eq!(limiter.get_usage("session-2").calls_this_minute, 0);
    }

    // ============== Result Tests ==============

    #[test]
    fn test_rate_limit_result_variants() {
        let allowed = RateLimitResult::Allowed;
        assert!(allowed.is_allowed());
        assert!(!allowed.is_denied());

        let denied = RateLimitResult::Denied {
            reason: "Too many requests".to_string(),
            retry_after_secs: 60,
        };
        assert!(!denied.is_allowed());
        assert!(denied.is_denied());

        if let RateLimitResult::Denied { reason, retry_after_secs } = denied {
            assert_eq!(reason, "Too many requests");
            assert_eq!(retry_after_secs, 60);
        } else {
            panic!("Expected Denied variant");
        }
    }

    // ============== Default Tests ==============

    #[test]
    fn test_role_quota_default() {
        let quota = RoleQuota::default();
        assert_eq!(quota.max_calls_per_minute, 60);
        assert_eq!(quota.max_calls_per_hour, 1000);
        assert_eq!(quota.max_concurrent, 10);
        assert!(quota.tool_limits.is_empty());
    }

    #[test]
    fn test_usage_stats_default() {
        let usage = UsageStats::default();
        assert_eq!(usage.calls_this_minute, 0);
        assert_eq!(usage.calls_this_hour, 0);
        assert_eq!(usage.calls_this_day, 0);
        assert_eq!(usage.concurrent, 0);
    }

    // ============== Record Call Tests ==============

    #[test]
    fn test_record_call() {
        let mut limiter = RateLimiter::new();

        limiter.record_call("guest", "some_tool");

        let usage = limiter.get_usage("default");
        assert_eq!(usage.calls_this_minute, 1);
    }

    // ============== Multiple Sessions Tests ==============

    #[test]
    fn test_multiple_sessions_isolated() {
        let mut limiter = RateLimiter::new();

        limiter.consume("guest", "session-1", None);
        limiter.consume("guest", "session-1", None);
        limiter.consume("guest", "session-2", None);

        assert_eq!(limiter.get_usage("session-1").calls_this_minute, 2);
        assert_eq!(limiter.get_usage("session-2").calls_this_minute, 1);
    }
}
