// import React from "react";
// import ReactDOM from "react-dom/client";
// import { Layout } from "../components/Layout.jsx";
// import "../styles/index.css";

// ReactDOM.createRoot(document.getElementById("root")).render(
//   <React.StrictMode>
//     <Layout />
//   </React.StrictMode>
// );

import "./index.css"; // Tailwind + tokens + base

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PromptPipelineDashboard from "@/pages/PromptPipelineDashboard.jsx";
import PipelineDetail from "@/pages/PipelineDetail.jsx";
import Code from "@/pages/Code.jsx";
import PipelineList from "@/pages/PipelineList.jsx";
import { Theme } from "@radix-ui/themes";
import { ToastProvider } from "@/components/ui/toast.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
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
            <Route path="/pipelines" element={<PipelineList />} />
            <Route path="/code" element={<Code />} />
          </Routes>
        </BrowserRouter>
      </Theme>
    </ToastProvider>
  </React.StrictMode>
);
