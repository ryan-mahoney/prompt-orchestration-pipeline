type Step = {
  label: string;
  status: "done" | "active" | "pending";
};

type SetupStepperProps = {
  steps: Step[];
};

export function SetupStepper({ steps }: SetupStepperProps) {
  return (
    <div className="flex items-center">
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center">
          {/* Connector line (before step, except first) */}
          {index > 0 ? (
            <div
              className={[
                "w-10 h-0.5 mx-2 flex-shrink-0",
                steps[index - 1]?.status === "done" ? "bg-brand-600" : "bg-gray-200",
              ].join(" ")}
            />
          ) : null}

          {/* Step circle */}
          <div className="flex items-center gap-2">
            <div
              className={[
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2",
                step.status === "done"
                  ? "bg-brand-600 border-brand-600 text-white"
                  : step.status === "active"
                    ? "border-[#6d28d9] text-[#6d28d9] bg-accent-50"
                    : "border-gray-300 text-gray-400",
              ].join(" ")}
            >
              {step.status === "done" ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2.5 6.5L5 9l4.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                index + 1
              )}
            </div>

            {/* Label */}
            <span
              className={[
                "text-sm whitespace-nowrap",
                step.status === "done"
                  ? "text-gray-500"
                  : step.status === "active"
                    ? "font-medium text-gray-900"
                    : "text-gray-400",
              ].join(" ")}
            >
              {step.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
