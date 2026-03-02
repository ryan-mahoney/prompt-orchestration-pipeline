import "./test-dom";

import { render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

afterEach(() => {
  document.body.innerHTML = "";
});

test("TimerText renders elapsed duration", async () => {
  const { default: TimerText } = await import("../TimerText");
  const view = render(<TimerText startMs={10_000} endMs={20_000} />);

  expect(view.getByText("10s")).toBeTruthy();
});
