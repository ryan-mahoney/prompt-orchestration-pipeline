Got it—here’s the tightened plan with upload **never** disabled and steps 9–11 removed.

# Step-by-Step Plan (Revised)

## Acceptance Checklist

- Upload control is **always enabled** (clean project, SSE disconnected, API error present—doesn’t matter).
- “Upload disabled” text or any visual/ARIA disabled state is **gone**.
- Failed attempts surface inline errors via existing `normalizeUploadError`.
- No server endpoint changes; E2E upload path remains functional.
- SSE behavior (not opening on empty data) remains unchanged.

---

## 1) Prepare & Locate

- Open `src/pages/PromptPipelineDashboard.jsx`.
- Find:
  - The call to the jobs list hook (e.g., `useJobListWithUpdates`).
  - Any derived `connectionState` or similar.
  - The `<UploadSeed ... />` usage (look for `disabled` prop).

**Completion check:** You can point to every place where upload is gated or the `disabled` prop is passed.

---

## 2) Remove Gating in Dashboard

- **Delete** any computed variable used to gate upload (e.g., `uploadDisabled`, `connectionState` checks for `<UploadSeed>`).
- **Remove** the `disabled={...}` prop from `<UploadSeed>` entirely.
- Keep `connectionState` if other UI uses it (badges, banners, etc.), but it must not affect upload.

**Completion check:** `<UploadSeed>` has **no** `disabled` prop and no conditional upload gating in the dashboard.

---

## 3) Simplify UploadSeed Props

- Open the `UploadSeed` component file (e.g., `src/components/UploadSeed.jsx`; adjust path to your repo).
- Remove the `disabled` prop from its prop list/TypeScript types (if present).
- Delete any conditional rendering branches that rely on `disabled` to show “Upload disabled” or to block UI.

**Completion check:** The component’s interface no longer accepts or reads a `disabled` prop.

---

## 4) Remove Internal Disabled Logic in UploadSeed

- Ensure:
  - No `disabled` attributes are set on inputs/buttons.
  - No `aria-disabled` or styles implying disabled state remain.
  - Any dropzone library usage (e.g., `useDropzone`) is not passed a `disabled` flag.
  - “Upload disabled” copy is removed.

**Completion check:** All interaction paths (click-to-select, drag-and-drop, keyboard) are available at all times.

---

## 5) Keep Inline Error Handling

- Confirm `normalizeUploadError` is still used on failed POSTs (network errors, validation failures).
- Make sure error messages render inline within the upload area and do not block subsequent attempts.

**Completion check:** A failed attempt shows a clear inline error; user can immediately retry.

---

## 6) Update Automated Tests

- In `tests/PromptPipelineDashboard.test.jsx`, update/replace assertions:
  - **New Test A:** “upload is enabled when SSE is disconnected and data is empty”
    - Mock `connectionStatus = "disconnected"`, `isConnected = false`, `error = null`.
    - Assert upload control is interactive (no `disabled` attribute, actionable button/input present).

  - **New Test B:** “upload is enabled even when jobs API returns an error”
    - Mock `error` as truthy.
    - Assert upload control remains interactive (never disabled).

  - **Remove/modify** any test expecting the upload to be disabled under any condition.

- If you have `tests/UploadSeed.test.jsx`, remove cases tied to `disabled` prop and add checks that the control is always actionable.

**Completion check:** No test refers to a disabled state for upload; new tests confirm it’s always enabled.

---

## 7) UI Copy & Accessibility Audit

- Scan for any copy implying upload requires “connected” or “SSE active” status; update to neutral phrasing (e.g., “Disconnected from live updates; uploads still available.”) if needed.
- Verify accessible names/roles:
  - Primary upload trigger has a clear label.
  - Keyboard users can focus and activate all upload controls.
  - Errors announced where applicable (if you already use ARIA live regions, ensure they still fire).

**Completion check:** Messaging is accurate, and accessibility is not degraded.

---

## 8) Manual QA Scenarios

- **Clean project (no jobs, SSE closed):** Upload is available; selecting a valid file initiates upload.
- **Disconnected but API healthy:** Upload remains available; successful upload proceeds; jobs list populates; SSE can connect later.
- **Jobs API error present:** Upload is still available; attempting upload may succeed (endpoint independent) or fail; failures render inline and allow retry.
- **Server down during upload:** Inline error appears via `normalizeUploadError`; control remains interactive for retry.

**Completion check:** In all scenarios, the control is never disabled and errors are handled inline.

---

## File Change List (path → purpose)

- `src/pages/PromptPipelineDashboard.jsx` → Remove all upload gating; remove `disabled` prop from `<UploadSeed>`.
- `src/components/UploadSeed.jsx` (adjust path) → Remove `disabled` prop support, disabled attributes/ARIA, and “Upload disabled” copy.
- `tests/PromptPipelineDashboard.test.jsx` → Replace disabled-state tests with “always enabled” tests.
- `tests/UploadSeed.test.jsx` (if present) → Remove disabled-prop tests; ensure interactivity tests pass.

---

## Risks & Mitigations

- **Risk:** Users attempt upload while backend is down.
  **Mitigation:** Inline error handling (already present) communicates failure and allows immediate retry.
- **Risk:** Legacy code assumes `disabled` exists on `UploadSeed`.
  **Mitigation:** Search repo for `UploadSeed` usages and remove any `disabled` props; tests will catch stragglers.

---

## Non-Goals

- No changes to `/api/upload/seed`.
- No changes to SSE opening behavior in the jobs list hook.
- No changes to unrelated UI elements besides removing misleading “disabled” messaging.
