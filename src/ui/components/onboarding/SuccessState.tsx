import type { ReactNode } from "react";

type SuccessStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function SuccessState({ title, description, action }: SuccessStateProps) {
  return (
    <div className="text-center py-12 px-6">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-brand-600 mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 max-w-[380px] mx-auto mb-6 leading-relaxed">{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
