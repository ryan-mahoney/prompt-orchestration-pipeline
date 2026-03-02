import { describe, expect, it } from "vitest";

import { parseMentions } from "../mention-parser";

describe("mention-parser", () => {
  it("extracts unique ids from mention syntax", () => {
    expect(
      parseMentions([
        { role: "user", content: "See @[alpha](file-a.ts) and @[beta](file-b.ts)" },
        { role: "assistant", content: "Repeating @[gamma](file-a.ts)" },
      ]),
    ).toEqual(["file-a.ts", "file-b.ts"]);
  });

  it("returns an empty array when no mentions exist", () => {
    expect(parseMentions([{ role: "user", content: "No mentions here" }])).toEqual([]);
  });
});
