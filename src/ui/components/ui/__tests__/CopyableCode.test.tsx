import "../../__tests__/test-dom";

import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import { CopyableCode } from "../CopyableCode";

const writeText = mock(async (_value: string) => {});

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText },
  });
});

afterEach(() => {
  writeText.mockClear();
  document.body.innerHTML = "";
});

test("CopyableCode copies content", async () => {
  const view = render(<CopyableCode>const a = 1;</CopyableCode>);
  await act(async () => {
    view.getByRole("button", { name: "Copy code" }).click();
  });
  expect(writeText).toHaveBeenCalledWith("const a = 1;");
});
