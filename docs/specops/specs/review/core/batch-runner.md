# Review: `core/batch-runner`

1. Fix the persisted row typing so it can represent the analyzed terminal-state guard correctly.
The spec says external writers may already store `permanently_failed`, and `insertJobs` must check for that status, but `BatchJobRow.status` is typed only as `JobStatus` (`pending | processing | complete | failed`). That makes the row model narrower than the documented database reality. The spec should either widen persisted-row status types to include `permanently_failed` or introduce a separate database-row type for reads that may encounter externally-written terminal states.

2. Make the crash-recovery entry contract consistent with the validation contract.
Step 9 tests crash recovery by calling `executeBatch` with `jobs: []`, but Step 7 and acceptance criterion 20 say empty `jobs` is invalid. Because the same document also says callers are expected to run `validateBatchOptions` first, the current plan leaves recovery-only reruns in an ambiguous state. The spec should choose one rule explicitly: either direct `executeBatch` calls may use an empty job list for recovery/resume, or recovery must always be invoked with the original non-empty job set.

3. Document the global job-ID collision behavior in the acceptance criteria before implementation starts.
The analysis notes that `id` is the table primary key across all batches, so `INSERT OR IGNORE` silently skips a duplicate `id` from another batch and still returns that ID from `insertJobs`. The implementation spec keeps the same schema and SQL, but never states this cross-batch behavior as a contract. That omission invites an accidental behavior change during the TypeScript rewrite. The spec should add one explicit criterion covering duplicate IDs across different batches.

4. Tighten the `maxRetries` contract so the API semantics are not self-contradictory.
The analysis correctly points out that `retry_count < maxRetries` makes `maxRetries` behave like a total-attempt ceiling, not “retries after the first attempt.” The spec partly acknowledges that, but still uses wording like “retries failed jobs up to `maxRetries`,” which points in the opposite direction. The review should require one exact interpretation and use it consistently across acceptance criteria, implementation steps, and tests so the migration does not drift by one attempt.

5. Define how thrown non-`Error` values are converted into the stored failure string.
`processOneJob` is supposed to catch processor failures and call `markFailed(db, jobId, error)` with a string, but the spec never defines how to normalize `unknown` thrown values such as strings, numbers, plain objects, or `null`. In strict TypeScript that gap will either force unsafe casts or inconsistent behavior. The spec should require one normalization rule for failure messages and cover it with a test.
