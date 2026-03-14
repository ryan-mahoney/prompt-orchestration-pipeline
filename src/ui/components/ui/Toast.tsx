import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { ReactNode } from "react";

import type { Toast, ToastContextValue, ToastType } from "../types";

const DEFAULT_DURATION_MS = 5000;
const ToastContext = createContext<ToastContextValue | null>(null);

function toastClasses(type: ToastType): string {
  switch (type) {
    case "success":
      return "bg-green-100 border-l-green-600 text-green-700";
    case "error":
      return "bg-red-100 border-l-red-600 text-red-700";
    case "warning":
      return "bg-yellow-100 border-l-yellow-600 text-yellow-700";
    default:
      return "bg-blue-100 border-l-blue-700 text-blue-700";
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
      <div className="fixed right-4 top-4 z-[500] space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            aria-live="polite"
            className={["max-w-sm rounded-sm border-l-[3px] p-4 shadow-sm", toastClasses(toast.type)].join(" ")}
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
