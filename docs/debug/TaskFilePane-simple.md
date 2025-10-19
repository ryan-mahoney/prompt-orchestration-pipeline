# TaskFilePane.simple.test.jsx Hang Investigation

## Observed Behaviour

Running `npm test -- TaskFilePane.simple.test.jsx` results in numerous timeouts and repeated `TestingLibraryElementError` failures. The DOM snapshots show multiple `TaskFilePane` instances persisting simultaneously, and the reported test duration stretches until the default timeout (≈60&#8209;80s).

## Candidate Root Causes (Initial Pass)

1. **Global fake timers interfering with async polling**  
   `vi.useFakeTimers()` is activated for every test in [`tests/setup.js`](tests/setup.js:94). React Testing Library’s [`waitFor`](https://testing-library.com/docs/dom-testing-library/api-async/#waitfor) relies on `setTimeout` to poll assertions; with fake timers enabled and never advanced, these polls stall, producing the observed hangs.

2. **Fake timers preventing automatic cleanup between tests**  
   RTL’s implicit cleanup also uses timers. Keeping fake timers active can leave prior renders in the document, explaining the repeated `getByRole/getByText` “Found multiple elements” errors when the next test executes.

3. **Never-resolving fetch stub**  
   The “loading state” test pins `global.fetch` to an unresolved promise (`new Promise(() => {})`) in [`tests/TaskFilePane.simple.test.jsx`](tests/TaskFilePane.simple.test.jsx:70-79). If the cleanup path doesn’t restore the implementation synchronously, later tests continue to await that never-resolving call.

4. **Resetting mocks clears fetch implementations entirely**  
   `global.testUtils.resetAllMocks()` (invoked in `beforeEach`) calls `vi.resetAllMocks()`, stripping prior mock implementations. Subsequent tests that neglect to restub `global.fetch` leave the component calling a bare `vi.fn()` that returns `undefined`, triggering the “Cannot read properties of undefined (reading 'ok')” error state seen in the failures.

5. **Multiple renders inside single tests without explicit teardown**  
   Tests like “should accept valid types” iterate `validTypes.forEach` with a fresh `render` each time ([`tests/TaskFilePane.simple.test.jsx`](tests/TaskFilePane.simple.test.jsx:130-148)). Without manual `cleanup`/`unmount`, this accumulates panes, yielding the multi-element query errors.

6. **Focus timer depends on real timers**  
   The component schedules a zero-delay `setTimeout` to focus the close button ([`TaskFilePane.jsx`](src/components/TaskFilePane.jsx:227-250)). When fake timers remain active and unadvanced, queued callbacks can stack up, compounding the cleanup issues.

7. **AbortController lifecycle with fake timers**  
   Fetch cancellation uses `AbortController` ([`TaskFilePane.jsx`](src/components/TaskFilePane.jsx:175-223)). With fake timers blocking the abort timeout path, stale requests may linger, forcing subsequent renders into error/timeout states.

## Leading Hypotheses (Post-Reflection)

- **Primary:** Global fake timers from `tests/setup.js` obstruct both `waitFor` polling and RTL cleanup, directly explaining the hangs and the duplicate element queries.
- **Secondary:** The “never resolving” fetch mock combined with aggressive mock resets leaves later tests without a functioning fetch implementation, compounding the stalled state.

We will instrument the component to trace fetch lifecycle events and confirm these hypotheses.

## Recommended Fixes

1. **Disable or scope the global fake timers in [`tests/setup.js`](tests/setup.js:88-106).**
   - Remove the unconditional `vi.useFakeTimers()` call, or wrap it in a conditional helper so only tests that explicitly opt-in enable fake timers (and call `vi.runAllTimers()`/`vi.advanceTimersByTime()` as needed).
   - Ensure real timers are active before each TaskFilePane test to allow `waitFor` to poll and React Testing Library to clean up between test cases.

2. **Ensure `global.fetch` resets after the “loading state” test in [`tests/TaskFilePane.simple.test.jsx`](tests/TaskFilePane.simple.test.jsx:70-79).**
   - After the never-resolving promise test finishes, restore `global.fetch` to `vi.fn()` with a resolved implementation (`global.fetch.mockReset()` + `mockResolvedValueOnce(...)`) so subsequent tests receive a defined response object.
   - Alternatively, replace the hanging stub with `vi.fn(() => Promise.resolve(new Response(...)))` and use fake timers within that single test to simulate delays safely.

Implementing both adjustments prevents the cascading hangs and duplicate-element assertions observed during the suite run.
