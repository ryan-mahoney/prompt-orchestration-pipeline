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

test("UploadSeed uploads all dropped files independently", async () => {
  let callCount = 0;
  fetchMock.mockImplementation((_input, _init) => {
    callCount++;
    const jobName = `job-${callCount}`;
    return Promise.resolve(
      new Response(
        JSON.stringify({ ok: true, data: { jobName } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  const onUploadSuccess = mock((_result: { jobName: string }) => {});
  const view = render(<UploadSeed onUploadSuccess={onUploadSuccess} />);
  const fileA = new File(['{"a":1}'], "a.json", { type: "application/json" });
  const fileB = new File(['{"b":2}'], "b.json", { type: "application/json" });
  const fileC = new File([new ArrayBuffer(8)], "c.zip", { type: "application/zip" });
  const dropZone = view.getByText("Upload JSON or ZIP seed").parentElement as Element;

  await act(async () => {
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [fileA, fileB, fileC] },
    });
  });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(onUploadSuccess).toHaveBeenCalledTimes(3);
});

test("UploadSeed one failed file does not block other uploads", async () => {
  let callCount = 0;
  fetchMock.mockImplementation((_input, _init) => {
    callCount++;
    if (callCount === 2) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, message: "bad file" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ ok: true, data: { jobName: `job-${callCount}` } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  const onUploadSuccess = mock((_result: { jobName: string }) => {});
  const view = render(<UploadSeed onUploadSuccess={onUploadSuccess} />);
  const fileA = new File(['{"a":1}'], "a.json", { type: "application/json" });
  const fileB = new File(['{"b":2}'], "b.json", { type: "application/json" });
  const fileC = new File(['{"c":3}'], "c.json", { type: "application/json" });
  const dropZone = view.getByText("Upload JSON or ZIP seed").parentElement as Element;

  await act(async () => {
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [fileA, fileB, fileC] },
    });
  });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(onUploadSuccess).toHaveBeenCalledTimes(2);
  expect(view.getByText("bad file")).toBeTruthy();
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
