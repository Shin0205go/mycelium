//! # AEGIS - Skill-Driven Multi-Agent Orchestration System
//!
//! This is the main entry point that wires everything together.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │  main.rs (this file) - Dependency Injection & Wiring           │
//! │    │                                                            │
//! │    ├── Creates: InMemoryMissionRepository (adapter)            │
//! │    ├── Creates: InMemoryAgentRepository (adapter)              │
//! │    ├── Creates: GameLoop (domain service)                      │
//! │    └── Runs: The orchestration loop                            │
//! └─────────────────────────────────────────────────────────────────┘
//! ```

use aegis_adapter::repository::in_memory::{InMemoryAgentRepository, InMemoryMissionRepository};
use aegis_domain::model::agent::{Agent, AgentId};
use aegis_domain::model::mission::{Mission, MissionId, NextAction};
use aegis_domain::model::role::Role;
use aegis_domain::model::skill::{Skill, SkillId};
use aegis_domain::repository::agent_repository::AgentRepository;
use aegis_domain::repository::mission_repository::MissionRepository;
use aegis_domain::service::game_loop::{AgentOutcome, AgentResult, ContextUpdate, GameLoop, Observation};

use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

fn main() {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set tracing subscriber");

    info!("🛡️  AEGIS - Multi-Agent Orchestration System");
    info!("   Hexagonal Architecture + Clean Architecture + DDD");
    info!("");

    // ========================================
    // Dependency Injection - Wire up the system
    // ========================================

    // Adapters (could be swapped for SQLite, S3, etc.)
    let mut mission_repo = InMemoryMissionRepository::new();
    let mut agent_repo = InMemoryAgentRepository::new();

    // Domain service
    let game_loop = GameLoop::new();

    // ========================================
    // Register Agents
    // ========================================

    info!("📋 Registering agents...");

    let architect = Agent::new(
        AgentId::new("architect-001"),
        "Chief Architect",
        Role::Architect,
    )
    .with_skill(Skill::new(SkillId::new("planning"), "Strategic Planning"))
    .with_skill(Skill::new(SkillId::new("design"), "System Design"))
    .with_system_instruction(
        "You are the Chief Architect. Break down complex missions into actionable tasks.",
    );

    let worker = Agent::new(
        AgentId::new("worker-001"),
        "Rust Developer",
        Role::Worker,
    )
    .with_skill(Skill::rust())
    .with_skill(Skill::coding())
    .with_system_instruction(
        "You are a Rust developer. Implement the tasks assigned to you with clean, idiomatic code.",
    );

    let verifier = Agent::new(
        AgentId::new("verifier-001"),
        "QA Engineer",
        Role::Verifier,
    )
    .with_skill(Skill::review())
    .with_system_instruction(
        "You are a QA engineer. Verify that implementations meet requirements and are safe.",
    );

    agent_repo.register(architect.clone()).unwrap();
    agent_repo.register(worker.clone()).unwrap();
    agent_repo.register(verifier.clone()).unwrap();

    info!("   ✓ Registered {} agents", agent_repo.list_all().unwrap().len());

    // ========================================
    // Create a Mission
    // ========================================

    info!("");
    info!("🎯 Creating mission...");

    let mut mission = Mission::new(
        MissionId::new("mission-001"),
        "Create a CLI tool that greets the user",
    );

    // Start with the Architect
    mission.set_next_action(NextAction {
        target_role: Role::Architect,
        instruction: "Plan the implementation of a simple greeting CLI tool".to_string(),
        priority: 10,
    });

    mission_repo.save(&mission).unwrap();

    info!("   ✓ Mission created: {}", mission.goal());

    // ========================================
    // Run the Game Loop
    // ========================================

    info!("");
    info!("🎮 Starting game loop...");
    info!("");

    loop {
        let observation = game_loop.observe(&mission);

        match observation {
            Observation::ReadyToStart => {
                info!("   Mission is ready but has no next action");
                break;
            }

            Observation::NeedsAgent { role, instruction } => {
                info!("   → Looking for agent with role: {}", role);

                let candidates = agent_repo.find_by_role(role).unwrap();

                if let Some(agent) = game_loop.select_agent(&candidates, role) {
                    info!("   → Dispatching: {} ({})", agent.name(), agent.id());
                    info!("   → Instruction: {}", instruction);

                    let event = game_loop
                        .dispatch(&mut mission, agent, &instruction)
                        .unwrap();

                    info!("   ✓ {:?}", event);

                    // Simulate agent work (in real system, this would call an LLM)
                    let result = simulate_agent_work(agent, &mission);

                    let event = game_loop
                        .apply_result(&mut mission, agent.id(), result)
                        .unwrap();

                    info!("   ✓ {:?}", event);
                    info!("");

                    mission_repo.save(&mission).unwrap();
                } else {
                    info!("   ✗ No agent available for role: {}", role);
                    break;
                }
            }

            Observation::InProgress { current_agent } => {
                info!("   Waiting for agent: {}", current_agent);
                break;
            }

            Observation::NeedsVerification => {
                info!("   → Mission needs verification");

                // Dispatch verifier
                let candidates = agent_repo.find_by_role(Role::Verifier).unwrap();
                if let Some(agent) = candidates.first() {
                    info!("   → Dispatching verifier: {}", agent.name());

                    // Transition mission back to pending for dispatch
                    mission.set_next_action(NextAction {
                        target_role: Role::Verifier,
                        instruction: "Verify the implementation".to_string(),
                        priority: 5,
                    });

                    // Need to transition through states properly
                    // For demo, directly simulate verification
                    let result = AgentResult {
                        artifacts: vec![],
                        context_update: Some(ContextUpdate {
                            summary: Some("Implementation verified and approved".to_string()),
                            decisions: vec!["All tests pass".to_string()],
                            facts: vec![],
                        }),
                        outcome: AgentOutcome::Complete,
                    };

                    // Complete the mission
                    mission.complete().unwrap();
                    mission_repo.save(&mission).unwrap();

                    info!("   ✓ Mission completed!");
                }
                break;
            }

            Observation::Done { status } => {
                info!("   ✓ Mission finished with status: {:?}", status);
                break;
            }
        }
    }

    // ========================================
    // Summary
    // ========================================

    info!("");
    info!("📊 Final Status");
    info!("   Mission: {}", mission.goal());
    info!("   Status: {:?}", mission.status());
    info!("   Artifacts: {}", mission.artifacts().len());

    for (i, artifact) in mission.artifacts().iter().enumerate() {
        info!("     {}. {} (by {})", i + 1, artifact.name(), artifact.produced_by());
    }

    info!("");
    info!("🛡️  AEGIS demo complete!");
}

/// Simulate agent work (in real system, this would call an LLM)
fn simulate_agent_work(agent: &Agent, _mission: &Mission) -> AgentResult {
    use aegis_domain::model::artifact::Artifact;

    match agent.role() {
        Role::Architect => {
            // Architect produces a plan and hands off to Worker
            AgentResult {
                artifacts: vec![Artifact::document(
                    "markdown",
                    "implementation-plan.md",
                    r#"# Implementation Plan

## Goal
Create a CLI tool that greets the user.

## Tasks
1. Create main.rs with clap CLI framework
2. Accept a --name argument
3. Print "Hello, {name}!"

## Success Criteria
- `cargo run -- --name World` prints "Hello, World!"
"#,
                    agent.id().as_str(),
                )],
                context_update: Some(ContextUpdate {
                    summary: Some("Architect created implementation plan".to_string()),
                    decisions: vec!["Use clap for CLI parsing".to_string()],
                    facts: vec!["Simple greeting tool with name argument".to_string()],
                }),
                outcome: AgentOutcome::Handoff {
                    next_action: NextAction {
                        target_role: Role::Worker,
                        instruction: "Implement the greeting CLI tool according to the plan"
                            .to_string(),
                        priority: 5,
                    },
                },
            }
        }

        Role::Worker => {
            // Worker produces code and submits for verification
            AgentResult {
                artifacts: vec![Artifact::code(
                    "rust",
                    "main.rs",
                    r#"use clap::Parser;

#[derive(Parser)]
struct Args {
    #[arg(short, long)]
    name: String,
}

fn main() {
    let args = Args::parse();
    println!("Hello, {}!", args.name);
}
"#,
                    agent.id().as_str(),
                )],
                context_update: Some(ContextUpdate {
                    summary: Some("Worker implemented the greeting CLI".to_string()),
                    decisions: vec![],
                    facts: vec!["Implementation complete, ready for verification".to_string()],
                }),
                outcome: AgentOutcome::SubmitForVerification,
            }
        }

        Role::Verifier => {
            // Verifier approves and completes
            AgentResult {
                artifacts: vec![Artifact::test_result(
                    1,
                    0,
                    "verification-report",
                    "All checks passed",
                    agent.id().as_str(),
                )],
                context_update: None,
                outcome: AgentOutcome::Complete,
            }
        }
    }
}
