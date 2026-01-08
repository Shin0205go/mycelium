//! AEGIS CLI - Command-line interface for AEGIS
//!
//! Usage:
//!   aegis                     - Start interactive mode
//!   aegis init [dir]          - Initialize a new project
//!   aegis skill add <name>    - Add a new skill
//!   aegis skill list          - List all skills
//!   aegis policy check --role <role>  - Check role permissions
//!   aegis mcp start           - Start MCP server

use clap::{Parser, Subcommand};
use cli::commands::{InitCommand, SkillCommand, PolicyCommand, McpCommand};
use cli::interactive::InteractiveCli;

#[derive(Parser)]
#[command(name = "aegis")]
#[command(about = "AEGIS - Skill-driven RBAC MCP proxy router")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Start with specific role
    #[arg(short, long, global = true)]
    role: Option<String>,

    /// Use specific model
    #[arg(short, long, global = true)]
    model: Option<String>,

    /// Output as JSON (for sub-agent mode)
    #[arg(long, global = true)]
    json: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new AEGIS project
    Init(InitCommand),
    /// Manage skills
    Skill(SkillCommand),
    /// Policy verification
    Policy(PolicyCommand),
    /// MCP server management
    Mcp(McpCommand),
}

fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Init(cmd)) => cmd.run(),
        Some(Commands::Skill(cmd)) => cmd.run(),
        Some(Commands::Policy(cmd)) => cmd.run(),
        Some(Commands::Mcp(cmd)) => cmd.run(),
        None => {
            // No subcommand - start interactive mode
            let mut interactive = InteractiveCli::new();
            interactive.run()
        }
    }
}
