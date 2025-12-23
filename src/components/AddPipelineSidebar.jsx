import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button.jsx";
import { Sidebar, SidebarFooter } from "./ui/sidebar.jsx";

export function AddPipelineSidebar({ open, onOpenChange }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (!name.trim() || !description.trim()) {
      setError("Name and description are required");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/pipelines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to create pipeline");
      }

      const { slug } = await response.json();
      onOpenChange(false);

      // Wait for watcher to detect registry change and reload config
      await new Promise((resolve) => setTimeout(resolve, 1000));

      navigate(`/pipelines/${slug}`);
    } catch (err) {
      setError(err.message || "Failed to create pipeline");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sidebar
      open={open}
      onOpenChange={onOpenChange}
      title="Add Pipeline Type"
      description="Create a new pipeline type for your workflow"
    >
      <form onSubmit={handleSubmit}>
        <div className="p-6 space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background"
              placeholder="My Pipeline"
              aria-describedby="name-description"
            />
            <span
              id="name-description"
              className="text-xs text-muted-foreground"
            >
              A unique identifier for this pipeline type
            </span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background resize-none"
              placeholder="Describe what this pipeline does"
              aria-describedby="description-description"
            />
            <span
              id="description-description"
              className="text-xs text-muted-foreground"
            >
              Explain the purpose and expected outcomes
            </span>
          </label>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <SidebarFooter>
          <Button
            variant="outline"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="solid"
            size="md"
            type="submit"
            loading={submitting}
            className="flex-1"
          >
            Create
          </Button>
        </SidebarFooter>
      </form>
    </Sidebar>
  );
}

export default AddPipelineSidebar;
