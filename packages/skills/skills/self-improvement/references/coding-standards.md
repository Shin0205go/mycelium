# Mycelium-CLI Coding Standards

## TypeScript Guidelines

### Naming Conventions

- **Classes**: PascalCase (e.g., `RoleManager`, `ToolVisibilityManager`)
- **Functions**: camelCase (e.g., `createRoleManager`, `isToolVisible`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `SYSTEM_TOOLS`, `DEFAULT_TIMEOUT`)
- **Interfaces/Types**: PascalCase (e.g., `Role`, `ToolPermissions`)
- **Private members**: Prefix with `_` (e.g., `_roles`, `_currentRole`)

### File Organization

```typescript
// 1. Imports (organized: node built-ins → external → internal)
import { join } from 'path';
import chalk from 'chalk';
import { Logger } from '@mycelium/shared';

// 2. Types and interfaces
interface MyInterface {
  // ...
}

// 3. Constants
const DEFAULT_VALUE = 42;

// 4. Main implementation
export class MyClass {
  // ...
}

// 5. Helper functions
function helperFunction() {
  // ...
}
```

### Comments and Documentation

- Use JSDoc for public APIs
- Japanese comments allowed for architecture notes
- Prefer self-documenting code over comments
- Comment "why" not "what"

```typescript
/**
 * Resolves agent identity based on A2A Agent Card skills.
 *
 * @param agentCard - Agent Card from A2A protocol
 * @returns Identity resolution result with matched role
 */
export function resolveIdentity(agentCard: AgentCard): IdentityResolution {
  // 優先度順にルールをチェック (Check rules by priority)
  for (const rule of sortedRules) {
    if (matchesRule(agentCard, rule)) {
      return createResolution(rule);
    }
  }
  return defaultResolution();
}
```

### Error Handling

- Use custom error classes for domain errors
- Always include context in error messages
- Throw errors for programmer mistakes
- Return error results for expected failures

```typescript
// Good: Custom error with context
if (!role) {
  throw new RoleNotFoundError(`Role '${roleId}' not found in registry`);
}

// Good: Expected failure returns result
function validateSkill(skill: Skill): ValidationResult {
  if (!skill.name) {
    return { valid: false, error: 'Missing required field: name' };
  }
  return { valid: true };
}
```

### Async/Await

- Prefer async/await over Promise chains
- Always handle rejections
- Use Promise.all() for parallel operations

```typescript
// Good: Parallel execution
const [status, diff, log] = await Promise.all([
  runGitStatus(),
  runGitDiff(),
  runGitLog()
]);

// Good: Sequential when needed
async function processSteps() {
  const data = await loadData();
  const processed = await processData(data);
  await saveResults(processed);
}
```

## Code Quality

### DRY (Don't Repeat Yourself)

- Extract common logic into helper functions
- Use inheritance for shared behavior
- Create utility modules for reusable code

### SOLID Principles

- **Single Responsibility**: Each class has one reason to change
- **Open/Closed**: Open for extension, closed for modification
- **Liskov Substitution**: Subtypes must be substitutable
- **Interface Segregation**: Many specific interfaces > one general
- **Dependency Inversion**: Depend on abstractions, not concretions

### Testing

- Write tests before implementation (TDD)
- One test file per source file (1:1 mapping)
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

```typescript
describe('RoleManager', () => {
  it('should throw RoleNotFoundError when role does not exist', () => {
    // Arrange
    const manager = new RoleManager(logger);

    // Act & Assert
    expect(() => manager.getRole('nonexistent')).toThrow(RoleNotFoundError);
  });
});
```

## Git Conventions

### Commit Messages

Format: `type(scope): description`

Types:
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code refactoring
- `test` - Test additions/changes
- `docs` - Documentation changes
- `chore` - Maintenance tasks

Example:
```
feat(cli): add interactive skill creation

- Implement readline prompts for all fields
- Auto-create resource directories
- Generate templates following best practices
```

### Branch Naming

- Feature: `feat/description` or `claude/description`
- Bugfix: `fix/description`
- Refactor: `refactor/description`

## Performance Considerations

- Minimize context usage (keep files under 500 lines)
- Use progressive disclosure for large datasets
- Cache expensive computations
- Avoid unnecessary file I/O
- Use streaming for large files

## Security Best Practices

- Validate all inputs (especially from users)
- Never trust external data
- Use parameterized queries
- Sanitize file paths
- Follow RBAC boundaries strictly
- Log security-relevant events

## Anti-Patterns to Avoid

❌ **Magic numbers**
```typescript
if (retries > 3) // What does 3 mean?
```

✅ **Named constants**
```typescript
const MAX_RETRIES = 3;
if (retries > MAX_RETRIES)
```

❌ **God classes**
```typescript
class Manager {
  handleEverything() { /* 1000 lines */ }
}
```

✅ **Single responsibility**
```typescript
class RoleManager { /* Role operations only */ }
class ToolManager { /* Tool operations only */ }
```

❌ **Callback hell**
```typescript
doSomething((err, result) => {
  doMore(result, (err, more) => {
    doEvenMore(more, (err, final) => { /* ... */ });
  });
});
```

✅ **Async/await**
```typescript
const result = await doSomething();
const more = await doMore(result);
const final = await doEvenMore(more);
```
