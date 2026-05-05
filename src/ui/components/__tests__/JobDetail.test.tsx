import "./test-dom";

import { render } from "@testing-library/react";
import { afterEach, expect, mock, test } from "bun:test";

import type { DagItem, JobDetail as JobDetailType, PipelineType } from "../types";

const capturedItems: DagItem[][] = [];

mock.module("../DAGGrid", () => ({
  default: ({ items }: { items: DagItem[] }) => {
    capturedItems.push(items);
    return null;
  },
}));

const JobDetail = (await import("../JobDetail")).default;

afterEach(() => {
  document.body.innerHTML = "";
  capturedItems.length = 0;
});

function makeJob(restartCount: number): JobDetailType {
  return {
    id: "job-1",
    name: "Job One",
    status: "running",
    tasks: {
      build: {
        name: "build",
        state: "running",
        startedAt: 1_000,
        files: { artifacts: [], logs: [], tmp: [] },
        restartCount,
      },
    },
    pipeline: { tasks: ["build"] },
    current: "build",
  };
}

const pipeline: PipelineType = {
  name: "Test",
  slug: "test",
  description: "",
  tasks: [{ name: "build" }],
};

test("JobDetail re-emits dag item when only restartCount changes", () => {
  const view = render(<JobDetail job={makeJob(1)} pipeline={pipeline} />);
  expect(capturedItems.length).toBeGreaterThan(0);
  const firstItems = capturedItems[capturedItems.length - 1] as DagItem[];
  const firstBuild = firstItems.find((item) => item.id === "build");
  expect(firstBuild?.restartCount).toBe(1);

  view.rerender(<JobDetail job={makeJob(2)} pipeline={pipeline} />);
  const lastItems = capturedItems[capturedItems.length - 1] as DagItem[];
  const secondBuild = lastItems.find((item) => item.id === "build");
  expect(secondBuild?.restartCount).toBe(2);
  expect(secondBuild).not.toBe(firstBuild);
});
