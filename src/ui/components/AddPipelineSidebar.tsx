import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "./ui/Button";
import { Sidebar, SidebarFooter, SidebarSection } from "./ui/Sidebar";

export function AddPipelineSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(false);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setError(null);
      setSubmitting(false);
      setPendingNavigation(false);
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const payload = await response.json() as { slug?: string; message?: string; ok?: boolean; data?: { slug?: string } };
      const slug = payload.slug ?? payload.data?.slug;
      if (!response.ok || typeof slug !== "string" || slug.length === 0) {
        throw new Error(payload.message ?? "Failed to create pipeline");
      }

      setPendingNavigation(true);
      timeoutRef.current = setTimeout(() => {
        navigate(`/pipelines/${slug}`);
      }, 1000);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create pipeline");
      setSubmitting(false);
      setPendingNavigation(false);
    }
  };

  return (
    <Sidebar open={open} onOpenChange={onOpenChange} title="Add Pipeline Type" description="Create a new pipeline definition.">
      <form onSubmit={handleSubmit}>
        <SidebarSection>
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input
                className="w-full rounded-md border px-3 py-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={submitting || pendingNavigation}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Description</span>
              <textarea
                className="min-h-28 w-full rounded-md border px-3 py-2"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting || pendingNavigation}
              />
            </label>
            {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          </div>
        </SidebarSection>
        <SidebarFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting || pendingNavigation}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting || pendingNavigation} disabled={!name.trim() || !description.trim()}>
            {pendingNavigation ? "Creating…" : "Create"}
          </Button>
        </SidebarFooter>
      </form>
    </Sidebar>
  );
}

export default AddPipelineSidebar;
