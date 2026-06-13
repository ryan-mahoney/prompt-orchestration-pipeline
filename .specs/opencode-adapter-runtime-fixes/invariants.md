# Invariants Ledger: OpenCode Adapter

Append-only. `spec-audit` checks every entry on every phase, not just the establishing phase.

---

### INV-1 — Token estimation is gateway-owned; the adapter never estimates inline

- Established: `.specs/opencode-adapter-runtime-fixes/` (OpenCode adapter runtime fixes)
- Source quote: §4 normalization rules — "Return `undefined` when `info`, `tokens`, or `input`/`output` are missing or non-numeric (preserving gateway estimation fallback)."
- Why it outlives the phase: the division of labor — adapter reports measured usage or `undefined`, the gateway (`normalizeUsage` in `src/llm/index.ts`) owns char/4 estimation — must not be relocated into the adapter by a later change.
- Suggested check (S): Does `src/providers/opencode.ts` contain no character-length / `estimateTokens`-style token estimation, and does `normalizeOpenCodeUsage` return `undefined` (not a fabricated count) when SDK token metadata is absent?

---

### INV-2 — The adapter deletes only sessions it created

- Established: `.specs/opencode-adapter-runtime-fixes/` (OpenCode adapter runtime fixes)
- Source quote: §4 Design Decisions — "Only adapter-created sessions are deleted. A caller-supplied `opencode.sessionId` is never deleted — the adapter does not own it."
- Why it outlives the phase: session ownership is a resource-lifecycle boundary. A future change that reuses or pools sessions, or that adds cleanup paths, must not delete a session the caller supplied and owns.
- Suggested check (G/S): `rg -n "session.delete" src/providers/opencode.ts` — every `session.delete` call site must be reachable only through the adapter-created-session path (guarded by the `createdSessionId` tracking), never on a caller-supplied `opencode.sessionId`.
