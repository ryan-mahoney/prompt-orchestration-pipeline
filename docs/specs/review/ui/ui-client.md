# Review: `ui/client`

1. Preserve the analyzed `bootstrap()` callback contract instead of narrowing it to async-only callbacks.
The analysis allows `applySnapshot` to be any callback and explicitly says it is invoked with parsed data or `null`, while the implementation types it as `(snapshot) => Promise<void>`. That unnecessarily breaks synchronous callers and is not required by the original behavior. The spec should allow sync or async callbacks and keep the guarantee that SSE does not start until the callback has finished, whether that completion is synchronous or awaited.

2. Reconcile the SSE event vocabulary so the client spec is internally consistent.
The analyzed `bootstrap()` path forwards `state`, `job:updated`, `job:created`, `job:removed`, `heartbeat`, and `message`, while the hook-based client also reacts to `state:change`, `state:summary`, `status:changed`, `seed:uploaded`, and `task:updated`. The implementation spec currently mixes both vocabularies without stating which endpoint emits which events or which consumers must support both. It should define that mapping explicitly so the migration does not ship a client that subscribes to the wrong event names.

3. Tighten the API helper and adapter return types so the spec is implementable as a strict TypeScript boundary.
Key functions are still typed as `Promise<unknown>`, `Record<string, unknown>`, or broad `string` fields even though the module’s job is to normalize server data into stable UI shapes. That leaves too much behavior unspecified for strict-mode TS and makes it easy to miss required fields or regress consumer assumptions. The spec should define concrete response envelopes and narrower normalized types for the exported API helpers and adapter outputs.

4. Carry forward the analyzed non-OK snapshot behavior for `bootstrap()` instead of only specifying fetch-failure handling.
The analysis says `bootstrap()` still calls `applySnapshot` on non-OK HTTP responses, using parsed JSON when possible and `null` otherwise. The implementation acceptance criteria only mention fetch failure and omit the non-OK case, which changes observable behavior for server-side error responses during startup. That case should be restored explicitly.

5. Specify the `refetch` and overlapping-request behavior for the data hooks, because the current JS hooks do not fully serialize fetches.
The analysis notes that `useJobList().refetch()` does not cancel an existing in-flight request and that both live-update hooks queue and replay SSE events around hydration. The implementation spec keeps the hydration queue requirement, but it does not define whether refetches cancel, replace, or race with existing requests. That should be made explicit so the TS rewrite preserves the same concurrency model or documents an approved behavioral change.

6. Make the entrypoint contract include the analyzed provider stack, not just the route table.
The analysis treats `StrictMode`, `ToastProvider`, Radix `Theme`, and `BrowserRouter` as part of the application entrypoint behavior, but the acceptance criteria only verify the five routes and the existence of a `root` mount. If those wrappers matter to runtime behavior, the spec should require them directly rather than leaving them as an untested implementation detail.
