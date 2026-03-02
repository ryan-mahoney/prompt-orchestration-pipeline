import { describe, expect, it } from "vitest";

import {
  acquireLock,
  buildSchemaPromptSection,
  composeStateSnapshot,
  computeJobStatus,
  createSSEStream,
  filterJobs,
  getJobLocation,
  getState,
  parseMentions,
  transformTasks,
} from "../index";

describe("ui/state index", () => {
  it("re-exports the public ui/state surface", () => {
    expect(typeof acquireLock).toBe("function");
    expect(typeof buildSchemaPromptSection).toBe("function");
    expect(typeof composeStateSnapshot).toBe("function");
    expect(typeof computeJobStatus).toBe("function");
    expect(typeof createSSEStream).toBe("function");
    expect(typeof filterJobs).toBe("function");
    expect(typeof getJobLocation).toBe("function");
    expect(typeof getState).toBe("function");
    expect(typeof parseMentions).toBe("function");
    expect(typeof transformTasks).toBe("function");
  });
});
