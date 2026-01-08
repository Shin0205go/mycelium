//! Skill - A capability that an agent possesses
//!
//! Skill is a Value Object - skills with the same ID are equal.
//! Skills are immutable and describe WHAT an agent can do.

/// Unique identifier for a Skill
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SkillId(String);

impl SkillId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl core::fmt::Display for SkillId {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Skill - A capability declaration
///
/// This maps to the A2A Agent Card "skills" concept.
/// Skills are used for capability-based matching in AEGIS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    /// Unique identifier
    id: SkillId,
    /// Human-readable name
    name: String,
    /// Description of what this skill enables
    description: Option<String>,
    /// Tags for categorization
    tags: Vec<String>,
}

impl Skill {
    /// Create a new Skill
    pub fn new(id: SkillId, name: impl Into<String>) -> Self {
        Self {
            id,
            name: name.into(),
            description: None,
            tags: Vec::new(),
        }
    }

    /// Builder: add description
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Builder: add tags
    pub fn with_tags(mut self, tags: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.tags = tags.into_iter().map(|t| t.into()).collect();
        self
    }

    // ========== Getters ==========

    pub fn id(&self) -> &SkillId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    pub fn tags(&self) -> &[String] {
        &self.tags
    }
}

/// Common skills used in AEGIS
impl Skill {
    /// Create a "coding" skill
    pub fn coding() -> Self {
        Self::new(SkillId::new("coding"), "Coding")
            .with_description("General programming ability")
    }

    /// Create a "react" skill
    pub fn react() -> Self {
        Self::new(SkillId::new("react"), "React Development")
            .with_description("React.js frontend development")
            .with_tags(["frontend", "javascript"])
    }

    /// Create a "rust" skill
    pub fn rust() -> Self {
        Self::new(SkillId::new("rust"), "Rust Development")
            .with_description("Rust systems programming")
            .with_tags(["systems", "backend"])
    }

    /// Create an "analysis" skill
    pub fn analysis() -> Self {
        Self::new(SkillId::new("analysis"), "Data Analysis")
            .with_description("Data analysis and reporting")
            .with_tags(["data", "reporting"])
    }

    /// Create a "review" skill
    pub fn review() -> Self {
        Self::new(SkillId::new("review"), "Code Review")
            .with_description("Code review and quality assurance")
            .with_tags(["qa", "review"])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_creation() {
        let skill = Skill::new(SkillId::new("rust"), "Rust Programming")
            .with_description("Systems programming with Rust")
            .with_tags(["systems", "backend"]);

        assert_eq!(skill.id().as_str(), "rust");
        assert_eq!(skill.name(), "Rust Programming");
        assert_eq!(skill.description(), Some("Systems programming with Rust"));
        assert_eq!(skill.tags(), &["systems", "backend"]);
    }

    #[test]
    fn test_value_object_equality() {
        let skill1 = Skill::new(SkillId::new("rust"), "Rust");
        let skill2 = Skill::new(SkillId::new("rust"), "Rust");

        // Value Object: same content = equal
        assert_eq!(skill1, skill2);
    }

    #[test]
    fn test_predefined_skills() {
        let rust = Skill::rust();
        assert_eq!(rust.id().as_str(), "rust");

        let react = Skill::react();
        assert!(react.tags().contains(&"frontend".to_string()));
    }
}
