//! Artifact - A produced output from an agent's work
//!
//! Artifact is a Value Object - identical content = identical artifact.
//! Artifacts are immutable once created.

/// The kind of artifact produced
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArtifactKind {
    /// Source code
    Code {
        /// Programming language
        language: String,
        /// File path (if applicable)
        path: Option<String>,
    },
    /// Documentation or report
    Document {
        /// Format (markdown, html, etc.)
        format: String,
    },
    /// Raw data (JSON, CSV, etc.)
    Data {
        /// Data format
        format: String,
    },
    /// Analysis or review result
    Analysis {
        /// What was analyzed
        subject: String,
    },
    /// Test results
    TestResult {
        /// Number of passed tests
        passed: usize,
        /// Number of failed tests
        failed: usize,
    },
    /// Generic artifact
    Other {
        /// Type description
        type_name: String,
    },
}

/// Artifact - An output produced by an agent
///
/// Artifacts are stored in the Mission and persist across handoffs.
/// They represent the tangible results of work done.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Artifact {
    /// What kind of artifact this is
    kind: ArtifactKind,
    /// Human-readable name
    name: String,
    /// The actual content
    content: String,
    /// Who produced this
    produced_by: String,
}

impl Artifact {
    /// Create a new Artifact
    pub fn new(
        kind: ArtifactKind,
        name: impl Into<String>,
        content: impl Into<String>,
        produced_by: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            name: name.into(),
            content: content.into(),
            produced_by: produced_by.into(),
        }
    }

    // ========== Convenience Constructors ==========

    /// Create a code artifact
    pub fn code(
        language: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
        produced_by: impl Into<String>,
    ) -> Self {
        Self::new(
            ArtifactKind::Code {
                language: language.into(),
                path: None,
            },
            name,
            content,
            produced_by,
        )
    }

    /// Create a document artifact
    pub fn document(
        format: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
        produced_by: impl Into<String>,
    ) -> Self {
        Self::new(
            ArtifactKind::Document {
                format: format.into(),
            },
            name,
            content,
            produced_by,
        )
    }

    /// Create a test result artifact
    pub fn test_result(
        passed: usize,
        failed: usize,
        name: impl Into<String>,
        content: impl Into<String>,
        produced_by: impl Into<String>,
    ) -> Self {
        Self::new(
            ArtifactKind::TestResult { passed, failed },
            name,
            content,
            produced_by,
        )
    }

    // ========== Getters ==========

    pub fn kind(&self) -> &ArtifactKind {
        &self.kind
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn content(&self) -> &str {
        &self.content
    }

    pub fn produced_by(&self) -> &str {
        &self.produced_by
    }

    // ========== Predicates ==========

    pub fn is_code(&self) -> bool {
        matches!(self.kind, ArtifactKind::Code { .. })
    }

    pub fn is_document(&self) -> bool {
        matches!(self.kind, ArtifactKind::Document { .. })
    }

    pub fn is_test_result(&self) -> bool {
        matches!(self.kind, ArtifactKind::TestResult { .. })
    }

    /// Check if test results are all passing
    pub fn tests_passed(&self) -> bool {
        matches!(self.kind, ArtifactKind::TestResult { failed: 0, .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_code_artifact() {
        let artifact = Artifact::code(
            "rust",
            "main.rs",
            "fn main() { println!(\"Hello\"); }",
            "worker-001",
        );

        assert!(artifact.is_code());
        assert_eq!(artifact.name(), "main.rs");
        assert_eq!(artifact.produced_by(), "worker-001");
    }

    #[test]
    fn test_test_result_artifact() {
        let artifact = Artifact::test_result(
            10,
            0,
            "Unit Tests",
            "All 10 tests passed",
            "verifier-001",
        );

        assert!(artifact.is_test_result());
        assert!(artifact.tests_passed());

        let failing = Artifact::test_result(
            8,
            2,
            "Unit Tests",
            "8 passed, 2 failed",
            "verifier-001",
        );
        assert!(!failing.tests_passed());
    }
}
