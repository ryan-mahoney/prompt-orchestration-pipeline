import "./index.css"; // Tailwind + tokens + base
import "./style.css"; // optional overrides LAST

import React from "react";
import ReactDOM from "react-dom/client";
import PromptPipelineDashboard from "@/pages/PromptPipelineDashboard.jsx";
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
      <PromptPipelineDashboard />
    </Theme>
  </React.StrictMode>
);
