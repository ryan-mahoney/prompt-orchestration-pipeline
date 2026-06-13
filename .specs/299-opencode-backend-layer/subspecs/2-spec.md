# Step 2: Add the OpenCode model registry alias

## Scope

Modify `src/config/models.ts` and `src/config/__tests__/models.test.ts` to register the single `opencode:default` alias with zero static pricing.

## Changes

### src/config/models.ts

1. Add `"opencode"` to the `ProviderName` union type (after `"alibaba"`).
2. Add `OPENCODE_DEFAULT: "opencode:default"` to `ModelAlias` (under a new `// OpenCode` section, after Alibaba).
3. Add `"opencode:default"` entry to `MODEL_CONFIG_RAW` with `provider: "opencode"`, `model: "default"`, `tokenCostInPerMillion: 0`, `tokenCostOutPerMillion: 0`.
4. Add `opencode: "opencode:default"` to `DEFAULT_MODEL_BY_PROVIDER`.

### src/config/__tests__/models.test.ts

1. Update `MODEL_COUNT` from 50 to 51.
2. Update `PROVIDER_COUNT` from 8 to 9.
3. Add `"opencode"` to both provider list arrays (DEFAULT_MODEL_BY_PROVIDER and PROVIDER_FUNCTIONS tests).
4. Add test: `getModelConfig("opencode:default")` returns zero pricing.
5. Add test: `MODEL_CONFIG` contains exactly one key with the `opencode:` prefix.

## Conformance

- Only `opencode:default` alias — no OpenCode model catalog duplication.
- All existing providers remain present.
- Zero static pricing for OpenCode (dynamic pricing out of scope for phase 1).
