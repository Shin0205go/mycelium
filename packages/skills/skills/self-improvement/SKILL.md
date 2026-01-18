# Self Improvement

Analyze and improve the Mycelium-CLI codebase itself through recursive self-modification.

## When to Use This Skill

Use this skill when:
- Refactoring Mycelium-CLI's own source code for better maintainability
- Adding new features to Mycelium-CLI itself
- Reviewing and improving code quality in the codebase
- Optimizing performance of Mycelium components
- Fixing bugs in Mycelium-CLI's own implementation
- Updating tests to improve coverage
- Improving documentation and comments within the codebase

## Instructions

Follow these steps to perform self-improvement:

1. **Analyze the target code** - Read and understand the current implementation using filesystem tools
2. **Identify improvement opportunities** - Look for code smells, performance issues, or missing features
3. **Plan the changes** - Design the improvement approach considering architectural constraints
4. **Implement modifications** - Use filesystem__edit_file or filesystem__write_file to make changes
5. **Verify changes** - Check that the modifications maintain or improve functionality
6. **Update tests** - Add or modify tests to cover the changes
7. **Document changes** - Update comments, JSDoc, or README as needed

**Important notes:**
- Always read the existing code before making modifications
- Follow the project's TypeScript coding conventions
- Maintain backward compatibility unless explicitly breaking changes are needed
- Run tests after modifications to ensure nothing broke
- Use the project's existing patterns and architectural decisions
- Keep changes focused and atomic - one improvement at a time

## Examples

### Example 1: Refactor a complex function

```bash
# Task: Simplify the skill creation function
"Analyze packages/cli/src/commands/skill.ts and refactor the createSkillInteractive
function to improve readability and maintainability"
```

### Example 2: Add new CLI command

```bash
# Task: Add a new skill validation command
"Add a new 'mycelium skill validate' command that validates SKILL.yaml files against
the JSON Schema in packages/skills/skill-schema.json"
```

### Example 3: Improve error handling

```bash
# Task: Add better error messages
"Review packages/rbac/src/role-manager.ts and improve error messages to be more
helpful for users when role operations fail"
```

### Example 4: Performance optimization

```bash
# Task: Optimize skill loading
"Analyze packages/skills/src/index.ts and optimize the skill loading mechanism
to reduce startup time"
```

## Advanced Usage

For detailed reference material:
- `references/architecture.md` - Mycelium-CLI architecture overview and design principles
- `references/coding-standards.md` - TypeScript coding standards and conventions
- `references/test-guidelines.md` - Testing patterns and TDD approach

## Self-Improvement Patterns

### Pattern 1: Dogfooding (Using Mycelium to improve Mycelium)

```bash
# Launch Mycelium with meta-developer role
mycelium-cli --role meta-developer "Improve the skill creation system"

# Or in interactive mode
mycelium
/roles  # Select meta-developer
"Review and improve packages/cli/src/commands/skill.ts"
```

### Pattern 2: Recursive Review

```bash
# Have Mycelium review its own changes
mycelium-cli --role code-reviewer "Review the changes I just made to skill.ts"
```

### Pattern 3: Test-Driven Self-Improvement

1. Write a failing test for the desired improvement
2. Use Mycelium to implement the feature to make the test pass
3. Use Mycelium to refactor and optimize

## Best Practices

- **Read before write** - Always understand existing code before modifying
- **Maintain test coverage** - Update or add tests for all changes
- **Follow existing patterns** - Use the same coding style and architectural patterns
- **One change at a time** - Keep improvements atomic and focused
- **Verify functionality** - Run tests and manual verification after changes
- **Document rationale** - Explain why changes were made in commit messages
- **Respect RBAC boundaries** - Only modify code within allowed scope
- **Preserve context** - Use memory to track ongoing improvement tasks

## Safety Guidelines

When performing self-modification:
- Never delete critical files without backup
- Always maintain at least one working version
- Test changes before committing
- Use git to track changes and enable rollback
- Be cautious with changes to core RBAC or security components
- Validate that all tests pass after modifications

## Meta-Programming Considerations

This skill enables Mycelium-CLI to modify its own source code, creating a recursive improvement loop:

```
Mycelium-CLI → Analyzes own code → Identifies improvements → Modifies itself → Tests → Commits
    ↑                                                                              |
    └──────────────────────────────────────────────────────────────────────────────┘
```

This creates a "bootstrapping" effect where each improvement makes future improvements easier.
