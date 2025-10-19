Turn the spec into a Cline workflow ([https://docs.cline.bot/features/slash-commands/workflows](https://docs.cline.bot/features/slash-commands/workflows)) by adding:

- <task_objective>
- <detailed_sequence_of_steps>
- <new_task>

# Format Conversion Notes:

- do not create a new branch, work on the current branch
- in task_objective make it clear that all steps should be completed with no human interaction
- put a new_task between each step to start a fresh context
- each task must be deterministic and will execute in its own context, so carry over any required information so that each step can be completed with no direct knowledge of other steps
- do not include <read_file> or <search_file> commands, this workflow has full access already
- at the end of each section, make a single Conventional Commit
- do not include code in the workflow, but describe it if necessary

# Commit Safety & Automation Rules (non-negotiable):

- Non-interactive only: All git operations must run without opening editors or prompting; fail fast on any error.
- Heredoc message file: Create the commit message via a single-quoted heredoc (e.g., `<<'MSG'`) or an equivalent approach that prevents shell expansion, then pass it to Git using a message file (e.g., `-F <file>`). Never inline the message with `-m` when it might contain quotes, backticks, `$`, `\`, emojis, YAML/JSON, or Markdown.
- Conventional Commits: Use the format `type(scope)!: subject` with an imperative, ≤72-char subject. Provide a wrapped body that explains Why and What changed.
- One atomic commit per section: Stage and commit only the files changed by that section. No “WIP” or mixed concerns.
- Skip empty commits: If there are no staged or working changes, log and skip the commit for that section (don’t force an empty commit).
- No hangs / prompts:
  - Disable interactive prompts (e.g., ensure auth never blocks and editors aren’t launched).
- Path safety: Always separate options from pathspecs using `--`. Never interpolate untrusted text into flags. Avoid globs; treat filenames as opaque. Prefer null-delimited patterns (`-z`) when enumerating files.
- Staging discipline: Stage only intended changes. Do not stage unrelated or untracked files unless the step explicitly calls for it.
- Pre-commit sanity checks:
  - Detect and fail on unresolved merges or conflicts.
  - Ensure repository state is consistent before committing.
- Deterministic output: The workflow must produce the same commit content and message given the same inputs, regardless of shell or locale, and must not rely on editor settings or local hooks.

# Deliverable shape reminders:

- <task_objective> explicitly states “runs start-to-finish with no human interaction,” including defensive commit handling per the rules above.
- <detailed_sequence_of_steps> ends each section with “Conventional Commit” that references these Commit Safety & Automation Rules.
- <new_task> appears between every step to start a fresh context, and each step carries forward critical details from previous steps.
