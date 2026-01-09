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
    use tempfile::TempDir;
    use std::fs;

    // ============== Basic YAML Parsing Tests ==============

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

    #[test]
    fn test_yaml_parsing_minimal() {
        let yaml = r#"
id: minimal
displayName: Minimal Skill
description: Just the basics
allowedRoles: []
allowedTools: []
"#;

        let skill: SkillDefinition = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(skill.id, "minimal");
        assert!(skill.allowed_roles.is_empty());
        assert!(skill.allowed_tools.is_empty());
    }

    #[test]
    fn test_yaml_parsing_with_grants() {
        let yaml = r#"
id: memory-skill
displayName: Memory Skill
description: With memory grants
allowedRoles:
  - developer
allowedTools: []
grants:
  memory: isolated
"#;

        let skill: SkillDefinition = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(skill.id, "memory-skill");
        assert!(skill.grants.is_some());
        let grants = skill.grants.unwrap();
        assert_eq!(grants.memory, shared::MemoryPolicy::Isolated);
    }

    #[test]
    fn test_yaml_parsing_with_identity() {
        let yaml = r#"
id: identity-skill
displayName: Identity Skill
description: With identity config
allowedRoles:
  - admin
allowedTools: []
identity:
  skillMatching:
    - role: admin
      requiredSkills:
        - admin_access
      priority: 100
  trustedPrefixes:
    - claude-
"#;

        let skill: SkillDefinition = serde_yaml::from_str(yaml).unwrap();
        assert!(skill.identity.is_some());
        let identity = skill.identity.unwrap();
        assert_eq!(identity.skill_matching.len(), 1);
        assert!(identity.trusted_prefixes.contains(&"claude-".to_string()));
    }

    #[test]
    fn test_yaml_parsing_wildcard_role() {
        let yaml = r#"
id: public-skill
displayName: Public Skill
description: Available to all
allowedRoles:
  - "*"
allowedTools:
  - public_tool
"#;

        let skill: SkillDefinition = serde_yaml::from_str(yaml).unwrap();
        assert!(skill.allows_role("anyone"));
        assert!(skill.allows_role("guest"));
        assert!(skill.allows_role("admin"));
    }

    #[test]
    fn test_yaml_parsing_multiple_tools() {
        let yaml = r#"
id: multi-tool
displayName: Multi Tool
description: Multiple tools
allowedRoles:
  - developer
allowedTools:
  - filesystem__read_file
  - filesystem__write_file
  - git__commit
  - git__push
"#;

        let skill: SkillDefinition = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(skill.allowed_tools.len(), 4);
        assert!(skill.allowed_tools.contains(&"filesystem__read_file".to_string()));
        assert!(skill.allowed_tools.contains(&"git__push".to_string()));
    }

    // ============== SkillLoader Tests ==============

    #[test]
    fn test_skill_loader_new() {
        let loader = SkillLoader::new();
        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_skill_loader_default() {
        let loader = SkillLoader::default();
        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_skill_loader_load_from_nonexistent_directory() {
        let mut loader = SkillLoader::new();
        let result = loader.load_from_directory(Path::new("/nonexistent/path/12345"));
        assert!(result.is_ok()); // Should not error, just return empty
        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_skill_loader_load_yaml_file() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("test-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: test-skill
displayName: Test Skill
description: A test
allowedRoles:
  - admin
allowedTools:
  - tool1
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id, "test-skill");
    }

    #[test]
    fn test_skill_loader_load_md_file() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("md-skill");
        fs::create_dir(&skill_dir).unwrap();

        let md_content = r#"---
id: md-skill
displayName: MD Skill
description: From markdown
allowedRoles:
  - developer
allowedTools:
  - filesystem__read_file
---

# MD Skill

This is a markdown skill file.
"#;
        fs::write(skill_dir.join("SKILL.md"), md_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id, "md-skill");
    }

    #[test]
    fn test_skill_loader_prefers_yaml_over_md() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("dual-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: yaml-version
displayName: YAML Version
description: From YAML
allowedRoles: []
allowedTools: []
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let md_content = r#"---
id: md-version
displayName: MD Version
description: From MD
allowedRoles: []
allowedTools: []
---
"#;
        fs::write(skill_dir.join("SKILL.md"), md_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id, "yaml-version");
    }

    #[test]
    fn test_skill_loader_multiple_skills() {
        let temp_dir = TempDir::new().unwrap();

        for i in 0..5 {
            let skill_dir = temp_dir.path().join(format!("skill-{}", i));
            fs::create_dir(&skill_dir).unwrap();
            let yaml_content = format!(r#"
id: skill-{}
displayName: Skill {}
description: Test skill
allowedRoles:
  - user
allowedTools: []
"#, i, i);
            fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();
        }

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 5);
    }

    // ============== Manifest Generation Tests ==============

    #[test]
    fn test_to_manifest_empty() {
        let loader = SkillLoader::new();
        let manifest = loader.to_manifest("1.0.0");

        assert_eq!(manifest.version, "1.0.0");
        assert!(manifest.skills.is_empty());
        assert!(!manifest.generated_at.is_empty());
    }

    #[test]
    fn test_to_manifest_with_skills() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("test-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: test-skill
displayName: Test
description: Test
allowedRoles:
  - admin
allowedTools: []
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        let manifest = loader.to_manifest("2.0.0");
        assert_eq!(manifest.version, "2.0.0");
        assert_eq!(manifest.skills.len(), 1);
    }

    #[test]
    fn test_manifest_generated_at_is_valid_timestamp() {
        let loader = SkillLoader::new();
        let manifest = loader.to_manifest("1.0.0");

        // Should be a valid RFC3339 timestamp
        let parsed = chrono::DateTime::parse_from_rfc3339(&manifest.generated_at);
        assert!(parsed.is_ok());
    }

    // ============== Filter Tests ==============

    #[test]
    fn test_filter_for_role() {
        let temp_dir = TempDir::new().unwrap();

        // Create skill for admin
        let admin_dir = temp_dir.path().join("admin-skill");
        fs::create_dir(&admin_dir).unwrap();
        fs::write(admin_dir.join("SKILL.yaml"), r#"
id: admin-skill
displayName: Admin Skill
description: For admins
allowedRoles:
  - admin
allowedTools: []
"#).unwrap();

        // Create skill for developer
        let dev_dir = temp_dir.path().join("dev-skill");
        fs::create_dir(&dev_dir).unwrap();
        fs::write(dev_dir.join("SKILL.yaml"), r#"
id: dev-skill
displayName: Dev Skill
description: For developers
allowedRoles:
  - developer
allowedTools: []
"#).unwrap();

        // Create skill for both
        let both_dir = temp_dir.path().join("both-skill");
        fs::create_dir(&both_dir).unwrap();
        fs::write(both_dir.join("SKILL.yaml"), r#"
id: both-skill
displayName: Both Skill
description: For both
allowedRoles:
  - admin
  - developer
allowedTools: []
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        let admin_skills = loader.filter_for_role("admin");
        let dev_skills = loader.filter_for_role("developer");
        let guest_skills = loader.filter_for_role("guest");

        assert_eq!(admin_skills.len(), 2); // admin-skill + both-skill
        assert_eq!(dev_skills.len(), 2);   // dev-skill + both-skill
        assert_eq!(guest_skills.len(), 0);
    }

    #[test]
    fn test_filter_for_role_with_wildcard() {
        let temp_dir = TempDir::new().unwrap();

        let public_dir = temp_dir.path().join("public-skill");
        fs::create_dir(&public_dir).unwrap();
        fs::write(public_dir.join("SKILL.yaml"), r#"
id: public-skill
displayName: Public Skill
description: For everyone
allowedRoles:
  - "*"
allowedTools: []
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        let guest_skills = loader.filter_for_role("guest");
        let admin_skills = loader.filter_for_role("admin");
        let random_skills = loader.filter_for_role("random");

        assert_eq!(guest_skills.len(), 1);
        assert_eq!(admin_skills.len(), 1);
        assert_eq!(random_skills.len(), 1);
    }

    // ============== Edge Cases ==============

    #[test]
    fn test_invalid_yaml_is_skipped() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("invalid-skill");
        fs::create_dir(&skill_dir).unwrap();

        // Invalid YAML content
        fs::write(skill_dir.join("SKILL.yaml"), "not: valid: yaml: ::").unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_invalid_md_frontmatter_is_skipped() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("invalid-md");
        fs::create_dir(&skill_dir).unwrap();

        // MD without proper frontmatter
        fs::write(skill_dir.join("SKILL.md"), "# Just a heading\nNo frontmatter here").unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_empty_directory() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("empty-skill");
        fs::create_dir(&skill_dir).unwrap();
        // No SKILL.yaml or SKILL.md

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_file_instead_of_directory() {
        let temp_dir = TempDir::new().unwrap();

        // Create a file at the root level (not a skill directory)
        fs::write(temp_dir.path().join("readme.txt"), "test").unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_nested_directories_not_scanned() {
        let temp_dir = TempDir::new().unwrap();
        let nested = temp_dir.path().join("level1").join("level2");
        fs::create_dir_all(&nested).unwrap();

        fs::write(nested.join("SKILL.yaml"), r#"
id: nested-skill
displayName: Nested
description: Nested
allowedRoles: []
allowedTools: []
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        // Only looks at direct children, not nested
        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_unicode_skill_content() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("japanese-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: japanese-skill
displayName: 日本語スキル
description: これは日本語の説明です
allowedRoles:
  - 日本語ユーザー
allowedTools:
  - filesystem__read_file
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].display_name, "日本語スキル");
        assert!(loader.skills()[0].allows_role("日本語ユーザー"));
    }

    #[test]
    fn test_special_characters_in_skill_id() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("special-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: skill-with-dashes_and_underscores.v1
displayName: Special Chars
description: Test
allowedRoles: []
allowedTools: []
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills()[0].id, "skill-with-dashes_and_underscores.v1");
    }

    // ============== MD Frontmatter Edge Cases ==============

    #[test]
    fn test_md_with_only_frontmatter() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("minimal-md");
        fs::create_dir(&skill_dir).unwrap();

        let md_content = r#"---
id: minimal-md
displayName: Minimal MD
description: Just frontmatter
allowedRoles: []
allowedTools: []
---
"#;
        fs::write(skill_dir.join("SKILL.md"), md_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id, "minimal-md");
    }

    #[test]
    fn test_md_with_extra_content() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("rich-md");
        fs::create_dir(&skill_dir).unwrap();

        let md_content = r#"---
id: rich-md
displayName: Rich MD
description: With content
allowedRoles:
  - reader
allowedTools: []
---

# Rich MD Skill

This skill has additional markdown content.

## Features

- Feature 1
- Feature 2

```yaml
example: code
```
"#;
        fs::write(skill_dir.join("SKILL.md"), md_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id, "rich-md");
    }

    // ============== Additional Edge Cases ==============

    #[test]
    fn test_very_long_skill_id() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("long-id-skill");
        fs::create_dir(&skill_dir).unwrap();

        let long_id = "a".repeat(1000);
        let yaml_content = format!(r#"
id: {}
displayName: Long ID
description: Very long ID
allowedRoles: []
allowedTools: []
"#, long_id);
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id.len(), 1000);
    }

    #[test]
    fn test_empty_allowed_roles() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("no-roles");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: no-roles
displayName: No Roles
description: No allowed roles
allowedRoles: []
allowedTools:
  - some__tool
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert!(!loader.skills()[0].allows_role("admin"));
    }

    #[test]
    fn test_empty_allowed_tools() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("no-tools");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: no-tools
displayName: No Tools
description: No allowed tools
allowedRoles:
  - admin
allowedTools: []
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert!(loader.skills()[0].allowed_tools.is_empty());
    }

    #[test]
    fn test_skill_with_grants() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("grants-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: grants-skill
displayName: Grants Skill
description: Skill with memory grants
allowedRoles:
  - admin
allowedTools: []
grants:
  memory: all
  memoryTeamRoles:
    - developer
    - tester
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        let skill = &loader.skills()[0];
        assert!(skill.grants.is_some());
    }

    #[test]
    fn test_skill_with_identity_config() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("identity-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: identity-skill
displayName: Identity Skill
description: Skill with identity config
allowedRoles:
  - admin
allowedTools: []
identity:
  skillMatching:
    - role: admin
      requiredSkills:
        - admin_access
  trustedPrefixes:
    - claude-
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        let skill = &loader.skills()[0];
        assert!(skill.identity.is_some());
    }

    #[test]
    fn test_many_skills_in_directory() {
        let temp_dir = TempDir::new().unwrap();

        for i in 0..20 {
            let skill_dir = temp_dir.path().join(format!("skill-{}", i));
            fs::create_dir(&skill_dir).unwrap();
            let yaml_content = format!(r#"
id: skill-{}
displayName: Skill {}
description: Description {}
allowedRoles:
  - role{}
allowedTools: []
"#, i, i, i, i % 3);
            fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();
        }

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 20);
    }

    #[test]
    fn test_mixed_yaml_and_md_skills() {
        let temp_dir = TempDir::new().unwrap();

        // YAML skill
        let yaml_dir = temp_dir.path().join("yaml-skill");
        fs::create_dir(&yaml_dir).unwrap();
        fs::write(yaml_dir.join("SKILL.yaml"), r#"
id: yaml-skill
displayName: YAML Skill
description: From YAML
allowedRoles:
  - admin
allowedTools: []
"#).unwrap();

        // MD skill
        let md_dir = temp_dir.path().join("md-skill");
        fs::create_dir(&md_dir).unwrap();
        fs::write(md_dir.join("SKILL.md"), r#"---
id: md-skill
displayName: MD Skill
description: From MD
allowedRoles:
  - admin
allowedTools: []
---
Content
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 2);
    }

    #[test]
    fn test_loader_default_trait() {
        let loader = SkillLoader::default();
        assert!(loader.skills().is_empty());
    }

    #[test]
    fn test_loader_debug_trait() {
        let loader = SkillLoader::new();
        let debug = format!("{:?}", loader);
        assert!(debug.contains("SkillLoader"));
    }

    #[test]
    fn test_load_nonexistent_directory() {
        let mut loader = SkillLoader::new();
        let result = loader.load_from_directory(std::path::Path::new("/nonexistent/path/12345"));
        // Should handle gracefully (may or may not error)
        let _ = result;
    }

    #[test]
    fn test_whitespace_in_skill_id() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("ws-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: "skill with spaces"
displayName: WS Skill
description: ID with spaces
allowedRoles: []
allowedTools: []
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id, "skill with spaces");
    }

    #[test]
    fn test_emoji_in_description() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("emoji-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: emoji-skill
displayName: "🎉 Emoji Skill 🎉"
description: "This is awesome! 🚀💯"
allowedRoles:
  - admin
allowedTools: []
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.skills().len(), 1);
        assert!(loader.skills()[0].display_name.contains("🎉"));
    }

    #[test]
    fn test_skill_manifest_generation() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("manifest-skill");
        fs::create_dir(&skill_dir).unwrap();

        let yaml_content = r#"
id: manifest-skill
displayName: Manifest Skill
description: For manifest test
allowedRoles:
  - admin
  - developer
allowedTools:
  - filesystem__read
  - filesystem__write
"#;
        fs::write(skill_dir.join("SKILL.yaml"), yaml_content).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        let manifest = loader.to_manifest("1.0.0");
        assert_eq!(manifest.skills.len(), 1);
        assert_eq!(manifest.version, "1.0.0");
    }

    #[test]
    fn test_manifest_version_format() {
        let loader = SkillLoader::new();
        let manifest = loader.to_manifest("2.0.0");

        // Version should match what we passed
        assert_eq!(manifest.version, "2.0.0");
    }

    #[test]
    fn test_manifest_generated_at_timestamp() {
        let loader = SkillLoader::new();
        let manifest = loader.to_manifest("1.0.0");

        // Should have a timestamp
        assert!(!manifest.generated_at.is_empty());
    }

    #[test]
    fn test_filter_multiple_roles() {
        let temp_dir = TempDir::new().unwrap();

        // Create skill for multiple specific roles
        let skill_dir = temp_dir.path().join("multi-role-skill");
        fs::create_dir(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.yaml"), r#"
id: multi-role
displayName: Multi Role
description: Multiple roles
allowedRoles:
  - admin
  - developer
  - tester
allowedTools: []
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        assert_eq!(loader.filter_for_role("admin").len(), 1);
        assert_eq!(loader.filter_for_role("developer").len(), 1);
        assert_eq!(loader.filter_for_role("tester").len(), 1);
        assert_eq!(loader.filter_for_role("guest").len(), 0);
    }

    #[test]
    fn test_skill_clone() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("clone-skill");
        fs::create_dir(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.yaml"), r#"
id: clone-skill
displayName: Clone Test
description: For cloning
allowedRoles:
  - admin
allowedTools:
  - tool
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        let skill = loader.skills()[0].clone();
        assert_eq!(skill.id, "clone-skill");
    }

    #[test]
    fn test_yaml_takes_precedence_over_md() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("both-files");
        fs::create_dir(&skill_dir).unwrap();

        // Create both YAML and MD
        fs::write(skill_dir.join("SKILL.yaml"), r#"
id: yaml-version
displayName: YAML Version
description: From YAML
allowedRoles: []
allowedTools: []
"#).unwrap();

        fs::write(skill_dir.join("SKILL.md"), r#"---
id: md-version
displayName: MD Version
description: From MD
allowedRoles: []
allowedTools: []
---
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        // Should only have one skill (YAML takes precedence)
        assert_eq!(loader.skills().len(), 1);
        assert_eq!(loader.skills()[0].id, "yaml-version");
    }

    #[test]
    fn test_case_sensitivity_in_roles() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("case-skill");
        fs::create_dir(&skill_dir).unwrap();

        fs::write(skill_dir.join("SKILL.yaml"), r#"
id: case-skill
displayName: Case Skill
description: Test case sensitivity
allowedRoles:
  - Admin
allowedTools: []
"#).unwrap();

        let mut loader = SkillLoader::new();
        loader.load_from_directory(temp_dir.path()).unwrap();

        // Roles should be case-sensitive
        assert_eq!(loader.filter_for_role("Admin").len(), 1);
        assert_eq!(loader.filter_for_role("admin").len(), 0);
        assert_eq!(loader.filter_for_role("ADMIN").len(), 0);
    }

    // ============== Final Additional Tests ==============

    #[test]
    fn test_skill_definition_clone() {
        let skill = SkillDefinition {
            id: "test".to_string(),
            display_name: "Test".to_string(),
            description: "Description".to_string(),
            allowed_roles: vec!["admin".to_string()],
            allowed_tools: vec!["tool".to_string()],
            grants: None,
            identity: None,
            metadata: None,
        };
        let cloned = skill.clone();
        assert_eq!(cloned.id, skill.id);
        assert_eq!(cloned.allowed_roles, skill.allowed_roles);
    }

    #[test]
    fn test_skill_definition_debug() {
        let skill = SkillDefinition {
            id: "debug".to_string(),
            display_name: "Debug".to_string(),
            description: "".to_string(),
            allowed_roles: vec![],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };
        let debug = format!("{:?}", skill);
        assert!(debug.contains("debug"));
    }

    #[test]
    fn test_manifest_with_100_skills() {
        let skills: Vec<SkillDefinition> = (0..100).map(|i| SkillDefinition {
            id: format!("skill_{}", i),
            display_name: format!("Skill {}", i),
            description: "".to_string(),
            allowed_roles: vec!["admin".to_string()],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        }).collect();

        let manifest = SkillManifest {
            skills,
            version: "1.0.0".to_string(),
            generated_at: "2024-01-01".to_string(),
        };
        assert_eq!(manifest.skills.len(), 100);
    }

    #[test]
    fn test_manifest_clone() {
        let skills = vec![SkillDefinition {
            id: "test".to_string(),
            display_name: "Test".to_string(),
            description: "".to_string(),
            allowed_roles: vec![],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        }];
        let manifest = SkillManifest {
            skills,
            version: "1.0.0".to_string(),
            generated_at: "2024-01-01".to_string(),
        };
        let cloned = manifest.clone();
        assert_eq!(cloned.skills.len(), manifest.skills.len());
        assert_eq!(cloned.version, manifest.version);
    }

    #[test]
    fn test_skill_with_long_id() {
        let long_id = "x".repeat(1000);
        let skill = SkillDefinition {
            id: long_id.clone(),
            display_name: "Long".to_string(),
            description: "".to_string(),
            allowed_roles: vec![],
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };
        assert_eq!(skill.id.len(), 1000);
    }

    #[test]
    fn test_skill_with_unicode_in_all_fields() {
        let skill = SkillDefinition {
            id: "スキル_123".to_string(),
            display_name: "日本語スキル".to_string(),
            description: "説明文です".to_string(),
            allowed_roles: vec!["管理者".to_string()],
            allowed_tools: vec!["ツール".to_string()],
            grants: None,
            identity: None,
            metadata: None,
        };
        assert!(skill.id.contains("スキル"));
        assert!(skill.display_name.contains("日本語"));
    }

    #[test]
    fn test_load_skill_minimal_yaml() {
        let yaml = r#"
id: minimal
displayName: Min
description: ""
allowedRoles: []
allowedTools: []
"#;
        let skill: SkillDefinition = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(skill.id, "minimal");
        assert!(skill.allowed_roles.is_empty());
    }

    #[test]
    fn test_empty_loader_to_manifest() {
        let loader = SkillLoader::new();
        let manifest = loader.to_manifest("empty");
        assert!(manifest.skills.is_empty());
        assert_eq!(manifest.version, "empty");
    }

    #[test]
    fn test_skill_with_many_roles() {
        let roles: Vec<String> = (0..50).map(|i| format!("role_{}", i)).collect();
        let skill = SkillDefinition {
            id: "many-roles".to_string(),
            display_name: "Many Roles".to_string(),
            description: "".to_string(),
            allowed_roles: roles,
            allowed_tools: vec![],
            grants: None,
            identity: None,
            metadata: None,
        };
        assert_eq!(skill.allowed_roles.len(), 50);
    }

    #[test]
    fn test_skill_with_many_tools() {
        let tools: Vec<String> = (0..100).map(|i| format!("tool_{}", i)).collect();
        let skill = SkillDefinition {
            id: "many-tools".to_string(),
            display_name: "Many Tools".to_string(),
            description: "".to_string(),
            allowed_roles: vec!["admin".to_string()],
            allowed_tools: tools,
            grants: None,
            identity: None,
            metadata: None,
        };
        assert_eq!(skill.allowed_tools.len(), 100);
    }
}
