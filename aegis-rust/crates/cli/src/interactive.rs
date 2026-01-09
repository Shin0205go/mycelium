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

#[cfg(test)]
mod tests {
    use super::*;

    // ============== Basic Creation Tests ==============

    #[test]
    fn test_new_cli() {
        let cli = InteractiveCli::new();
        assert!(cli.current_role.is_none());
        assert!(cli.model.contains("claude"));
    }

    #[test]
    fn test_default_cli() {
        let cli = InteractiveCli::default();
        assert!(cli.current_role.is_none());
    }

    #[test]
    fn test_default_model() {
        let cli = InteractiveCli::new();
        assert!(cli.model.contains("sonnet"));
    }

    // ============== Command Handling Tests ==============

    #[test]
    fn test_handle_quit_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/quit");
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_handle_exit_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/exit");
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_handle_q_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/q");
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_handle_help_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/help");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_handle_h_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/h");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_handle_roles_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/roles");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_handle_tools_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/tools");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_handle_status_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/status");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_handle_model_command_no_arg() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/model");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_handle_model_command_with_arg() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/model claude-opus-4-20250514");
        assert!(result.is_ok());
        assert!(!result.unwrap());
        assert_eq!(cli.model, "claude-opus-4-20250514");
    }

    #[test]
    fn test_handle_unknown_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/unknown");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    // ============== Edge Cases ==============

    #[test]
    fn test_model_change_preserves_role() {
        let mut cli = InteractiveCli::new();
        cli.current_role = Some("admin".to_string());

        cli.handle_command("/model new-model").unwrap();

        assert_eq!(cli.model, "new-model");
        assert_eq!(cli.current_role, Some("admin".to_string()));
    }

    #[test]
    fn test_empty_command() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/");
        assert!(result.is_ok());
        // Should be treated as unknown command
    }

    #[test]
    fn test_command_with_extra_whitespace() {
        let mut cli = InteractiveCli::new();
        let result = cli.handle_command("/model   claude-haiku-4-5-20251201");
        assert!(result.is_ok());
        // Only first arg after command should be used
        assert_eq!(cli.model, "claude-haiku-4-5-20251201");
    }

    #[test]
    fn test_multiple_model_changes() {
        let mut cli = InteractiveCli::new();

        cli.handle_command("/model model1").unwrap();
        assert_eq!(cli.model, "model1");

        cli.handle_command("/model model2").unwrap();
        assert_eq!(cli.model, "model2");

        cli.handle_command("/model model3").unwrap();
        assert_eq!(cli.model, "model3");
    }

    #[test]
    fn test_model_with_special_chars() {
        let mut cli = InteractiveCli::new();
        cli.handle_command("/model claude-3.5-sonnet@beta").unwrap();
        assert_eq!(cli.model, "claude-3.5-sonnet@beta");
    }

    // ============== State Tests ==============

    #[test]
    fn test_initial_state() {
        let cli = InteractiveCli::new();
        assert!(cli.current_role.is_none());
        assert!(!cli.model.is_empty());
    }

    #[test]
    fn test_role_can_be_set() {
        let mut cli = InteractiveCli::new();
        cli.current_role = Some("developer".to_string());
        assert_eq!(cli.current_role, Some("developer".to_string()));
    }

    #[test]
    fn test_role_can_be_cleared() {
        let mut cli = InteractiveCli::new();
        cli.current_role = Some("admin".to_string());
        cli.current_role = None;
        assert!(cli.current_role.is_none());
    }
}
