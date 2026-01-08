//! RateLimiter - Rate limiting for AEGIS

use std::collections::HashMap;

/// Rate limit quota configuration
#[derive(Debug, Clone)]
pub struct RoleQuota {
    pub max_calls_per_minute: usize,
    pub max_calls_per_hour: usize,
    pub max_concurrent: usize,
    pub tool_limits: HashMap<String, ToolQuota>,
}

/// Per-tool quota
#[derive(Debug, Clone)]
pub struct ToolQuota {
    pub max_calls_per_minute: usize,
}

/// Rate limiter
#[derive(Debug, Default)]
pub struct RateLimiter {
    quotas: HashMap<String, RoleQuota>,
    // TODO: Add actual rate tracking with timestamps
}

impl RateLimiter {
    /// Create a new RateLimiter
    pub fn new() -> Self {
        Self::default()
    }

    /// Set quota for a role
    pub fn set_quota(&mut self, role_id: impl Into<String>, quota: RoleQuota) {
        self.quotas.insert(role_id.into(), quota);
    }

    /// Check if a call is allowed
    pub fn check(&self, role_id: &str, _tool_name: &str) -> RateLimitResult {
        // TODO: Implement actual rate limiting logic
        if self.quotas.contains_key(role_id) {
            RateLimitResult::Allowed
        } else {
            RateLimitResult::Allowed // No quota = no limit
        }
    }

    /// Record a call
    pub fn record_call(&mut self, _role_id: &str, _tool_name: &str) {
        // TODO: Implement call tracking
    }
}

/// Result of rate limit check
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitResult {
    Allowed,
    Denied { reason: String, retry_after_secs: u64 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_rate_limiter() {
        let limiter = RateLimiter::new();
        assert!(limiter.quotas.is_empty());
    }

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
    fn test_check_allows_when_no_quota() {
        let limiter = RateLimiter::new();

        let result = limiter.check("unknown_role", "some_tool");
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

        let result = limiter.check("guest", "any_tool");
        assert_eq!(result, RateLimitResult::Allowed);
    }

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

        // The check should pass (full implementation would track calls)
        let result = limiter.check("user", "expensive_tool");
        assert_eq!(result, RateLimitResult::Allowed);
    }

    #[test]
    fn test_rate_limit_result_variants() {
        let allowed = RateLimitResult::Allowed;
        assert_eq!(allowed, RateLimitResult::Allowed);

        let denied = RateLimitResult::Denied {
            reason: "Too many requests".to_string(),
            retry_after_secs: 60,
        };

        if let RateLimitResult::Denied { reason, retry_after_secs } = denied {
            assert_eq!(reason, "Too many requests");
            assert_eq!(retry_after_secs, 60);
        } else {
            panic!("Expected Denied variant");
        }
    }
}
