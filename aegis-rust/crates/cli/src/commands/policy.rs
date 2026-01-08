//! aegis policy command

use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct PolicyCommand {
    #[command(subcommand)]
    pub command: PolicySubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PolicySubcommand {
    /// Check permissions for a role
    Check {
        /// Role to check
        #[arg(short, long)]
        role: String,
    },
    /// Test A2A identity resolution
    Test {
        /// Agent name
        #[arg(short, long)]
        agent: String,
        /// Agent skills (comma-separated)
        #[arg(short, long)]
        skills: String,
    },
    /// List all available roles
    Roles,
}

impl PolicyCommand {
    pub fn run(&self) -> anyhow::Result<()> {
        match &self.command {
            PolicySubcommand::Check { role } => {
                println!("Checking permissions for role: {}", role);
                // TODO: Load skills and show role permissions
            }
            PolicySubcommand::Test { agent, skills } => {
                println!("Testing A2A resolution for agent: {}", agent);
                println!("Skills: {}", skills);
                // TODO: Resolve identity and show result
            }
            PolicySubcommand::Roles => {
                println!("Available roles:");
                // TODO: Load skills and list derived roles
            }
        }
        Ok(())
    }
}
