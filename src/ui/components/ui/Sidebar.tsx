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
          <Dialog.Overlay className="fixed inset-0 z-[300] bg-[#111827]/40" />
          <Dialog.Content
            ref={ref}
            aria-describedby={description ? descriptionId : undefined}
            className={[
              "fixed inset-y-0 right-0 z-[400] flex flex-col w-[480px] max-w-[calc(100vw-48px)] bg-white border-l border-gray-200",
              contentClassName,
            ].join(" ")}
          >
            {title ? (
              <Dialog.Title
                className={[
                  "px-6 py-4 text-md font-semibold text-gray-900 border-b border-gray-200",
                  "",
                  headerClassName,
                ].join(" ")}
              >
                {title}
              </Dialog.Title>
            ) : null}
            {description ? (
              <Dialog.Description id={descriptionId} className="px-6 pb-4 pt-3 text-sm text-gray-600">
                {description}
              </Dialog.Description>
            ) : null}
            <Dialog.Close asChild>
              <button
                type="button"
                className="absolute right-4 top-4 rounded-sm w-9 h-9 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
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
  return <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-white">{children}</div>;
}

export function SidebarSection({ children }: { children: ReactNode }) {
  return <div className="p-6">{children}</div>;
}
