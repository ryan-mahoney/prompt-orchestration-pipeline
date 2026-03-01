Use [`scripts/run-specops-analysis.sh`](/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/scripts/run-specops-analysis.sh) to execute the SpecOps analyses via the Claude Code CLI in separate non-interactive sessions.

Examples:

```bash
scripts/run-specops-analysis.sh all
scripts/run-specops-analysis.sh 8
scripts/run-specops-analysis.sh ui/server --model opus
```

The script:

- reads `docs/specops/analysis-prompt.md`
- injects the `MODULE_NAME` and `SOURCE_FILES` for the selected step
- calls `claude -p ... --output-format json --max-turns 1`
- writes the returned markdown to the target file under `docs/specs/analysis/`
