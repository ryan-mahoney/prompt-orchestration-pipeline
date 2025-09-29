# Practical Examples

## Commit Message Examples

### Feature Addition

```
feat(ui): add pathway form slider on connection click

- Add interactive slider component to pathway form
- Connect slider to pathway configuration state
- Update form validation to handle slider values

Closes #123
```

### Bug Fix

```
fix(api): handle null station_id in pathways

- Add null check for station_id in pathway validation
- Return appropriate error message for missing station_id
- Update API documentation for station_id requirement

Fixes #456
```

### Refactoring with Breaking Change

```
refactor(core)!: replace orchestrator shutdown with SIGKILL fallback

- Replace graceful shutdown with timeout-based approach
- Add SIGKILL fallback after 5 seconds timeout
- Update CLI flags to accept timeout parameter

BREAKING CHANGE: remove legacy --graceful flag; use --timeout=5000
```

### Documentation Update

```
docs(readme): add quick start guide for new users

- Add installation and setup instructions
- Include basic usage examples
- Add troubleshooting section for common issues
```

### Test Addition

```
test(providers): add unit tests for OpenAI provider

- Test API key validation and error handling
- Add tests for response parsing and formatting
- Mock external API calls for reliable testing
```

## PR Title Examples

- `feat(ui): add pathway form slider on connection click`
- `fix(api): handle null station_id in pathways`
- `refactor(core)!: replace orchestrator shutdown with SIGKILL fallback`
- `docs(readme): add quick start guide for new users`
- `test(providers): add unit tests for OpenAI provider`

## Branch Name Examples

- `feat/ui/pathway-slider`
- `fix/api/null-station-id`
- `refactor/core/orchestrator-shutdown`
- `docs/readme/quick-start`
- `test/providers/openai-unit-tests`

## Common Scenarios

### When to Use Breaking Change (!)

- Removing deprecated functionality
- Changing API signatures
- Modifying configuration formats
- Upgrading major dependencies

### When to Use Multiple Commits

1. **Separate concerns**: One commit for feature, one for tests
2. **Large refactors**: Break into logical chunks
3. **Documentation**: Keep separate from code changes
4. **Dependencies**: Update dependencies in separate commit

### Footer Examples

- `Closes #123` - When fixing an issue
- `Fixes #456` - Alternative to Closes
- `Related to #789` - When related but not fixing
- `BREAKING CHANGE: description` - For breaking changes
