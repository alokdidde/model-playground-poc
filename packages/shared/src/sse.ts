/**
 * Minimal SSE helpers shared by server and client.
 *
 * We use fetch + ReadableStream on the client instead of EventSource because
 * EventSource only supports GET and cannot send a JSON body or headers.
 */

export function encodeSseEvent(event: { type: string }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** A comment line. Proxies (incl. App Platform's) close idle connections; this keeps them open. */
export const SSE_HEARTBEAT = ": heartbeat\n\n";

/**
 * Incremental SSE parser. Feed it decoded text chunks as they arrive; it
 * returns the JSON payloads of the frames completed so far.
 */
export class SseParser<T> {
  private buffer = "";

  push(chunk: string): T[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: T[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) events.push(JSON.parse(data) as T);
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}
