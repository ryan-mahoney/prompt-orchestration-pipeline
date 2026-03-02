import "./test-dom";

import { fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    new Response(JSON.stringify({ slug: "new-pipeline" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ));

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  document.body.innerHTML = "";
  fetchMock.mockClear();
});

test("AddPipelineSidebar submits and enters creating state", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (((_callback: TimerHandler) => 1) as unknown) as typeof setTimeout;

  const { AddPipelineSidebar } = await import("../AddPipelineSidebar");
  const view = render(
    <MemoryRouter>
      <AddPipelineSidebar open onOpenChange={() => {}} />
    </MemoryRouter>,
  );

  await act(async () => {
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "New Pipeline" } });
    fireEvent.change(view.getByLabelText("Description"), { target: { value: "Description" } });
    fireEvent.submit(document.body.querySelector("form") as HTMLFormElement);
  });

  expect(fetchMock).toHaveBeenCalled();
  expect(view.getByRole("button", { name: "Creating…" })).toBeTruthy();
  globalThis.setTimeout = originalSetTimeout;
});
