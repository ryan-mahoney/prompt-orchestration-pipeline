import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { ReactNode } from "react";

import type { Toast, ToastContextValue, ToastType } from "../types";

const DEFAULT_DURATION_MS = 5000;
const ToastContext = createContext<ToastContextValue | null>(null);

function toastClasses(type: ToastType): string {
  switch (type) {
    case "success":
      return "border-green-200 bg-green-50 text-green-800";
    case "error":
      return "border-red-200 bg-red-50 text-red-800";
    case "warning":
      return "border-yellow-200 bg-yellow-50 text-yellow-800";
    default:
      return "border-blue-200 bg-blue-50 text-blue-800";
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const toast = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      message,
    } satisfies Toast;

    setToasts((current) => [...current, toast]);
    setTimeout(() => removeToast(toast.id), DEFAULT_DURATION_MS);
  }, [removeToast]);

  const value = useMemo<ToastContextValue>(() => ({
    addToast,
    success: (message) => addToast("success", message),
    error: (message) => addToast("error", message),
    warning: (message) => addToast("warning", message),
    info: (message) => addToast("info", message),
  }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[2100] space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            aria-live="polite"
            className={["max-w-sm rounded-lg border p-4 shadow-lg", toastClasses(toast.type)].join(" ")}
          >
            <div className="flex items-start gap-3">
              <span className="flex-1 text-sm font-medium">{toast.message}</span>
              <button type="button" aria-label="Dismiss notification" onClick={() => removeToast(toast.id)}>
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}
