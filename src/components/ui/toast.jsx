import React, { createContext, useContext, useState, useCallback } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";

// Toast context for managing toast notifications
const ToastContext = createContext();

/**
 * Toast Provider component that manages toast state
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, options = {}) => {
    const toast = {
      id: Date.now() + Math.random(),
      message,
      type: options.type || "info",
      duration: options.duration || 5000,
    };

    setToasts((prev) => [...prev, toast]);

    // Auto-remove toast after duration
    if (toast.duration > 0) {
      setTimeout(() => {
        removeToast(toast.id);
      }, toast.duration);
    }

    return toast.id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const value = {
    addToast,
    removeToast,
    success: (message, options) =>
      addToast(message, { ...options, type: "success" }),
    error: (message, options) =>
      addToast(message, { ...options, type: "error" }),
    warning: (message, options) =>
      addToast(message, { ...options, type: "warning" }),
    info: (message, options) => addToast(message, { ...options, type: "info" }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

/**
 * Hook to use toast functionality
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

/**
 * Toast container component that renders all active toasts
 */
function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

/**
 * Individual toast item component
 */
function ToastItem({ toast, onRemove }) {
  const getToastStyles = (type) => {
    switch (type) {
      case "success":
        return "bg-green-50 border-green-200 text-green-800";
      case "error":
        return "bg-red-50 border-red-200 text-red-800";
      case "warning":
        return "bg-yellow-50 border-yellow-200 text-yellow-800";
      default:
        return "bg-blue-50 border-blue-200 text-blue-800";
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case "success":
        return "✓";
      case "error":
        return "✕";
      case "warning":
        return "⚠";
      default:
        return "ℹ";
    }
  };

  return (
    <Box
      className={`relative flex items-start p-4 border rounded-lg shadow-lg max-w-sm ${getToastStyles(
        toast.type
      )}`}
      role="alert"
      aria-live="polite"
    >
      <Flex gap="3" align="start">
        <Text className="flex-shrink-0 text-lg font-semibold">
          {getIcon(toast.type)}
        </Text>
        <Text className="text-sm font-medium flex-1">{toast.message}</Text>
        <button
          onClick={() => onRemove(toast.id)}
          className="flex-shrink-0 ml-4 text-sm opacity-60 hover:opacity-100 focus:outline-none focus:opacity-100"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </Flex>
    </Box>
  );
}

export default ToastProvider;
