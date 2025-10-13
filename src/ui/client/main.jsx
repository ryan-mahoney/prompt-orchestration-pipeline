import "./index.css"; // Tailwind + tokens + base
import "./style.css"; // optional overrides LAST

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PromptPipelineDashboard from "@/pages/PromptPipelineDashboard.jsx";
import PipelineDetail from "@/pages/PipelineDetail.jsx";
import { Theme } from "@radix-ui/themes";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Theme
      accentColor="iris"
      grayColor="gray"
      panelBackground="solid"
      scaling="100%"
      radius="full"
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PromptPipelineDashboard />} />
          <Route path="/pipeline/:jobId" element={<PipelineDetail />} />
        </Routes>
      </BrowserRouter>
    </Theme>
  </React.StrictMode>
);
