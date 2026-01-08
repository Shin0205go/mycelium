//! aegis skill command

use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct SkillCommand {
    #[command(subcommand)]
    pub command: SkillSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum SkillSubcommand {
    /// Add a new skill
    Add {
        /// Skill name
        name: String,
        /// Template to use
        #[arg(short, long)]
        template: Option<String>,
    },
    /// List all skills
    List,
    /// Show available templates
    Templates,
}

impl SkillCommand {
    pub fn run(&self) -> anyhow::Result<()> {
        match &self.command {
            SkillSubcommand::Add { name, template } => {
                println!("Adding skill: {}", name);
                if let Some(t) = template {
                    println!("Using template: {}", t);
                }
                // TODO: Implement skill creation
            }
            SkillSubcommand::List => {
                println!("Listing skills...");
                // TODO: Load and list skills
            }
            SkillSubcommand::Templates => {
                println!("Available templates:");
                println!("  - basic");
                println!("  - browser-limited");
                println!("  - code-reviewer");
                println!("  - data-analyst");
            }
        }
        Ok(())
    }
}
