import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

/**
 * MarkdownRenderer component for rendering markdown content with syntax highlighting
 * @param {Object} props - Component props
 * @param {string} props.content - Markdown content to render
 * @param {string} props.className - Additional CSS classes
 */
export function MarkdownRenderer({ content, className = "" }) {
  const [copiedCode, setCopiedCode] = useState(null);

  // Handle code copy
  const handleCopyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  // Custom code block component with copy button
  const CodeBlock = ({ children, className: codeClassName }) => {
    const language = codeClassName?.replace("language-", "") || "text";
    const code = React.Children.toArray(children).join("");
    const isCopied = copiedCode === code;

    return (
      <div className="relative group">
        <pre className="!bg-muted !text-foreground rounded-lg p-4 overflow-x-auto mt-3 mb-3">
          <code className={codeClassName}>{children}</code>
        </pre>
        <button
          onClick={() => handleCopyCode(code)}
          className="absolute top-2 right-2 bg-muted-foreground/80 text-background text-xs px-2 py-1 rounded hover:bg-muted-foreground transition-opacity opacity-0 group-hover:opacity-100"
          aria-label="Copy code to clipboard"
        >
          {isCopied ? "Copied!" : "Copy"}
        </button>
        {language !== "text" && (
          <span className="absolute top-2 left-2 text-xs text-muted-foreground">
            {language}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className={`!max-w-none prose prose-sm dark:prose-invert ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock,
          h1: ({ children }) => (
            <h1 className="text-xl font-bold mb-3 text-foreground">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mb-2 text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-medium mb-2 text-foreground">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-3 text-foreground leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-3 space-y-1 text-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-3 space-y-1 text-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="ml-2">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-primary hover:text-primary/80 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/50 pl-4 py-2 my-3 bg-muted/30 italic text-foreground/80">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse border border-border text-foreground">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/50">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border hover:bg-muted/20">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="border border-border px-4 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-4 py-2">{children}</td>
          ),
          hr: () => <hr className="my-4 border-border" />,
          strong: ({ children }) => (
            <strong className="font-bold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-foreground">{children}</em>
          ),
          del: ({ children }) => (
            <del className="line-through text-muted-foreground">{children}</del>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
