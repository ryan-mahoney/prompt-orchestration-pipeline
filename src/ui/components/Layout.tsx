import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Upload } from "lucide-react";

import type { LayoutProps } from "./types";
import UploadSeed from "./UploadSeed";
import { WelcomeModal } from "./onboarding";
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
      <WelcomeModal />
      <header className="sticky top-0 z-20 border-b h-18 border-gray-200 bg-white">
        <div
          className={[
            "mx-auto flex items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8",
            maxWidth,
          ].join(" ")}
        >
          <div className="flex items-center gap-5">
            <Link to="/" className="flex items-center gap-3">
              <div className="h-10 w-10">
                <Logo />
              </div>
              <div className="text-md font-bold text-gray-900">
                Prompt Pipeline
              </div>
            </Link>
            <nav className="hidden md:block" aria-label="Main navigation">
              <ul className="flex items-center gap-2">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      className={`px-3 py-2 text-sm ${location.pathname.startsWith(item.href) ? "text-[#6d28d9] font-medium" : "text-gray-500 hover:text-gray-900"}`}
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
            <Button
              type="button"
              onClick={() => setUploadOpen((value) => !value)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Seed
            </Button>
          </div>
        </div>
      </header>

      {uploadOpen ? (
        <div className="border-b bg-[#f5f3ff]">
          <div
            className={[
              "mx-auto space-y-3 px-4 py-4 sm:px-6 lg:px-8",
              maxWidth,
            ].join(" ")}
          >
            {successJob ? (
              <div className="rounded-sm border-l-[3px] border-l-green-600 bg-green-100 p-3 text-sm text-green-700">
                Job {successJob} created successfully
              </div>
            ) : null}
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

      <main
        className={["mx-auto w-full px-4 py-8 sm:px-6 lg:px-8", maxWidth].join(
          " ",
        )}
      >
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-[-0.01em]">
              {pageTitle ?? breadcrumbs?.at(-1)?.label ?? "Prompt Pipeline"}
            </h1>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
