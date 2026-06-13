# Architecture Critique: Custom Frontend Support via a Documented HTTP/SSE Protocol

> Reviewing: `.specs/custom-frontend-protocol/proposal.md`
> Date: 2026-06-12

## Proposal Summary

The proposal lets consumers (notably an Electrobun desktop app) build a custom UI against the server's existing HTTP `/api/*` + SSE `/api/events` boundary instead of overriding React components. The work: add opt-in CORS (with a `localhost` keyword and exact-origin allowlist), add a `GET /api/meta` version endpoint, write `docs/http-api.md`, and declare the `/api/*` surface a semver-covered public contract. It rejects a template-override approach as architecturally absent and maintenance-heavy.

The core direction is right, and the document is unusually concrete (real file paths, real route table, honest caveats). The critique below concentrates on the two decisions that are expensive to reverse once consumers depend on them: the **security trust model** and the **contract-evolution mechanism**. The proposal does the easy 80% (plumbing, docs) well and is comparatively light on exactly these irreversible 20%.

## Expert Perspectives

### Michał Zalewski — browser security model lens

**Relevant background:** Author of _The Tangled Web: A Guide to Securing Modern Web Applications_ (No Starch Press, 2011), the canonical treatment of the same-origin policy, CORS, and CSRF. Long-time browser-security researcher (lcamtuf).

**Grounding source:** _The Tangled Web_, chapters on the same-origin policy and content isolation; his consistent public position that CORS **relaxes** the same-origin policy for cross-origin **reads** and is not a server-side access-control mechanism.

**Would challenge:**

- **The proposal treats CORS as the security boundary; it isn't.** The caveats lead with "CORS off by default," "exact-match allowlist," "no credentials" — framing CORS as what protects the API. CORS governs whether the *calling JavaScript may read the response*. It does not govern whether the *request executes*. The genuine boundary for a localhost service is **network reachability** plus **server-side request validation**, neither of which this proposal hardens. The feature explicitly widens who can reach this API from a browser, so getting the trust model right is now load-bearing, not theoretical.
- **The mutating endpoints are CSRF-reachable as "simple requests," and this is confirmed in code, not hypothetical.** [`handleJobRestart`](src/ui/server/endpoints/job-control-endpoints.ts#L508-L514) wraps `req.json()` in `try/catch` and **defaults to a clean-slate restart when the body is absent or unparseable**. A bodyless `POST` with no `Content-Type` is a CORS *simple request* — it is **not preflighted**, so it executes regardless of any allowlist, and it **spawns a pipeline-runner subprocess** ([`RUNNER_PATH`](src/ui/server/endpoints/job-control-endpoints.ts#L29)). Any web page the user visits can fire `fetch("http://localhost:4000/api/jobs/<id>/restart", {method:"POST", mode:"no-cors"})` and trigger the side effect. CORS withholds the *response*, not the *action*. This is a pre-existing latent issue that the proposal **amplifies** by inviting cross-origin frontends — it should not ship without addressing it.
- **`hostname: 127.0.0.1` is filed as an out-of-scope follow-up, but it's the actual control.** `Bun.serve` currently binds all interfaces. For a feature whose entire premise is "more clients talk to this API," loopback binding is the cheapest, highest-value mitigation and belongs in *this* change.
- **DNS rebinding defeats loopback binding alone.** Binding to `127.0.0.1` does not stop a `evil.com → 127.0.0.1` rebind: the victim's browser then sends requests to the attacker's hostname that resolve to loopback, carrying `Host: evil.com`. The defense is **Host-header validation** (allow only `localhost`/`127.0.0.1[:port]`). _The Tangled Web_ treats this class of name-based boundary confusion explicitly.
- **Allowlisting the literal `null` origin is close to allow-any.** `Origin: null` is granted by sandboxed iframes, `data:`/`file:` contexts, and some redirects — not just the desktop webview. Listing `null` in the allowlist hands cross-origin read access to all of them.

**Would approve:**

- Off-by-default CORS; echoing the concrete origin instead of `*`; **not** setting `Access-Control-Allow-Credentials`. These are correct and match his guidance.
- Preferring the concrete `views://` origin over `null` — the proposal already leans this way; he'd make it a hard rule.

**Key question they'd ask:**

> "CORS decides who can read the reply. What decides who can _fire_ a job restart that spawns a process — and why is that control a deferred footnote when this whole feature is about adding cross-origin callers?"

---

### Mark Nottingham — HTTP-API-as-contract lens

**Relevant background:** Long-time IETF HTTP Working Group chair, author of multiple HTTP RFCs (caching, structured fields). Has written extensively on API evolution and the costs of versioning.

**Grounding source:** His writing on API evolution (mnot.net, "API Evolution"/"Evolving HTTP APIs") and the position that extensibility — clients ignoring the unknown — buys you far more than version numbers, which should be a last resort.

**Would challenge:**

- **A single `protocolVersion: 1` integer is a coarse instrument, and nobody owns bumping it.** His consistent argument: design the surface so it evolves *additively* and you rarely need to break. A monotonic integer plus "major bump on breaking change" is the version-number-as-crutch pattern he warns against. There's no defined process for who increments it or what counts as breaking, so in practice it will rot (the existing hardcoded `0.17.5` vs. package `1.2.12` drift the proposal itself flags is the precedent).
- **The "bundled UI already pins these endpoints, so they're de facto frozen" argument cuts the other way for external consumers.** The bundled UI ships *in the same version* as the server, so it always matches — it can never observe a breaking change. External frontends are **decoupled in time**, which is exactly the situation where evolvability matters and where the in-repo test suite gives **zero** coverage. The proposal's central reassurance ("the contract is exercised daily by our own UI") does not protect the population it's being written for.
- **No stated robustness rule for clients.** The single most effective evolvability lever — "clients MUST ignore unknown JSON fields and unknown SSE event types" — is absent from the protocol-doc outline. Without it, every added field or event type is a potential breaking change for a brittle client, which forces the major-bump hammer and defeats additive evolution.
- **SSE event vocabulary is a looser contract than REST and deserves its own evolution rules.** Adding an event *type* is safe only if unknown events are ignored; changing an existing event's shape is breaking. The doc outline lists the event types but not the rules for changing them.

**Would approve:**

- Documenting the surface at all, and the additive-minor / breaking-major intent. Writing the contract down is the prerequisite to evolving it deliberately.
- The `/api/meta` endpoint as a **capability/discovery** seam — he'd want it to grow toward feature signaling rather than a lone integer.
- Deferring the typed-protocol SDK. Shipping the human-readable contract first, SDK only on demand, matches his "don't over-build the contract surface" instinct.

**Key question they'd ask:**

> "Your own UI can never see a breaking change because it ships with the server. What does the _time-decoupled_ external consumer rely on to survive your next additive release — and have you told them, in writing, to ignore what they don't recognize?"

---

## Synthesis

### Where Both Experts Agree

Both converge on a single meta-point: **the proposal invests in the reversible parts (plumbing, docs) and under-designs the irreversible parts (trust boundary, evolution mechanism).** Zalewski's "you can't un-expose an unauthenticated, process-spawning API once consumers depend on cross-origin reach" and Nottingham's "you can't un-publish a contract" are the same warning aimed at different one-way doors. Both would also note the same structural blind spot: **the bundled UI is a false comfort** — it shares the server's version and origin, so it exercises neither the cross-origin security path nor the time-decoupled compatibility path that external consumers actually live on. The thing being made public is precisely the thing the existing test suite does not cover.

### Where They Diverge

They pull in opposite directions on **how much surface to build now**:

- **Nottingham → build more contract**: capability discovery, explicit robustness rules, careful event-evolution policy.
- **Zalewski → expose less**: bind loopback, validate Host, refuse `null`, enforce on the request path.

The resolution is context-driven. This is a **single-user, localhost, desktop/dev tool with one known consumer**, not a multi-tenant public service. That context favors Zalewski's constraints almost entirely — loopback binding and Host validation are cheap and high-value — while favoring only the *cheap* slice of Nottingham's agenda. Specifically: adopt the one-line robustness rule ("ignore unknown fields/events") because it costs nothing and preserves future freedom, but **do not** build capability-negotiation machinery for one consumer — that's the speculative over-engineering the proposal rightly avoids elsewhere. Keep `protocolVersion` as a single integer for now, but write down who owns bumping it.

### Blind Spots

Neither expert's lens catches these; they sit outside browser-security and API-contract concerns:

- **Programmatic mode couples the orchestrator to the desktop app's process.** The proposal lists "import `startServer`/`startOrchestrator` directly" as supported-but-secondary without flagging that this runs the UI server and orchestrator **inside Electrobun's main process**. The pipeline *runners* are child processes (crash-isolated), but a throw in `startServer`, a watcher leak, or an unhandled rejection in the orchestrator now takes down the **desktop app**. The README section should state plainly that subprocess mode preserves the crash-isolation that is one of this project's headline properties, and programmatic mode forfeits it.
- **Port discovery is unspecified.** Default 4000, examples hardcode `--port 3010`, but in subprocess mode nothing tells the webview which port won, and nothing handles "port already in use." A desktop app needs a deterministic answer (fixed port + fail-loud on conflict, or print the chosen port on stdout for the parent to read).
- **No bump ownership.** Both `protocolVersion` and the semver policy assume a human remembers to act at release time. The already-stale `0.17.5` version string is proof this fails silently. A test that asserts `/api/meta` version equals `package.json` version would convert it from a discipline problem into a CI failure.

## Recommendations

### Must Address

1. **Stop treating CORS as the security control; harden the request path in this change.** Add `hostname: "127.0.0.1"` to `Bun.serve` ([index.ts](src/ui/server/index.ts)) and validate the `Host` header against `localhost`/`127.0.0.1` to close DNS rebinding. For state-changing methods (`POST`), reject requests whose `Origin` header is **present and not allowlisted** with a 403 — while still allowing requests with **no** `Origin` (CLI, programmatic, curl). This converts CORS from a response-read gate into an actual execution gate for the dangerous endpoints, without breaking non-browser callers. Frame the existing bodyless-restart behavior as the concrete motivation.
2. **Make the `null` origin an explicit, guarded opt-in — not a documented allowlist value.** Require a separate flag (e.g. `--cors-allow-null-origin`) or omit `null` support entirely and direct the Electrobun consumer to allowlist their concrete `views://` origin. Allowlisting `null` silently grants cross-origin reads to sandboxed iframes, `file:`, and `data:` contexts.

### Should Address

3. **Add a client robustness rule to `docs/http-api.md`.** State that clients MUST ignore unknown JSON fields and unknown SSE event types, and MUST NOT assume event ordering beyond what's documented. This is the single change that lets the contract evolve additively without forcing major bumps — and it's the protection the in-repo UI tests cannot provide to external consumers.
4. **Specify SSE event-evolution rules alongside the event list.** Adding an event type is minor (given the robustness rule); changing an existing event's payload shape is major. Put this in the versioning section so the looser event contract isn't governed only by the REST policy.
5. **Make version drift a test failure, not a discipline.** Add a test asserting `/api/meta` version equals `package.json` version, and fix the stale `0.17.5` literal at [cli/index.ts:416](src/cli/index.ts#L416) (the proposal already notes this; elevate it from aside to task).

### Consider

6. **Flag the crash-isolation tradeoff of programmatic mode in the README.** One sentence: subprocess mode keeps the orchestrator crash-isolated from the desktop app; programmatic mode runs it in-process and forfeits that.
7. **Give the port a deterministic discovery story** for subprocess mode (fixed port + fail-loud on conflict, or emit the bound port on stdout).
8. **Keep `protocolVersion` a single integer for now, but record who bumps it and when** in the versioning section. Don't build capability negotiation for one consumer.

## Revised Confidence

**Strong with minor adjustments — but two of the adjustments are non-negotiable before shipping.** The architecture is correct: the HTTP/SSE boundary is the right seam, the template-override rejection is well-argued, and the docs/plumbing plan is concrete and low-risk. The gap is that the proposal frames a **security boundary** (an unauthenticated, process-spawning localhost API now invited to accept cross-origin browser traffic) as if CORS configuration addresses it, when CORS does not gate execution. Recommendations 1 and 2 close that gap with cheap, well-understood controls and should be folded into the design now rather than deferred. With those in, this is a solid, ship-ready plan.
