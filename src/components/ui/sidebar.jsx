import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef } from "react";

/**
 * Unified Sidebar Component
 *
 * A consistent, accessible slide-over panel with:
 * - Unified styling and animations
 * - Focus trap and keyboard navigation
 * - Backdrop with click-to-close
 * - Consistent z-index management
 * - Steel Terminal theme compliance
 *
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether sidebar is open
 * @param {Function} props.onOpenChange - Callback when open state changes
 * @param {ReactNode} props.title - Sidebar title
 * @param {string} props.description - Optional description
 * @param {ReactNode} props.children - Sidebar content
 * @param {string} props.className - Additional classes for content area
 * @param {string} props.contentClassName - Additional classes for sidebar panel
 * @param {string} props.headerClassName - Additional classes for header
 * @param {boolean} props.showHeaderBorder - Whether to show header border (default: true)
 */
export const Sidebar = forwardRef(
  (
    {
      open,
      onOpenChange,
      title,
      description,
      children,
      className,
      contentClassName,
      headerClassName,
      showHeaderBorder = true,
      ...props
    },
    ref
  ) => {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[1999] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            ref={ref}
            className={`fixed inset-y-0 right-0 z-[2000] w-full max-w-[640px] min-w-[384px] bg-card shadow-2xl transform transition-all duration-300 ease-in-out data-[state=closed]:translate-x-full data-[state=open]:translate-x-0 data-[state=closed]:animate-out data-[state=open]:animate-in ${contentClassName}`}
            {...props}
          >
            {/* Header */}
            <Dialog.Title
              className={`px-6 py-4 text-lg font-semibold text-foreground ${
                showHeaderBorder ? "border-b" : ""
              } ${headerClassName}`}
            >
              {title}
            </Dialog.Title>

            {description && (
              <Dialog.Description className="px-6 pb-4 text-sm text-muted-foreground">
                {description}
              </Dialog.Description>
            )}

            {/* Close button */}
            <Dialog.Close asChild>
              <button
                type="button"
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors p-2 rounded-md hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>

            {/* Content */}
            <div className={`flex-1 overflow-y-auto ${className}`}>
              {children}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
);

Sidebar.displayName = "Sidebar";

/**
 * SidebarFooter - Standard footer area for sidebars
 * Use for action buttons at the bottom of sidebars
 */
export const SidebarFooter = ({ children, className }) => {
  return (
    <div className={`border-t p-6 bg-card flex gap-3 ${className}`}>
      {children}
    </div>
  );
};

/**
 * SidebarSection - Standard section wrapper
 * Use for grouping related content in sidebars
 */
export const SidebarSection = ({ title, children, className }) => {
  return (
    <div className={`p-6 ${className}`}>
      {title && (
        <h3 className="text-base font-semibold text-foreground mb-4">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
};
