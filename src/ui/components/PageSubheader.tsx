import type { ReactNode } from "react";

import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import type { Breadcrumb } from "./types";

export default function PageSubheader({
  breadcrumbs,
  children,
  maxWidth = "max-w-7xl",
}: {
  breadcrumbs: Breadcrumb[];
  children?: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div role="region" aria-label="Page header" className="mb-4 border-b border-gray-200 bg-white">
      <div className={["mx-auto flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8", maxWidth].join(" ")}>
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 text-base text-gray-500">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                {index > 0 ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : null}
                {crumb.href ? (
                  <Link to={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span className={index === breadcrumbs.length - 1 ? "text-gray-900 font-medium" : undefined} aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {children ? <div className="shrink-0">{children}</div> : null}
      </div>
    </div>
  );
}
