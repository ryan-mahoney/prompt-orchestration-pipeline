Turn this spec into a Cline workflow ([https://docs.cline.bot/features/slash-commands/workflows](https://docs.cline.bot/features/slash-commands/workflows)) by adding:

- <task_objective>
- <detailed_sequence_of_steps>
- <new_task>

# Format Conversion Notes

- Do not create a new branch; work on the current branch.
- In `<task_objective>` state clearly that **all steps run start-to-finish with no human interaction**.
- Put a `<new_task>` between each step to start a fresh context.
- Each task is **deterministic** and runs in isolation; **carry forward** any details needed to complete subsequent steps.
- Do **not** include `<read_file>` or `<search_file>`; this workflow already has access.
- **End every section with a single Conventional Commit.**
- Do **not** include code in the workflow; **describe it** if necessary.

# Commit Safety & Automation Rules (non-negotiable)

- **Non-interactive only:** No editors, no prompts; fail fast on any error.
- **Heredoc → message file:** Build the commit message via a **single-quoted heredoc** (e.g., `<<'MSG'`) or equivalent that prevents shell expansion; pass to git with a **message file** (`-F <file>`). Never use `-m` for multi-line/complex text.
- **Conventional Commits:** `type(scope)!: subject` (imperative, ≤72 chars). Body explains **Why** and **What changed**.
- **One atomic commit per section:** Stage only files changed by that section. No mixed concerns/WIP.
- **Skip empty commits:** If no staged changes, log and skip.
- **No hangs / prompts:** Disable interactive prompts; avoid hooks/signing that can block unless explicitly required.
- **Path safety:** Always separate options from pathspecs with `--`; treat filenames as opaque; avoid globs; prefer NUL-delimited enumeration when listing.
- **Pre-commit sanity:** Fail on unresolved merges/conflicts; repo must be consistent.
- **Deterministic output:** Same inputs → same commit; do not rely on user config, locale, or local hooks.

# zsh Git Automation (required)

At the end of **each** section, the workflow **must** write and run a **temporary zsh script** that performs the commit. Do not paste the code in the workflow; **describe** the script and its execution:

**Script name & lifecycle**

- Create with `mktemp` (e.g., `/tmp/commit-XXXXXX.zsh`), write contents, `chmod +x`, execute with `zsh -f <script>`, then delete it.

**Interpreter & shell options (zsh-specific)**

- Shebang: `#!/bin/zsh -f` (no user rc files).
- Set strict mode: `set -euo pipefail` (use `set -o pipefail` in zsh).
- Disable history expansion so `!` is inert: `unsetopt BANG_HIST`.
- Set stable env: `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=:`, `LC_ALL=C.UTF-8`.

**Inputs**

- Subject line (string; ≤72 chars; `type(scope)!: subject`).
- Body (multi-line Markdown text).
- Optional explicit file list to stage; otherwise stage only files modified by the section.

**Algorithm**

1. **Repo checks:** Verify inside a git repo; fail if merge/rebase/cherry-pick/revert in progress or unmerged paths exist.
2. **Stage deliberately:** Stage only intended files for this section (use `git add -- <paths>`; never interpolate untrusted text into flags).
3. **Skip if nothing staged:** If `git diff --cached --quiet`, print “No staged changes; skipping” and exit 0.
4. **Write message file:** Create a temp file, write the **subject** line, a blank line, then the **body** using a **single-quoted heredoc** so no `$`/`` ` ``/`!`/`\` expansion occurs. Ensure trailing newline.
5. **Commit (non-interactive, deterministic):**
   - Use per-command config: `-c commit.gpgSign=false -c core.editor=:`
   - Bypass hooks unless the spec requires them: `--no-verify`
   - Commit with `git commit -F <msgfile>`

6. **Report & clean up:** Print the new commit hash; delete temp files and the temp script.

**Guardrails**

- Never use `git commit -m` for multi-line messages.
- Never rely on global git config; prefer per-command `-c`.
- Always separate options from pathspecs with `--`.
- Ensure message subject is ≤72 chars, imperative, and **no trailing period**.
- Include `BREAKING CHANGE:` in body/footer when `!` is used.

# Deliverable Shape Reminders

- `<task_objective>` states the workflow **runs start-to-finish with no human interaction**, including the **zsh temp-script commit protocol** above.
- `<detailed_sequence_of_steps>` ends each section with “Conventional Commit” that **calls the zsh temp script** as described.
- `<new_task>` appears **between every step**, and each step **carries forward** any details needed by subsequent steps.
