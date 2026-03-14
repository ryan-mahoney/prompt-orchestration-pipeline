import { useMemo, useRef, useState } from "react";

import type { UploadResult } from "./types";
import { Button } from "./ui/Button";

function normalizeUploadError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Upload failed";
}

function isAcceptedFile(file: File): boolean {
  return file.type === "application/json" || file.type === "application/zip" || /\.json$/i.test(file.name) || /\.zip$/i.test(file.name);
}

export default function UploadSeed({
  onUploadSuccess,
}: {
  onUploadSuccess: (result: UploadResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const hint = useMemo(() => (isDragging ? "Drop seed file" : "Upload JSON or ZIP seed"), [isDragging]);

  const uploadFile = async (file: File) => {
    if (!isAcceptedFile(file)) {
      setError("Only JSON or ZIP seed files are supported");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setIsUploading(true);
    setError(null);
    try {
      const response = await fetch("/api/upload/seed", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { ok?: boolean; data?: UploadResult; message?: string };
      if (!response.ok || payload.ok !== true || payload.data == null) {
        throw new Error(payload.message ?? "Upload failed");
      }

      onUploadSuccess(payload.data);
    } catch (uploadError) {
      setError(normalizeUploadError(uploadError));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={[
          "rounded-lg border border-dashed p-4 text-sm",
          isDragging ? "border-[#6d28d9] bg-[#f5f3ff] border-solid" : "border-gray-300 bg-white",
        ].join(" ")}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void uploadFile(file);
        }}
      >
        <p>{hint}</p>
        <Button className="mt-3" loading={isUploading} onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".json,.zip,application/json,application/zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
      </div>
      {error ? (
        <div className="rounded-sm border-l-[3px] border-l-red-600 bg-red-100 p-3 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" className="mt-2 underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
