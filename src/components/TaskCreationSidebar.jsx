import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button.jsx";
import { Sidebar, SidebarFooter } from "./ui/sidebar.jsx";
import { MarkdownRenderer } from "./MarkdownRenderer.jsx";

const TASK_PROPOSAL_REGEX =
  /\[TASK_PROPOSAL\]\r?\nFILENAME:\s*(\S+)\r?\nTASKNAME:\s*(\S+)\r?\nCODE:\s*```javascript\s*([\s\S]*?)\s*```\s*\[\/TASK_PROPOSAL\]/;

function parseTaskProposal(content) {
  const match = content.match(TASK_PROPOSAL_REGEX);
  if (!match) return null;

  const [, filename, taskName, code] = match;
  return { filename, taskName, code, proposalBlock: match[0] };
}

function TaskProposalCard({ proposal, isCreating, onCreate }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-3 p-4 bg-card border border-border rounded-lg shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
              Task Proposal
            </span>
          </div>
          <p className="text-sm font-medium text-foreground">
            {proposal.filename}
          </p>
          <p className="text-xs text-muted-foreground">{proposal.taskName}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? "Hide" : "Show"} code
        </button>
      </div>
      {isExpanded && (
        <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
          <code>{proposal.code}</code>
        </pre>
      )}
      {proposal.error && (
        <p className="mt-2 text-sm text-destructive">{proposal.error}</p>
      )}
      {proposal.created && (
        <p className="mt-2 text-sm text-green-600 dark:text-green-400">
          ✓ Task created successfully
        </p>
      )}
      {!proposal.created && (
        <div className="mt-3">
          <Button
            variant="solid"
            size="sm"
            onClick={onCreate}
            disabled={isCreating}
          >
            {isCreating ? "Creating..." : "Create Task"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function TaskCreationSidebar({ isOpen, onClose, pipelineSlug }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [error, setError] = useState(null);
  const [taskProposals, setTaskProposals] = useState({});
  const [creatingTask, setCreatingTask] = useState({});
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Detect task proposals in assistant messages
  useEffect(() => {
    const newProposals = {};
    messages.forEach((msg, i) => {
      if (msg.role === "assistant") {
        const proposal = parseTaskProposal(msg.content);
        if (proposal) {
          newProposals[i] = proposal;
        }
      }
    });
    setTaskProposals(newProposals);
  }, [messages]);

  // Beforeunload warning when messages exist
  useEffect(() => {
    if (messages.length === 0) return;
    const handleUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    /* eslint-disable-next-line no-restricted-globals */
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      /* eslint-disable-next-line no-restricted-globals */
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [messages.length]);

  // Close handler with confirmation
  const handleClose = () => {
    /* eslint-disable-next-line no-restricted-globals */
    if (messages.length > 0 && !confirm("Close and lose conversation?")) return;
    setMessages([]);
    setInput("");
    setError(null);
    setTaskProposals({});
    setCreatingTask({});
    onClose();
  };

  const handleSend = (e) => {
    e.preventDefault();

    if (!input.trim()) return;

    const newMessage = { role: "user", content: input.trim() };
    setMessages([...messages, newMessage]);
    setInput("");
    setIsSending(true);
    setIsWaiting(true);
    setIsReceiving(false);
    setError(null);

    sendToAPI([...messages, newMessage]);
  };

  const handleCreateTask = async (messageIndex, proposal) => {
    setCreatingTask((prev) => ({ ...prev, [messageIndex]: true }));
    setTaskProposals((prev) => {
      const updated = { ...prev };
      if (updated[messageIndex]) {
        updated[messageIndex] = { ...updated[messageIndex], error: null };
      }
      return updated;
    });

    try {
      const response = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineSlug,
          filename: proposal.filename,
          taskName: proposal.taskName,
          code: proposal.code,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTaskProposals((prev) => {
          const updated = { ...prev };
          if (updated[messageIndex]) {
            updated[messageIndex] = {
              ...updated[messageIndex],
              created: true,
              path: data.path,
            };
          }
          return updated;
        });
      } else {
        const errorData = await response.json();
        setTaskProposals((prev) => {
          const updated = { ...prev };
          if (updated[messageIndex]) {
            updated[messageIndex] = {
              ...updated[messageIndex],
              error: errorData.message || "Failed to create task",
            };
          }
          return updated;
        });
      }
    } catch (err) {
      setTaskProposals((prev) => {
        const updated = { ...prev };
        if (updated[messageIndex]) {
          updated[messageIndex] = {
            ...updated[messageIndex],
            error: "Network error: " + err.message,
          };
        }
        return updated;
      });
    } finally {
      setCreatingTask((prev) => ({ ...prev, [messageIndex]: false }));
    }
  };

  const sendToAPI = async (allMessages) => {
    console.log("[TaskCreationSidebar] Starting API call with:", {
      messageCount: allMessages.length,
      pipelineSlug,
    });

    // Add empty assistant message to accumulate response
    setMessages([...allMessages, { role: "assistant", content: "" }]);

    // Transition: sending → waiting after 300ms
    setTimeout(() => setIsSending(false), 300);

    try {
      console.log("[TaskCreationSidebar] Fetching /api/ai/task-plan...");
      const response = await fetch("/api/ai/task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMessages, pipelineSlug }),
      });

      console.log("[TaskCreationSidebar] Response received:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[TaskCreationSidebar] Non-OK response:", errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let chunksReceived = 0;

      console.log("[TaskCreationSidebar] Starting to read SSE stream...");
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(
            "[TaskCreationSidebar] Stream ended. Total chunks received:",
            chunksReceived
          );
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
            console.log("[TaskCreationSidebar] SSE event type:", currentEvent);
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log("[TaskCreationSidebar] SSE data received:", {
                eventType: currentEvent,
                hasContent: !!data.content,
                message: data.message,
              });

              if (currentEvent === "chunk" && data.content) {
                // Transition: waiting → receiving on first chunk
                if (chunksReceived === 0) {
                  setIsWaiting(false);
                  setIsReceiving(true);
                }
                chunksReceived++;
                setMessages((prev) => {
                  const updated = [...prev];
                  // Create shallow copy of message object to avoid mutation
                  const lastMsg = { ...updated[updated.length - 1] };
                  lastMsg.content += data.content;
                  updated[updated.length - 1] = lastMsg;
                  return updated;
                });
              } else if (currentEvent === "error" && data.message) {
                console.error(
                  "[TaskCreationSidebar] SSE error event:",
                  data.message
                );
                setError(data.message);
              } else if (currentEvent === "done") {
                console.log("[TaskCreationSidebar] SSE done event received");
              }
              // Reset current event after processing data
              currentEvent = "";
            } catch (parseError) {
              console.error(
                "[TaskCreationSidebar] Failed to parse SSE data:",
                parseError,
                "Raw line:",
                line
              );
            }
          }
        }
      }
    } catch (err) {
      console.error("[TaskCreationSidebar] Error in sendToAPI:", err);
      setError(`Connection failed: ${err.message}`);
    } finally {
      console.log("[TaskCreationSidebar] sendToAPI completed");
      setIsWaiting(false);
      setIsReceiving(false);
      setIsSending(false);
    }
  };

  return (
    <Sidebar
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      title="Task Assistant"
      description="Describe the task you want to create"
      contentClassName="flex flex-col max-h-screen"
    >
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i}>
            <div
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`rounded-lg p-3 max-w-full ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {msg.role === "assistant" ? (
                  <>
                    <MarkdownRenderer
                      content={msg.content.replace(TASK_PROPOSAL_REGEX, "")}
                    />
                    {isWaiting && !msg.content && (
                      <div className="flex items-center gap-1 text-muted-foreground mt-2">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <span
                            key={idx}
                            className="animate-bounce-wave"
                            style={{ animationDelay: `${idx * 0.1}s` }}
                          >
                            •
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
            {taskProposals[i] && (
              <TaskProposalCard
                proposal={taskProposals[i]}
                isCreating={creatingTask[i]}
                onCreate={() => handleCreateTask(i, taskProposals[i])}
              />
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />

        {error && (
          <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive font-medium mb-2">{error}</p>
            <Button
              variant="destructive"
              size="md"
              onClick={() => {
                setError(null);
                // Re-send last user message
                const lastUserMessageIndex = [...messages]
                  .reverse()
                  .findIndex((m) => m.role === "user");
                if (lastUserMessageIndex !== -1) {
                  const lastUserMessage =
                    messages[messages.length - 1 - lastUserMessageIndex];
                  const messagesBeforeLastUserMessage = messages.slice(
                    0,
                    messages.length - 1 - lastUserMessageIndex
                  );
                  sendToAPI([
                    ...messagesBeforeLastUserMessage,
                    lastUserMessage,
                  ]);
                }
              }}
            >
              Retry
            </Button>
          </div>
        )}
      </div>

      {/* Input area */}
      <SidebarFooter className="bg-card">
        <form onSubmit={handleSend} className="w-full">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isSending || isWaiting || isReceiving}
            placeholder="Describe the task you want to create..."
            rows={3}
            className="w-full border rounded-md px-3 py-2 resize-none disabled:bg-muted disabled:cursor-not-allowed mb-3 focus:outline-none focus:ring-2 focus:ring-ring bg-background"
            aria-label="Task description input"
          />
          <div className="flex justify-end">
            <Button
              variant="solid"
              size="md"
              type="submit"
              disabled={isSending || isWaiting || isReceiving || !input.trim()}
            >
              {isSending && "Sending..."}
              {isWaiting && "Thinking..."}
              {isReceiving && "Receiving..."}
              {!isSending && !isWaiting && !isReceiving && "Send"}
            </Button>
          </div>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
