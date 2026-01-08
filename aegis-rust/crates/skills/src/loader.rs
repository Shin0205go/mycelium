//! SkillLoader - Load skill definitions from YAML/MD files

use shared::{SkillDefinition, SkillManifest};
use std::path::Path;

/// Skill loader
#[derive(Debug, Default)]
pub struct SkillLoader {
    skills: Vec<SkillDefinition>,
}

impl SkillLoader {
    /// Create a new SkillLoader
    pub fn new() -> Self {
        Self::default()
    }

    /// Load skills from a directory
    pub fn load_from_directory(&mut self, dir: &Path) -> std::io::Result<()> {
        if !dir.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                // Look for SKILL.yaml or SKILL.md
                let yaml_path = path.join("SKILL.yaml");
                let md_path = path.join("SKILL.md");

                if yaml_path.exists() {
                    if let Ok(skill) = self.load_yaml(&yaml_path) {
                        self.skills.push(skill);
                    }
                } else if md_path.exists() {
                    if let Ok(skill) = self.load_md(&md_path) {
                        self.skills.push(skill);
                    }
                }
            }
        }

        Ok(())
    }

    /// Load a skill from a YAML file
    fn load_yaml(&self, path: &Path) -> Result<SkillDefinition, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let skill: SkillDefinition = serde_yaml::from_str(&content)?;
        Ok(skill)
    }

    /// Load a skill from a Markdown file with YAML frontmatter
    fn load_md(&self, path: &Path) -> Result<SkillDefinition, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;

        // Extract YAML frontmatter between ---
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() < 3 {
            return Err("Invalid SKILL.md format: missing YAML frontmatter".into());
        }

        let yaml_content = parts[1].trim();
        let skill: SkillDefinition = serde_yaml::from_str(yaml_content)?;
        Ok(skill)
    }

    /// Get loaded skills
    pub fn skills(&self) -> &[SkillDefinition] {
        &self.skills
    }

    /// Generate a skill manifest
    pub fn to_manifest(&self, version: &str) -> SkillManifest {
        SkillManifest {
            skills: self.skills.clone(),
            version: version.to_string(),
            generated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// Filter skills for a specific role
    pub fn filter_for_role(&self, role_id: &str) -> Vec<&SkillDefinition> {
        self.skills
            .iter()
            .filter(|s| s.allows_role(role_id))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_yaml_parsing() {
        let yaml = r#"
id: test-skill
displayName: Test Skill
description: A test skill
allowedRoles:
  - admin
  - developer
allowedTools:
  - filesystem__read_file
"#;

        let skill: SkillDefinition = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(skill.id, "test-skill");
        assert!(skill.allows_role("admin"));
        assert!(!skill.allows_role("guest"));
    }
}
