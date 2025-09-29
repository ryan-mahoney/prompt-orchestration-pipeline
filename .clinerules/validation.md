# Validation (Commitlint, etc.)

After composing a commit message:

1. Write the message to `.git/COMMIT_EDITMSG` (temp or via `-m`).
2. Try running commitlint:
   - `pnpm commitlint --edit .git/COMMIT_EDITMSG`
   - or `npx commitlint --edit .git/COMMIT_EDITMSG`
3. If lint fails, revise title/body/footers and retry.
4. Only finalize the commit when validation passes.

If commitlint isn't installed, skip gracefully and proceed.
