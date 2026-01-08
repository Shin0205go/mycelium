//! aegis init command

use clap::Args;
use std::path::PathBuf;

#[derive(Debug, Args)]
pub struct InitCommand {
    /// Directory to initialize
    #[arg(default_value = ".")]
    pub directory: PathBuf,

    /// Create minimal project without example skills
    #[arg(long)]
    pub minimal: bool,
}

impl InitCommand {
    pub fn run(&self) -> anyhow::Result<()> {
        println!("Initializing AEGIS project in {:?}", self.directory);

        // Create directory structure
        let skills_dir = self.directory.join("skills");
        std::fs::create_dir_all(&skills_dir)?;

        // Create config.json
        let config = serde_json::json!({
            "mcpServers": {}
        });
        std::fs::write(
            self.directory.join("config.json"),
            serde_json::to_string_pretty(&config)?,
        )?;

        if !self.minimal {
            // Create example skills
            self.create_example_skills(&skills_dir)?;
        }

        println!("✓ AEGIS project initialized");
        Ok(())
    }

    fn create_example_skills(&self, skills_dir: &PathBuf) -> anyhow::Result<()> {
        // Guest access skill
        let guest_dir = skills_dir.join("guest-access");
        std::fs::create_dir_all(&guest_dir)?;
        std::fs::write(
            guest_dir.join("SKILL.yaml"),
            r#"id: guest-access
displayName: Guest Access
description: Basic read-only access for guests
allowedRoles:
  - guest
allowedTools:
  - filesystem__read_file
"#,
        )?;

        // Admin access skill
        let admin_dir = skills_dir.join("admin-access");
        std::fs::create_dir_all(&admin_dir)?;
        std::fs::write(
            admin_dir.join("SKILL.yaml"),
            r#"id: admin-access
displayName: Admin Access
description: Full administrative access
allowedRoles:
  - admin
allowedTools:
  - "*"
grants:
  memory: all
"#,
        )?;

        Ok(())
    }
}
