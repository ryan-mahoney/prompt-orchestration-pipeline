import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
  secondaryAction?: ReactNode;
};

export function EmptyState({ icon, title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <div className="text-center py-16 px-6">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 text-gray-400 mb-4">
        {icon}
      </div>
      <h3 className="text-md font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 max-w-[360px] mx-auto mb-6 leading-relaxed">{description}</p>
      <div>{action}</div>
      {secondaryAction ? <div className="mt-4">{secondaryAction}</div> : null}
    </div>
  );
}
