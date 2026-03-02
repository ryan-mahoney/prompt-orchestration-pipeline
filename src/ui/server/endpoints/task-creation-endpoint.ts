export async function handleTaskPlan(_req: Request): Promise<Response> {
  return new Response(
    "event: started\ndata: {\"ok\":true,\"message\":\"task planning is not implemented in TypeScript yet\"}\n\nevent: complete\ndata: {\"ok\":true}\n\n",
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );
}
