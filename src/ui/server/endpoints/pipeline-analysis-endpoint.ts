import { acquireLock, releaseLock } from "../../state/analysis-lock";

export async function handlePipelineAnalysis(_req: Request, slug: string): Promise<Response> {
  const lock = acquireLock(slug);
  if (!lock.acquired) {
    return new Response(JSON.stringify({ ok: false, code: "BAD_REQUEST", message: `analysis lock held by ${lock.heldBy}` }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown): void => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        queueMicrotask(() => {
          try {
            send("started", { slug });
            send("complete", { slug });
            controller.close();
          } finally {
            releaseLock(slug);
          }
        });
      },
      cancel() {
        try {
          releaseLock(slug);
        } catch {}
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

  return response;
}
