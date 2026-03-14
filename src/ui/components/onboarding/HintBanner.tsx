import { type ReactNode, useCallback, useState } from "react";
import { Info, X, Zap } from "lucide-react";

type HintBannerProps = {
  variant?: "info" | "action";
  title: string;
  children: ReactNode;
  storageKey: string;
  onDismiss?: () => void;
};

const variantStyles = {
  info: {
    container: "bg-[#f5f3ff] border border-[#ede9fe]",
    Icon: Info,
    iconColor: "text-[#6d28d9]",
  },
  action: {
    container: "bg-[#f0fdf4] border border-[#dcfce7]",
    Icon: Zap,
    iconColor: "text-brand-600",
  },
} as const;

export function HintBanner({ variant = "info", title, children, storageKey, onDismiss }: HintBannerProps) {
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem("dismissed:" + storageKey));

  const handleDismiss = useCallback(() => {
    localStorage.setItem("dismissed:" + storageKey, "1");
    setDismissed(true);
    onDismiss?.();
  }, [storageKey, onDismiss]);

  if (dismissed) return null;

  const { container, Icon, iconColor } = variantStyles[variant];

  return (
    <div className={`flex items-start gap-3 p-4 px-5 text-sm text-gray-700 rounded-md ${container}`}>
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColor}`} />
      <div className="flex-1">
        <span className="font-medium text-gray-900">{title}</span>
        <div>{children}</div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-gray-400 hover:text-gray-700 flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
