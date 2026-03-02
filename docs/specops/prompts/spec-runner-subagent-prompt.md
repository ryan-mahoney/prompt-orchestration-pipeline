# Implementation Orchestrator (Sub-Agent Mode)

Read the spec file at [SPEC] in full. Count the implementation steps.

You are an **orchestrator**. You coordinate sub-agents to implement each step.
You do NOT write production code yourself. You DO read files, run checks, and
verify work between steps.

---

## How to invoke a sub-agent

Use the **Task tool** to spawn sub-agents. Do NOT use `claude -p` in Bash —
that will fail with "Claude Code cannot be launched inside another session."

For each implementation step, invoke the Task tool like this:

```
Task(
  subagent_type: "general-purpose",
  description: "Implement step K: <short step title>",
  prompt: "<PROMPT_TEXT>",
  model: "sonnet"
)
```

Use `model: "sonnet"` for implementation steps. Use `model: "opus"` only if a
step involves complex architectural decisions.

### Building PROMPT_TEXT for each step

The sub-agent prompt MUST follow this exact template (fill in the blanks):

```
You are implementing step STEP_NUMBER of a SpecOps implementation spec.

## Your task

PASTE_THE_SINGLE_STEP_TEXT_HERE (copy the exact step content from the spec)

## Conventions

Read and follow these files before writing any code:
- AGENTS.md (TypeScript, Bun, coding conventions)
- docs/engineering-standards.md

If the task involves frontend React components, re-purpose legacy components
from react-legacy/ where possible.

## Spec context

The full spec is at: SPEC_PATH
Read sections 1-3 (Overview, Architecture/Design, Data Models) for context
before implementing. You only need to implement the single step described above.

## Verification

After implementing:
1. Run: bun run typecheck
2. If typecheck fails, fix the errors. Iterate up to 3 times.
3. Run: bun test PATH_TO_RELEVANT_TEST (if tests exist for this module)
4. Report exactly what files you created or modified.
```

**Critical rules for PROMPT_TEXT:**

- Copy each step's text verbatim from the spec. Do not summarize.
- Tell the sub-agent to READ the spec file from disk rather than inlining it.
  This keeps the prompt small and gives the sub-agent full access.
- Include the specific test path if you know it. If not, omit the test line.

---

## Orchestrator workflow

### Before starting

1. Read [SPEC] in full. Parse out:
   - Total number of implementation steps
   - The text content of each step
   - The acceptance criteria section
2. Announce the plan: "I found N steps. Executing sequentially with sub-agents."

### For each step (1 through N)

1. **Announce:** "Starting step K of N: <step title>"
2. **Build the sub-agent prompt** using the template above with:
   - The step number
   - The verbatim step text from the spec
   - The spec file path so the sub-agent can read context
3. **Invoke the sub-agent** using the Task tool (NOT `claude -p`, NOT Bash)
4. **Wait for completion.** Read the sub-agent's output fully.
5. **Verify the work yourself:**
   - Run `bun run typecheck` — if it fails, log the errors
   - Inspect the files the sub-agent reported changing (read them, confirm they exist)
   - If verification fails: invoke a **fix-up sub-agent** (see below)
6. **Log the result:** "Step K: PASS" or "Step K: PASS after fix-up"
7. **Only then** proceed to step K+1

### Fix-up sub-agent

If typecheck or tests fail after a step, invoke a fix-up agent via Task tool:

```
Task(
  subagent_type: "general-purpose",
  description: "Fix typecheck/test errors from step K",
  prompt: "The previous implementation step (step STEP_NUMBER) left typecheck/test errors.

Errors:
PASTE_ERROR_OUTPUT_HERE

Files that were changed:
LIST_OF_FILES_FROM_PREVIOUS_AGENT

Fix these errors. Do not refactor or add features. Only fix the errors.

Read AGENTS.md and docs/engineering-standards.md for conventions.

After fixing, run: bun run typecheck",
  model: "sonnet"
)
```

Allow up to 2 fix-up attempts per step. If still failing after 2 fix-ups:

- Log: "Step K: FAILED — manual intervention needed"
- Report the remaining errors
- Ask the user whether to continue to step K+1 or stop

### After all steps

1. Run `bun run typecheck` one final time (full project)
2. Run `bun test` (full test suite)
3. Invoke one final sub-agent for acceptance criteria:

```
Task(
  subagent_type: "general-purpose",
  description: "Verify acceptance criteria",
  prompt: "Read the spec at SPEC_PATH, specifically the Acceptance Criteria section.

For each acceptance criterion, verify whether it has been met by examining
the current codebase. Run any commands needed to check.

Report each criterion as PASS or FAIL with a one-line explanation.",
  model: "sonnet"
)
```

4. Present the final report:

```
## Implementation Report

Steps completed: X/N
Steps passed: Y/N
Steps needing fix-up: Z/N
Steps failed: W/N

## Acceptance Criteria
- [ ] Criterion 1: PASS/FAIL — explanation
- [ ] Criterion 2: PASS/FAIL — explanation
...
```

---

## Important constraints

- **Use the Task tool.** Never use `claude -p` in Bash. It will error.
- **Sequential only.** Never run sub-agents in parallel.
- **One step per sub-agent.** Never combine steps.
- **Don't inline the spec.** Point the sub-agent to the file path.
- **Don't skip verification.** Always typecheck between steps.
- **Don't modify code yourself.** If you spot an issue during verification,
  delegate the fix to a sub-agent.
- **Keep your own context lean.** Don't read the full content of every changed
  file back into your context unless you need to verify something specific.
  Use `head`, `grep`, or targeted reads.
- **Sub-agents cannot nest.** The Task tool is one level deep — sub-agents
  cannot spawn their own sub-agents. This is a platform limitation.

---

## Variables

SPEC: <path to spec file>
