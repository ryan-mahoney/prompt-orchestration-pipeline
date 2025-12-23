import * as Dialog from "@radix-ui/react-dialog";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

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
      navigate(`/pipelines/${slug}`);
    } catch (err) {
      setError(err.message || "Failed to create pipeline");
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 w-96 bg-white p-6 shadow-xl flex flex-col overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold mb-4">
            Add a Pipeline Type
          </Dialog.Title>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1">
            <label className="block mb-4">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="My Pipeline"
              />
            </label>

            <label className="block mb-4">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="Describe what this pipeline does"
              />
            </label>

            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

            <div className="flex gap-3 mt-auto pt-4">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AddPipelineSidebar;
