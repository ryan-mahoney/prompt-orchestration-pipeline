# Workflow: Open PR

1. Ensure branch is pushed
   - `git push -u origin <branch>`

2. Title
   - Use Conventional Commit style: `type(scope): summary`

3. Body
   - Populate `templates/pr-template.md` with real details:
     - Why, What Changed, How Tested, Risks/Rollback,
       Perf/Security/Accessibility, Linked Issues, Checklist

4. Validate
   - Ensure linked issues (`Closes #...`) where appropriate
   - If breaking changes exist, include clear migration notes

5. Create PR
   - Write the PR body to a temporary file (e.g., `/tmp/pr-body.md`)
   - Show full title/body for approval before creating the PR
   - On approval, use: `gh pr create --title "..." --body-file /tmp/pr-body.md --web`
   - The `--web` flag automatically opens the PR in the browser
   - This avoids shell escaping issues with newlines and special characters
