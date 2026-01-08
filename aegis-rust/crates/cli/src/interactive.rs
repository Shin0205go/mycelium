//! Interactive REPL mode

use std::io::{self, Write};

/// Interactive CLI for role-aware conversations
pub struct InteractiveCli {
    current_role: Option<String>,
    model: String,
}

impl InteractiveCli {
    pub fn new() -> Self {
        Self {
            current_role: None,
            model: "claude-sonnet-4-5-20250929".to_string(),
        }
    }

    /// Run the interactive REPL
    pub fn run(&mut self) -> anyhow::Result<()> {
        println!("AEGIS Interactive Mode");
        println!("Type /help for commands, /quit to exit");
        println!();

        loop {
            // Print prompt
            let role = self.current_role.as_deref().unwrap_or("no role");
            print!("[{}] > ", role);
            io::stdout().flush()?;

            // Read input
            let mut input = String::new();
            io::stdin().read_line(&mut input)?;
            let input = input.trim();

            if input.is_empty() {
                continue;
            }

            // Handle commands
            if input.starts_with('/') {
                match self.handle_command(input) {
                    Ok(should_exit) if should_exit => break,
                    Ok(_) => continue,
                    Err(e) => {
                        println!("Error: {}", e);
                        continue;
                    }
                }
            }

            // Handle regular input (would send to Claude)
            println!("(Would process: {})", input);
        }

        Ok(())
    }

    fn handle_command(&mut self, input: &str) -> anyhow::Result<bool> {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let cmd = parts.first().map(|s| *s).unwrap_or("");

        match cmd {
            "/quit" | "/exit" | "/q" => {
                println!("Goodbye!");
                return Ok(true);
            }
            "/help" | "/h" => {
                println!("Commands:");
                println!("  /roles     - Select and switch roles");
                println!("  /tools     - List available tools");
                println!("  /model     - Change model");
                println!("  /status    - Show current status");
                println!("  /quit      - Exit");
            }
            "/roles" => {
                println!("Available roles:");
                println!("  1. guest");
                println!("  2. developer");
                println!("  3. admin");
                // TODO: Use dialoguer for interactive selection
            }
            "/tools" => {
                println!("Available tools for current role:");
                println!("  (none - no role selected)");
            }
            "/model" => {
                if parts.len() > 1 {
                    self.model = parts[1].to_string();
                    println!("Model set to: {}", self.model);
                } else {
                    println!("Current model: {}", self.model);
                }
            }
            "/status" => {
                println!("Status:");
                println!("  Role: {:?}", self.current_role);
                println!("  Model: {}", self.model);
            }
            _ => {
                println!("Unknown command: {}", cmd);
            }
        }

        Ok(false)
    }
}

impl Default for InteractiveCli {
    fn default() -> Self {
        Self::new()
    }
}
