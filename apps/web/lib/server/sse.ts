import { encodeSseEvent, SSE_HEARTBEAT } from "@fomo/shared";

/**
 * Builds a text/event-stream Response. `run` receives an `emit` function and
 * an AbortSignal that fires when the client disconnects. After a disconnect,
 * `emit` quietly does nothing; whether the work stops is up to `run`.
 */
export function sseResponse<E extends { type: string }>(
  requestSignal: AbortSignal,
  run: (emit: (event: E) => void, signal: AbortSignal) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true; // the client went away
        }
      };
      // Keep proxies and load balancers from closing an idle connection.
      const heartbeat = setInterval(() => write(SSE_HEARTBEAT), 15_000);

      try {
        await run((event) => write(encodeSseEvent(event)), requestSignal);
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Stop nginx-style proxies from buffering the stream.
      "x-accel-buffering": "no",
    },
  });
}
