import "./test-dom";

import { fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import UploadSeed from "../UploadSeed";

const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        ok: true,
        data: { jobName: "test-job" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  ));

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  document.body.innerHTML = "";
  fetchMock.mockClear();
});

test("UploadSeed posts dropped files and reports success", async () => {
  const onUploadSuccess = mock((_result: { jobName: string }) => {});
  const view = render(<UploadSeed onUploadSuccess={onUploadSuccess} />);
  const file = new File(['{"ok":true}'], "seed.json", { type: "application/json" });
  const dropZone = view.getByText("Upload JSON or ZIP seed").parentElement as Element;

  await act(async () => {
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    });
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/upload/seed",
    expect.objectContaining({ method: "POST" }),
  );
  expect(onUploadSuccess).toHaveBeenCalledWith({ jobName: "test-job" });
});

test("UploadSeed shows inline errors", async () => {
  fetchMock.mockImplementationOnce((_input, _init) =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: false, message: "bad upload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ));

  const view = render(<UploadSeed onUploadSuccess={() => {}} />);
  const file = new File(['{"ok":true}'], "seed.json", { type: "application/json" });
  const dropZone = view.getByText("Upload JSON or ZIP seed").parentElement as Element;

  await act(async () => {
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    });
  });

  expect(view.getByText("bad upload")).toBeTruthy();
});
