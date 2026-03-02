import "./test-dom";

import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

import DAGGrid from "../DAGGrid";
import type { DagItem, TaskFiles, TaskStateObject } from "../types";

afterEach(() => {
  document.body.innerHTML = "";
});

const geometryAdapter = {
  observeResize() {
    return () => undefined;
  },
  requestFrame(callback: () => void) {
    callback();
  },
  matchesReducedMotion() {
    return false;
  },
};

function installMatchMedia(matches = true) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query === "(min-width: 1024px)" ? matches : false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList) as typeof window.matchMedia;
}

function makeItem(overrides: Partial<DagItem> = {}): DagItem {
  return {
    id: "build",
    status: "pending",
    stage: null,
    title: "Build",
    subtitle: null,
    body: null,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  };
}

function makeTaskState(overrides: Partial<TaskStateObject> = {}): TaskStateObject {
  return {
    name: "build",
    state: "pending",
    files: { artifacts: [], logs: [], tmp: [] },
    ...overrides,
  };
}

const emptyFiles: TaskFiles = { artifacts: [], logs: [], tmp: [] };

test("DAGGrid disables start and restart actions while a job is running", () => {
  installMatchMedia();

  const view = render(
    <DAGGrid
      items={[
        makeItem({ id: "build", title: "Build", status: "running" }),
        makeItem({ id: "test", title: "Test", status: "pending" }),
        makeItem({ id: "deploy", title: "Deploy", status: "done" }),
      ]}
      jobId="job-1"
      taskById={{
        build: makeTaskState({ name: "build", state: "running" }),
        test: makeTaskState({ name: "test", state: "pending" }),
        deploy: makeTaskState({ name: "deploy", state: "done" }),
      }}
      pipelineTasks={["build", "test", "deploy"]}
      filesByTypeForItem={() => emptyFiles}
      geometryAdapter={geometryAdapter}
    />,
  );

  expect(view.getByRole("button", { name: "Start" }).getAttribute("disabled")).not.toBeNull();
  expect(view.getByRole("button", { name: "Restart" }).getAttribute("disabled")).not.toBeNull();
});

test("DAGGrid opens task details from keyboard interaction and renders connector paths", () => {
  installMatchMedia();

  const view = render(
    <DAGGrid
      items={[
        makeItem({ id: "build", title: "Build", status: "done", endedAt: 2_000 }),
        makeItem({ id: "test", title: "Test", status: "pending" }),
      ]}
      activeIndex={1}
      jobId="job-1"
      taskById={{
        build: makeTaskState({ name: "build", state: "done" }),
        test: makeTaskState({ name: "test", state: "pending" }),
      }}
      pipelineTasks={["build", "test"]}
      filesByTypeForItem={() => emptyFiles}
      geometryAdapter={geometryAdapter}
    />,
  );

  const cards = view.container.querySelectorAll('[role="listitem"]');
  expect(cards.length).toBe(2);
  fireEvent.keyDown(cards[0] as Element, { key: "Enter" });

  expect(view.getByText("Build · done")).toBeTruthy();
  expect(view.container.querySelectorAll('path[marker-end="url(#dag-grid-arrow)"]').length).toBe(1);
});
