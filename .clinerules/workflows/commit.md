# Workflow: Commit

1. Show status & diff
   - Run `git status -s` and display
   - If nothing staged, suggest `git add -p` or targeted paths
   - Preview `git diff --staged` concisely

2. Enforce granularity
   - If staged changes mix concerns, recommend splitting
   - Offer concrete `git add -p` or file-based split steps

3. Generate the message
   - Infer `type` and `scope` from file paths (see `scopes.md`)
   - Draft `type(scope): summary` (≤ 50 chars, imperative, no period)
   - Add body (~72 wrap) with **why**, notable **what/how**, risks
   - Add footers: issues and `BREAKING CHANGE` if applicable

4. Validate (see `validation.md`)
   - Run commitlint if available; revise on failure

5. Confirm & commit
   - Show final message for approval
   - Write the complete message to a temporary file (e.g., `.git/COMMIT_EDITMSG`)
   - On approval, run: `git commit -F .git/COMMIT_EDITMSG`
   - This avoids shell escaping issues with newlines and special characters
