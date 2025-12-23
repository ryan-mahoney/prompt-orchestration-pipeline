import { useState } from "react";

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
              <pre className="bg-gray-800 text-gray-100 p-3 rounded mt-2 overflow-x-auto">
                <code className={`language-${language} text-sm`}>{code}</code>
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="absolute top-2 right-2 bg-gray-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
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

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-30"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />

      {/* Sidebar */}
      <div className="fixed inset-y-0 right-0 w-[800px] max-w-full bg-white shadow-xl z-40 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-medium">Task Assistant</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === "user" ? "ml-8" : "mr-8"}>
              <div
                className={`rounded-lg p-3 ${
                  msg.role === "user" ? "bg-blue-100" : "bg-gray-100"
                }`}
              >
                <MessageContent content={msg.content} />
              </div>
            </div>
          ))}

          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-8">
              Describe the task you want to create...
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 font-medium mb-2">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  // Re-send last user message
                  const lastUserMessage = [...messages]
                    .reverse()
                    .find((m) => m.role === "user");
                  if (lastUserMessage) {
                    // This will be connected to sendToAPI in step 7
                    setMessages([...messages]);
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t p-4">
          {/* Input field will be implemented in step 6 */}
        </div>
      </div>
    </>
  );
}
