import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { Button } from "../ui/Button";

const RADIO_OPTIONS = [
  { id: "job-architecture", label: "Job architecture" },
  { id: "competency-models", label: "Competency models" },
  { id: "exploring", label: "Exploring" },
] as const;

export function WelcomeModal() {
  const [open, setOpen] = useState(() => !localStorage.getItem("hasSeenWelcome"));
  const [selected, setSelected] = useState<string>("");

  function handleClose() {
    localStorage.setItem("hasSeenWelcome", "1");
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[400] bg-[#111827]/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[400] -translate-x-1/2 -translate-y-1/2 bg-white border border-gray-200 rounded-lg shadow-lg max-w-[480px] w-full overflow-hidden"
          aria-describedby="welcome-modal-description"
        >
          {/* Header */}
          <div className="p-8 pb-0 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-[14px] bg-[#f0fdf4] mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <Dialog.Title className="text-xl font-bold text-gray-900 mb-2">Welcome</Dialog.Title>
            <p id="welcome-modal-description" className="text-base text-gray-500 max-w-[360px] mx-auto leading-relaxed">
              Get started by telling us what you are building so we can tailor your experience.
            </p>
          </div>

          {/* Body */}
          <div className="p-6 px-8">
            <label className="block text-sm font-medium text-gray-900 mb-3">What are you building?</label>
            <div className="flex flex-col gap-2">
              {RADIO_OPTIONS.map((option) => {
                const isSelected = selected === option.id;
                return (
                  <label
                    key={option.id}
                    className={[
                      "flex items-center gap-3 rounded-md border p-3 cursor-pointer text-sm transition-colors",
                      isSelected
                        ? "border-[#6d28d9] bg-[#f5f3ff] font-medium text-gray-900"
                        : "border-gray-200 text-gray-700 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      name="building"
                      value={option.id}
                      checked={isSelected}
                      onChange={() => setSelected(option.id)}
                      className="accent-[#6d28d9]"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 px-8 pb-8 flex flex-col gap-3 items-center">
            <Button variant="solid" className="w-full" onClick={handleClose}>
              Upload your first seed
            </Button>
            <button
              type="button"
              className="text-sm text-gray-400 hover:text-gray-700"
              onClick={handleClose}
            >
              Skip for now
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
