import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Upload } from "lucide-react";

import type { LayoutProps } from "./types";
import UploadSeed from "./UploadSeed";
import { Logo } from "./ui/Logo";
import { Button } from "./ui/Button";

const NAV_ITEMS = [
  { href: "/pipelines", label: "Pipelines" },
  { href: "/code", label: "Help" },
] as const;

export default function Layout({
  children,
  pageTitle,
  breadcrumbs,
  actions,
  subheader,
  maxWidth = "max-w-7xl",
}: LayoutProps) {
  const location = useLocation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [successJob, setSuccessJob] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-1">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className={["mx-auto flex items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8", maxWidth].join(" ")}>
          <div className="flex items-center gap-5">
            <Link to="/" className="flex items-center gap-3">
              <div className="h-10 w-10">
                <Logo />
              </div>
              <div className="text-sm font-semibold leading-tight">Prompt Pipeline</div>
            </Link>
            <nav className="hidden md:block" aria-label="Main navigation">
              <ul className="flex items-center gap-2">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      className={`rounded-full px-3 py-2 text-sm ${location.pathname.startsWith(item.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <Button type="button" onClick={() => setUploadOpen((value) => !value)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Seed
            </Button>
          </div>
        </div>
      </header>

      {uploadOpen ? (
        <div className="border-b bg-blue-50">
          <div className={["mx-auto space-y-3 px-4 py-4 sm:px-6 lg:px-8", maxWidth].join(" ")}>
            {successJob ? <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">Job {successJob} created successfully</div> : null}
            <UploadSeed
              onUploadSuccess={({ jobName }) => {
                if (timerRef.current !== null) clearTimeout(timerRef.current);
                setSuccessJob(jobName);
                timerRef.current = setTimeout(() => setSuccessJob(null), 5000);
              }}
            />
          </div>
        </div>
      ) : null}

      {subheader}

      <main className={["mx-auto w-full px-4 py-8 sm:px-6 lg:px-8", maxWidth].join(" ")}>
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Operator View</p>
            <h1 className="text-3xl font-semibold tracking-tight">{pageTitle ?? breadcrumbs?.at(-1)?.label ?? "Prompt Pipeline"}</h1>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
