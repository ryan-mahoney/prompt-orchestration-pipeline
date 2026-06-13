# Step 24: Update local decision references

## Scope

Update `docs/current-architecture.md` and `docs/provider-requirements.md` to document the architectural decision that OpenCode is an optional prompt runner under POP's LLM provider layer, not a replacement for POP orchestration.

## Changes

### docs/current-architecture.md

1. Add **OpenCode** entry to the Supported Providers bullet list under the LLM Abstraction Layer section (after Claude Code).
2. Note: optional prompt runner via SDK client or CLI fallback; POP retains orchestration ownership.
3. Reference `.specs/299-opencode-backend-layer/spec.md`.

### docs/provider-requirements.md

1. Add an "OpenCode Provider Constraints" section at the end of the file.
2. Document:
   - Uses SDK client (`@opencode-ai/sdk`) or CLI fallback (`opencode run --format json`).
   - Safe-by-default deny permissions (`{ "*": "deny" }` unless overridden).
   - Supports dynamic `provider/model` strings without static registry entries.
   - POP remains the orchestration owner.
3. Reference `.specs/299-opencode-backend-layer/spec.md`.

## Conformance

- POP remains the orchestration owner.
- Local docs preserve the architecture decision.
- No code changes; documentation-only.
