import express from "express";

export function createUIServer(orchestratorApi) {
  const app = express();
  app.use(express.json());

  app.get("/", (req, res) => res.send("Pipeline Orchestrator UI is running."));

  app.get("/api/jobs", async (req, res) => {
    const jobs = await orchestratorApi.listJobs();
    res.json(jobs);
  });

  app.get("/api/jobs/:name/status", async (req, res) => {
    const status = await orchestratorApi.getStatus(req.params.name);
    if (!status) return res.status(404).json({ error: "Not found" });
    res.json(status);
  });

  return app;
}
