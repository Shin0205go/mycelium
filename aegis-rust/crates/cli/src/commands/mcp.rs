//! aegis mcp command

use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct McpCommand {
    #[command(subcommand)]
    pub command: McpSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum McpSubcommand {
    /// Start MCP server
    Start {
        /// Development mode (use tsx)
        #[arg(long)]
        dev: bool,
        /// Run in background
        #[arg(long)]
        background: bool,
    },
    /// Check server status
    Status,
}

impl McpCommand {
    pub fn run(&self) -> anyhow::Result<()> {
        match &self.command {
            McpSubcommand::Start { dev, background } => {
                println!("Starting MCP server...");
                if *dev {
                    println!("Development mode enabled");
                }
                if *background {
                    println!("Running in background");
                }
                // TODO: Start MCP server
            }
            McpSubcommand::Status => {
                println!("MCP server status: not running");
                // TODO: Check server status
            }
        }
        Ok(())
    }
}
