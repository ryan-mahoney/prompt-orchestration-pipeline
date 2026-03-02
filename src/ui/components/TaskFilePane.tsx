import { useEffect, useMemo, useRef, useState } from "react";

import MarkdownRenderer from "./MarkdownRenderer";
import type { FilePaneType } from "./types";
import { Button } from "./ui/Button";
import { CopyableCodeBlock } from "./ui/CopyableCode";

const ALLOWED_TYPES: FilePaneType[] = ["artifacts", "logs", "tmp"];
const MAX_PREVIEW_BYTES = 500 * 1024;

type FileResponse = {
  ok: boolean;
  data?: string;
  mime?: string;
  size?: number;
  message?: string;
};

function isBinaryMime(mime: string | null): boolean {
  if (mime === null) return false;
  return mime.startsWith("image/") || mime === "application/octet-stream";
}

export function TaskFilePane({
  isOpen,
  jobId,
  taskId,
  type,
  filename,
  onClose,
  inline = false,
}: {
  isOpen: boolean;
  jobId: string;
  taskId: string;
  type: FilePaneType;
  filename: string;
  onClose: () => void;
  inline?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (!ALLOWED_TYPES.includes(type)) {
      setError(`Invalid file type: ${type}`);
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);

    void fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/file?type=${encodeURIComponent(type)}&filename=${encodeURIComponent(filename)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json()) as FileResponse;
        if (!response.ok || payload.ok !== true) {
          throw new Error(`${type}/${filename}: ${payload.message ?? `HTTP ${response.status}`}`);
        }
        setContent(payload.data ?? "");
        setMime(payload.mime ?? null);
        setSize(payload.size ?? null);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : `${type}/${filename}: failed to load`);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [filename, isOpen, jobId, retryCounter, taskId, type]);

  const truncated = useMemo(() => {
    if (content === null) return { text: "", isTruncated: false };
    if (content.length <= MAX_PREVIEW_BYTES) return { text: content, isTruncated: false };
    return { text: content.slice(0, MAX_PREVIEW_BYTES), isTruncated: true };
  }, [content]);

  const body = (() => {
    if (loading) return <div className="text-sm text-slate-500">Loading file…</div>;
    if (error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{error}</p>
          <Button size="sm" className="mt-3" onClick={() => setRetryCounter((value) => value + 1)}>
            Retry
          </Button>
        </div>
      );
    }
    if (content === null) return null;
    if (isBinaryMime(mime)) {
      return <div className="text-sm text-slate-600">Binary file - cannot display preview {size ? `(${size} bytes)` : ""}</div>;
    }
    if (mime === "application/json" || filename.endsWith(".json")) {
      try {
        return <CopyableCodeBlock>{JSON.stringify(JSON.parse(truncated.text), null, 2)}</CopyableCodeBlock>;
      } catch {
        return <pre className="whitespace-pre-wrap text-sm">{truncated.text}</pre>;
      }
    }
    if (mime === "text/markdown" || filename.endsWith(".md")) {
      return <MarkdownRenderer content={truncated.text} />;
    }
    if ((mime ?? "").startsWith("text/") || mime === null) {
      return <pre className="whitespace-pre-wrap text-sm">{truncated.text}</pre>;
    }
    return <pre className="whitespace-pre-wrap text-sm">{truncated.text}</pre>;
  })();

  const contentEl = (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{filename}</p>
          <p className="text-xs text-slate-500">{type}</p>
        </div>
        {!inline ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
      {truncated.isTruncated ? <div className="text-xs text-amber-700">(truncated)</div> : null}
      {body}
    </div>
  );

  if (inline) return contentEl;

  return isOpen ? <div className="fixed inset-0 z-[2100] overflow-auto bg-black/40 p-6">{contentEl}</div> : null;
}
