import { useEffect, useRef, useState } from "react";

import MarkdownRenderer from "./MarkdownRenderer";
import { Sidebar, SidebarFooter, SidebarSection } from "./ui/Sidebar";
import { Button } from "./ui/Button";
import type { ChatMessage, TaskProposal } from "./types";

const TASK_PROPOSAL_REGEX =
  /\[TASK_PROPOSAL\]\s*FILENAME:\s*(\S+)\s*TASKNAME:\s*(\S+)\s*CODE:\s*```(?:javascript|ts|tsx|md)?\s*([\s\S]*?)\s*```\s*\[\/TASK_PROPOSAL\]/g;

function extractProposals(content: string): TaskProposal[] {
  const matches = Array.from(content.matchAll(TASK_PROPOSAL_REGEX));
  return matches.map((match) => ({
    filename: match[1] ?? "",
    taskName: match[2] ?? "",
    code: match[3] ?? "",
    proposalBlock: match[0] ?? "",
    created: false,
    error: null,
    path: null,
  }));
}

export default function TaskCreationSidebar({
  isOpen,
  onClose,
  pipelineSlug,
}: {
  isOpen: boolean;
  onClose: () => void;
  pipelineSlug: string;
}) {
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proposals = messages.flatMap((message) => message.role === "assistant" ? extractProposals(message.content) : []);

  useEffect(() => {
    if (!isOpen) return;
    void fetch(`/api/pipelines/${encodeURIComponent(pipelineSlug)}/artifacts`)
      .then((response) => response.json())
      .then((payload: { data?: string[] }) => setArtifacts(payload.data ?? []))
      .catch(() => setArtifacts([]));
  }, [isOpen, pipelineSlug]);

  useEffect(() => {
    if (messages.length === 0) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isOpen) controllerRef.current?.abort();
    return () => controllerRef.current?.abort();
  }, [isOpen]);

  const createTask = async (proposal: TaskProposal) => {
    const response = await fetch("/api/tasks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: pipelineSlug,
        taskId: proposal.taskName,
        content: proposal.code,
      }),
    });
    if (!response.ok) throw new Error("Failed to create task");
  };

  const send = async (messageText: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const nextMessages = [...messages, { role: "user", content: messageText } satisfies ChatMessage];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setIsSending(true);
    setIsWaiting(true);
    setIsReceiving(false);
    setError(null);

    setTimeout(() => setIsSending(false), 300);

    try {
      const response = await fetch("/api/ai/task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, pipelineSlug }),
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      setIsWaiting(false);
      setIsReceiving(true);

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        accumulated += decoder.decode(chunk.value, { stream: true });
        setMessages((current) => {
          const next = current.slice();
          next[next.length - 1] = { role: "assistant", content: accumulated };
          return next;
        });
      }
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === "AbortError") return;
      setError(sendError instanceof Error ? sendError.message : "Failed to plan task");
    } finally {
      setIsWaiting(false);
      setIsReceiving(false);
    }
  };

  const disabled = isSending || isWaiting || isReceiving;

  return (
    <Sidebar open={isOpen} onOpenChange={(nextOpen) => !nextOpen && onClose()} title="Add Task" description={`Pipeline: ${pipelineSlug}`}>
      <SidebarSection>
        <div className="mb-4 flex flex-wrap gap-2">
          {artifacts.map((artifact) => (
            <button key={artifact} type="button" className="rounded-full border px-3 py-1 text-xs" onClick={() => setInput((value) => `${value}@${artifact} `)}>
              @{artifact}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`rounded-lg p-3 ${message.role === "user" ? "bg-gray-900 text-white" : "bg-gray-100"}`}>
              {message.role === "assistant" ? <MarkdownRenderer content={message.content} /> : message.content}
            </div>
          ))}
          {proposals.map((proposal) => (
            <div key={`${proposal.filename}-${proposal.taskName}`} className="rounded-sm border border-gray-300 p-3">
              <div className="text-sm font-medium">{proposal.taskName}</div>
              <div className="text-xs text-gray-500">{proposal.filename}</div>
              <Button size="sm" className="mt-3" onClick={() => void createTask(proposal)}>
                Create Task
              </Button>
            </div>
          ))}
          {error ? (
            <div className="rounded-sm border-l-[3px] border-l-red-600 bg-red-100 p-3 text-sm text-red-700">
              {error}
              <Button size="sm" className="mt-3" onClick={() => messages.length > 0 && void send(messages.filter((message) => message.role === "user").at(-1)?.content ?? "")}>
                Retry
              </Button>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </SidebarSection>
      <SidebarFooter>
        <textarea
          className="min-h-24 flex-1 rounded-md border px-3 py-2 text-sm"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={disabled}
        />
        <Button disabled={disabled || input.trim().length === 0} onClick={() => {
          const value = input.trim();
          setInput("");
          void send(value);
        }}>
          Send
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
