//! # AEGIS Adapter Layer
//!
//! External system integrations (Hexagonal Architecture adapters).
//!
//! ## Structure
//!
//! - `controller/` - Inbound adapters (CLI, HTTP, MCP)
//! - `gateway/` - Outbound adapters (LLM clients, external APIs)
//! - `repository/` - Persistence implementations

pub mod controller;
pub mod gateway;
pub mod repository;
