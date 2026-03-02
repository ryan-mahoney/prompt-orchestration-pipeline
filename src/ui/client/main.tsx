import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Theme } from "@radix-ui/themes";
import "./index.css";

import { ToastProvider } from "../components/ui/Toast";
import Code from "../pages/Code";
import PipelineDetail from "../pages/PipelineDetail";
import PipelineList from "../pages/PipelineList";
import PipelineTypeDetail from "../pages/PipelineTypeDetail";
import PromptPipelineDashboard from "../pages/PromptPipelineDashboard";

export const routePaths = [
  "/",
  "/pipeline/:jobId",
  "/pipelines",
  "/pipelines/:slug",
  "/code",
] as const;

export function App() {
  return (
    <StrictMode>
      <ToastProvider>
        <Theme>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<PromptPipelineDashboard />} />
              <Route path="/pipeline/:jobId" element={<PipelineDetail />} />
              <Route path="/pipelines" element={<PipelineList />} />
              <Route path="/pipelines/:slug" element={<PipelineTypeDetail />} />
              <Route path="/code" element={<Code />} />
            </Routes>
          </BrowserRouter>
        </Theme>
      </ToastProvider>
    </StrictMode>
  );
}

export function mountApp(rootElement: HTMLElement): void {
  createRoot(rootElement).render(<App />);
}

if (typeof document !== "undefined") {
  const rootElement = document.getElementById("root");
  if (rootElement !== null) {
    mountApp(rootElement);
  }
}
