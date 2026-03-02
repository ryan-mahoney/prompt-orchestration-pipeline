import "./test-dom";

import { render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

afterEach(() => {
  document.body.innerHTML = "";
});

test("LiveText renders computed text", async () => {
  const { default: LiveText } = await import("../LiveText");
  const view = render(<LiveText compute={() => "5s"} cadenceMs={2_000} />);

  expect(view.getByText("5s")).toBeTruthy();
});
