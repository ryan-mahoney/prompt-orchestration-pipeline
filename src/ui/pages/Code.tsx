import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import Layout from "../components/Layout";
import PageSubheader from "../components/PageSubheader";
import { CopyableCodeBlock } from "../components/ui/CopyableCode";

const SECTIONS = [
  { id: "environment", title: "Environment" },
  { id: "getting-started", title: "Getting Started" },
  { id: "pipeline-config", title: "Pipeline Config" },
  { id: "io-api", title: "IO API" },
  { id: "llm-api", title: "LLM API" },
  { id: "validation", title: "Validation" },
] as const;

const SAMPLE_PIPELINE = `{
  "name": "content-generation",
  "description": "Generate content from structured seed inputs",
  "tasks": ["research", "outline", "draft", "review"]
}`;

export default function Code() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map((section) => [section.id, true])),
  );
  const [llmFunctions, setLlmFunctions] = useState<string[]>([]);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    void fetch("/api/llm/functions")
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: string[] };
        if (response.ok && payload.ok === true) setLlmFunctions(payload.data ?? []);
      })
      .catch(() => setLlmFunctions([]));
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-20% 0px -60% 0px" });

    for (const section of SECTIONS) {
      const element = sectionRefs.current[section.id];
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);

  const contentBySection = useMemo<Record<string, ReactElement>>(() => ({
    environment: <p className="text-sm text-slate-600">Configure provider keys in your environment before running pipelines.</p>,
    "getting-started": <CopyableCodeBlock>{`bun install\nbun run ui:dev`}</CopyableCodeBlock>,
    "pipeline-config": <CopyableCodeBlock>{SAMPLE_PIPELINE}</CopyableCodeBlock>,
    "io-api": <p className="text-sm text-slate-600">Use the IO helpers to read and write artifacts, logs, and temporary files.</p>,
    "llm-api": <ul className="space-y-2 text-sm">{llmFunctions.map((fn) => <li key={fn}>{fn}</li>)}</ul>,
    validation: <p className="text-sm text-slate-600">Validation enforces pipeline and seed contracts before execution.</p>,
  }), [llmFunctions]);

  return (
    <Layout pageTitle="Reference" subheader={<PageSubheader breadcrumbs={[{ label: "Home", href: "/" }, { label: "Code" }]} />}>
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-2">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} className={`block rounded px-3 py-2 text-sm ${activeSection === section.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
              {section.title}
            </a>
          ))}
        </aside>
        <div className="space-y-4">
          {SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              ref={(element) => {
                sectionRefs.current[section.id] = element;
              }}
              className="scroll-mt-24 rounded-xl border bg-white"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-4 text-left"
                onClick={() => setOpenSections((current) => ({ ...current, [section.id]: !current[section.id] }))}
              >
                <span className="font-semibold">{section.title}</span>
                <span>{openSections[section.id] ? "−" : "+"}</span>
              </button>
              {openSections[section.id] ? <div className="border-t px-4 py-4">{contentBySection[section.id]}</div> : null}
            </section>
          ))}
        </div>
      </div>
    </Layout>
  );
}
