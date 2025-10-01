# Validation (Commitlint, etc.)

After composing a commit message:

1. Write the complete message to `.git/COMMIT_EDITMSG`
   - Include title, body (with proper line wrapping), and footers
   - Ensure proper formatting with blank lines between sections
2. Try running commitlint:
   - `pnpm commitlint --edit .git/COMMIT_EDITMSG`
   - or `npx commitlint --edit .git/COMMIT_EDITMSG`
3. If lint fails, revise title/body/footers and retry
4. Only finalize the commit when validation passes
5. Commit using: `git commit -F .git/COMMIT_EDITMSG`
   - This avoids shell escaping issues with newlines and special characters

If commitlint isn't installed, skip gracefully and proceed.
