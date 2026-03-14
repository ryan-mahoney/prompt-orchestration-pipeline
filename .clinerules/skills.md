# Skills

Reusable skill files are stored in `~/.agents/skills/`. Each subdirectory contains a `SKILL.md` with frontmatter (name, description, argument-hint) and detailed instructions.

When the user invokes a skill by name (e.g., "run 42 step 3", "review", "spec 55"), read the corresponding `SKILL.md` file and follow its instructions exactly.

## Available skills

| Skill | Trigger phrases | Arguments | File |
|-------|----------------|-----------|------|
| **run** | "run step", "implement step N" | `[issue-number] [step(s)]` | `~/.agents/skills/run/SKILL.md` |
| **run-agents** | "execute the spec", "run the plan", "implement the issue", "run all steps" | `[issue-number]` | `~/.agents/skills/run-agents/SKILL.md` |
| **spec** | "write a spec", "create a spec" | `[issue-number]` | `~/.agents/skills/spec/SKILL.md` |
| **review** | "review", "review the code" | | `~/.agents/skills/review/SKILL.md` |
| **pr** | "create a PR", "open a PR" | | `~/.agents/skills/pr/SKILL.md` |
| **pr-feedback** | "address PR feedback" | | `~/.agents/skills/pr-feedback/SKILL.md` |
| **branch** | "create a branch" | | `~/.agents/skills/branch/SKILL.md` |

## How to invoke

1. Match the user's request to a skill from the table above.
2. Read the skill's `SKILL.md` file.
3. Substitute any positional arguments (`$1`, `$2`, etc.) with the values the user provided.
4. Follow the instructions in the skill file.
