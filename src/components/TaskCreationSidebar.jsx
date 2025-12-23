import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button.jsx";
import { Sidebar, SidebarFooter } from "./ui/sidebar.jsx";

function MessageContent({ content }) {
  // Split content by code blocks (```...```)
  const parts = content.split(/```(\w+)?\n([\s\S]*?)```/g);

  return (
    <>
      {parts.map((part, index) => {
        // Odd indices are code blocks (language is index-1, code is index)
        if (index % 2 === 1) {
          const code = parts[index + 1] || "";
          const language = part || "";
          return (
            <div key={index} className="relative group">
              <pre className="bg-muted text-muted-foreground p-3 rounded mt-2 overflow-x-auto">
                <code className={`language-${language} text-sm`}>{code}</code>
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="absolute top-2 right-2 bg-muted-foreground text-background text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Copy
              </button>
            </div>
          );
        }
        // Even indices are regular text
        if (part.trim()) {
          return (
            <p key={index} className="whitespace-pre-wrap">
              {part}
            </p>
          );
        }
        return null;
      })}
    </>
  );
}

export default function TaskCreationSidebar({ isOpen, onClose, pipelineSlug }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    onClose();
  };

  const handleSend = (e) => {
    e.preventDefault();

    if (!input.trim()) return;

    const newMessage = { role: "user", content: input.trim() };
    setMessages([...messages, newMessage]);
    setInput("");
    setIsStreaming(true);
    setError(null);

    sendToAPI([...messages, newMessage]);
  };

  const sendToAPI = async (allMessages) => {
    // Add empty assistant message to accumulate response
    setMessages([...allMessages, { role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/ai/task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMessages, pipelineSlug }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (currentEvent === "chunk" && data.content) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1].content += data.content;
                return updated;
              });
            } else if (currentEvent === "error" && data.message) {
              setError(data.message);
            }
          }
        }
      }
    } catch (err) {
      setError(`Connection failed: ${err.message}`);
    } finally {
      setIsStreaming(false);
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
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-lg p-3 max-w-[80%] ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <MessageContent content={msg.content} />
            </div>
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
            disabled={isStreaming}
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
              disabled={isStreaming || !input.trim()}
            >
              {isStreaming ? "Sending..." : "Send"}
            </Button>
          </div>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
