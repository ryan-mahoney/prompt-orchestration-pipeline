import { useState } from "react";

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
          {/* Message rendering will be implemented in step 5 */}
          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-8">
              Describe the task you want to create...
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
