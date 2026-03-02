import { describe, test, expect } from "bun:test";
import { LOG_NAME_PATTERN } from "../file-io";

describe("LOG_NAME_PATTERN", () => {
  test("matches valid log name and captures all groups", () => {
    const match = "task1-stage1-start.log".match(LOG_NAME_PATTERN);
    expect(match).not.toBeNull();
    expect(match!.groups).toEqual({
      taskName: "task1",
      stage: "stage1",
      event: "start",
      ext: "log",
    });
  });

  test("matches log name with compound extension", () => {
    const match = "mytask-init-complete.json.gz".match(LOG_NAME_PATTERN);
    expect(match).not.toBeNull();
    expect(match!.groups).toEqual({
      taskName: "mytask",
      stage: "init",
      event: "complete",
      ext: "json.gz",
    });
  });

  test("rejects string with no dots", () => {
    expect("no-dots".match(LOG_NAME_PATTERN)).toBeNull();
  });

  test("rejects empty string", () => {
    expect("".match(LOG_NAME_PATTERN)).toBeNull();
  });

  test("rejects string with dot but missing dashes", () => {
    expect("a.b".match(LOG_NAME_PATTERN)).toBeNull();
  });
});
