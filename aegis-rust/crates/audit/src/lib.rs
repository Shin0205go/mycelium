//! # AEGIS Audit
//!
//! Audit logging and rate limiting for AEGIS.

mod audit_logger;
mod rate_limiter;

pub use audit_logger::{AuditLogger, AuditEntry, AuditEventType, AuditStats};
pub use rate_limiter::{RateLimiter, RateLimitResult, RoleQuota, ToolQuota};
