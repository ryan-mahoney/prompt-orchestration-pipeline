type ChecklistItem = {
  id: string;
  label: string;
  subtext?: string;
  status: "done" | "active" | "pending";
};

type OnboardingChecklistProps = {
  items: ChecklistItem[];
  onItemClick: (id: string) => void;
  onDismiss: () => void;
};

export function OnboardingChecklist({ items, onItemClick, onDismiss }: OnboardingChecklistProps) {
  const doneCount = items.filter((item) => item.status === "done").length;
  const total = items.length;

  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden w-80">
      {/* Header */}
      <div className="p-4 px-5 border-b border-gray-200 flex items-center justify-between">
        <span className="text-base font-semibold text-gray-900">Getting started</span>
        <span className="text-sm text-gray-500 font-mono">
          {doneCount}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-[3px] bg-gray-100">
        <div
          className="h-full bg-brand-600 transition-[width] duration-[400ms]"
          style={{ width: `${(doneCount / total) * 100}%` }}
        />
      </div>

      {/* Items */}
      <ul className="list-none">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="w-full flex items-start gap-3 py-3 px-5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer text-left"
              onClick={() => onItemClick(item.id)}
            >
              <span
                className={[
                  "w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center",
                  item.status === "done"
                    ? "bg-brand-600 border-brand-600"
                    : item.status === "active"
                      ? "border-[#6d28d9]"
                      : "border-gray-300",
                ].join(" ")}
              >
                {item.status === "done" ? (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2.5 6.5L5 9l4.5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <span className="flex flex-col min-w-0">
                <span
                  className={[
                    "text-sm",
                    item.status === "done"
                      ? "text-gray-400 line-through"
                      : item.status === "active"
                        ? "font-medium text-gray-900"
                        : "text-gray-500",
                  ].join(" ")}
                >
                  {item.label}
                </span>
                {item.subtext ? (
                  <span className="text-xs text-gray-400 mt-0.5">{item.subtext}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Dismiss */}
      <div className="px-5 py-3 border-t border-gray-200">
        <button
          type="button"
          className="text-xs text-gray-400 hover:text-gray-700"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
