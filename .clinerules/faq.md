# Frequently Asked Questions

## General Questions

### What is the purpose of these .clinerules files?

These files provide guidelines and templates for Cline (AI coding assistant) to follow when working on this project, ensuring consistent commit messages, PR descriptions, and development workflows.

### Do I need to follow these rules manually?

No, Cline automatically loads these rules when working in this repository. They serve as guidance for the AI assistant to generate consistent and high-quality contributions.

### Can I customize these rules?

Yes, you can modify any of the .clinerules files to better suit your project's needs. The rules are designed to be flexible and adaptable.

## Commit Message Questions

### What if my commit affects multiple scopes?

Choose the primary scope that best represents the main change. If the changes are truly cross-cutting, you can omit the scope: `feat: add cross-cutting feature`.

### How do I handle very small changes?

Even small changes should follow the conventional commit format. Use appropriate types like `chore`, `docs`, or `style` for minor changes.

### What if I need to revert a commit?

Use the `revert` type: `revert: revert problematic feature` followed by the commit hash being reverted.

## PR Questions

### How detailed should PR descriptions be?

Use the PR template as a guide. Include enough context for reviewers to understand the change without being overly verbose. Focus on the "why" and "what changed."

### What if my PR contains multiple logical changes?

Consider splitting the PR into smaller, focused PRs. If they must stay together, clearly document each change in the PR description.

### How do I handle breaking changes in PRs?

- Clearly mark the PR title with `!` after the type
- Include a "BREAKING CHANGE" section in the PR description
- Document migration steps for users

## Workflow Questions

### What if commitlint fails?

Follow the error messages to fix the commit message format. Common issues include:

- Missing type or scope
- Summary too long (>50 chars)
- Imperative mood not used
- Trailing period in summary

### How do I test my changes before committing?

Use the commands in `commands.md` to run tests and linting:

- `pnpm -s test` or `npm -s test` for tests
- `pnpm -s lint` or `npm -s run lint` for linting

### What if I need to make an emergency fix?

Follow the same conventions but prioritize speed. You can use a simpler commit message like `fix: emergency patch for critical issue` and add more details in the PR.

## Scope Questions

### What if my change doesn't fit any existing scope?

- Check `scopes.md` for common scopes
- If none fit, create a new kebab-case scope that accurately describes the area
- Update `scopes.md` to document the new scope

### Can I use multiple scopes in one commit?

No, conventional commits use a single scope. Choose the most relevant one or omit the scope if the change is truly cross-cutting.

## Integration Questions

### How do these rules integrate with CI/CD?

The commit message format works well with tools like commitlint, semantic-release, and conventional changelog generators.

### What if I'm working on a feature branch?

Follow the same conventions. The branch name should follow the pattern `type/scope/short-desc` (e.g., `feat/ui/pathway-slider`).

### How do I handle merge conflicts?

Resolve conflicts following your team's normal process, then create a conventional commit for the resolution: `fix: resolve merge conflicts in feature branch`.
