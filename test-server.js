import { startServer } from "./src/ui/server.js";

async function testServer() {
  console.log("Starting server...");
  const server = await startServer({ dataDir: "demo", port: 4001 });
  console.log("Server started at:", server.url);

  // Make a simple request to test
  try {
    const response = await fetch(server.url + "/");
    console.log("Response status:", response.status);
    console.log(
      "Response headers:",
      Object.fromEntries(response.headers.entries())
    );
    console.log(
      "Response headers:",
      Object.fromEntries(response.headers.entries())
    );
    const body = await response.text();
    console.log("Response body length:", body.length);
    console.log("Response body preview:", body.substring(0, 200));
    await server.close();
  } catch (err) {
    console.error("Request failed:", err);
    await server.close();
  }
}
