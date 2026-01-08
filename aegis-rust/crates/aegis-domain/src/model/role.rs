//! Role - The職能 (class) of an agent
//!
//! Role is a Value Object - two roles with the same variant are equal.
//! Roles define WHAT an agent does, not WHO it is.

/// The four fundamental roles in AEGIS
///
/// These map to the TRPG-inspired model:
/// - Architect = Game Master's planning phase
/// - Worker = Player executing actions
/// - Verifier = Rules lawyer checking validity
/// - Router = The Game Master itself (special, not assignable to agents)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// Plans and decomposes missions into tasks
    /// Like a PM or upstream designer
    Architect,

    /// Executes tasks (coding, research, writing)
    /// Like an implementer or writer
    Worker,

    /// Audits artifacts for quality and safety
    /// Like QA or an auditor
    Verifier,
}

impl Role {
    /// Get the display name of this role
    pub fn display_name(&self) -> &'static str {
        match self {
            Role::Architect => "Architect",
            Role::Worker => "Worker",
            Role::Verifier => "Verifier",
        }
    }

    /// Get a description of this role's responsibility
    pub fn description(&self) -> &'static str {
        match self {
            Role::Architect => {
                "Plans missions, decomposes into tasks, designs solutions"
            }
            Role::Worker => {
                "Executes tasks, produces artifacts (code, data, reports)"
            }
            Role::Verifier => {
                "Audits artifacts for correctness, safety, and compliance"
            }
        }
    }

    /// Get all roles (useful for iteration)
    pub fn all() -> &'static [Role] {
        &[Role::Architect, Role::Worker, Role::Verifier]
    }
}

impl core::fmt::Display for Role {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_equality() {
        // Value Object: same variant = equal
        assert_eq!(Role::Architect, Role::Architect);
        assert_ne!(Role::Architect, Role::Worker);
    }

    #[test]
    fn test_all_roles() {
        let roles = Role::all();
        assert_eq!(roles.len(), 3);
    }
}
