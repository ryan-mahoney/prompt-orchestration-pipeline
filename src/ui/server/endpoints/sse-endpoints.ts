import { sseRegistry } from "../sse-registry";

export function handleSseEvents(req: Request): Response {
  const jobId = new URL(req.url).searchParams.get("jobId") ?? undefined;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        ctrl = controller;
        sseRegistry.addClient(controller, req.signal, { jobId });
      },
      cancel() {
        if (ctrl) sseRegistry.removeClient(ctrl);
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );
}
