import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { useId } from "react";
import { X } from "lucide-react";

import type { SidebarProps } from "../types";

export const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(
  (
    {
      open,
      onOpenChange,
      title,
      description,
      headerClassName = "",
      contentClassName = "",
      showHeaderBorder = true,
      children,
    },
    ref,
  ) => {
    const descriptionId = useId();

    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[1999] bg-black/40 backdrop-blur-sm" />
          <Dialog.Content
            ref={ref}
            aria-describedby={description ? descriptionId : undefined}
            className={[
              "fixed inset-y-0 right-0 z-[2000] w-full min-w-[384px] max-w-[900px] bg-white shadow-2xl",
              contentClassName,
            ].join(" ")}
          >
            {title ? (
              <Dialog.Title
                className={[
                  "px-6 py-4 text-lg font-semibold",
                  showHeaderBorder ? "border-b" : "",
                  headerClassName,
                ].join(" ")}
              >
                {title}
              </Dialog.Title>
            ) : null}
            {description ? (
              <Dialog.Description id={descriptionId} className="px-6 pb-4 pt-3 text-sm text-slate-600">
                {description}
              </Dialog.Description>
            ) : null}
            <Dialog.Close asChild>
              <button
                type="button"
                className="absolute right-4 top-4 rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  },
);

Sidebar.displayName = "Sidebar";

export function SidebarFooter({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 border-t bg-white p-6">{children}</div>;
}

export function SidebarSection({ children }: { children: ReactNode }) {
  return <div className="p-6">{children}</div>;
}
