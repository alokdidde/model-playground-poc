import { isProblem, SseParser, type CompareEvent, type CompareRequestInput, type Problem } from "@fomo/shared";

/** A non-2xx API response, carrying the RFC 9457 problem body. */
export class ProblemError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ProblemError";
  }
}

async function toProblemError(res: Response): Promise<ProblemError> {
  const body: unknown = await res.json().catch(() => null);
  return new ProblemError(isProblem(body) ? body : { type: "about:blank", title: res.statusText || "Request failed", status: res.status });
}

export async function fetchJson<T>(url: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  if (init?.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw await toProblemError(res);
  return (await res.json()) as T;
}

/**
 * POST /api/compare and feed each SSE event to `onEvent` as it arrives.
 * Resolves when the server closes the stream.
 */
export async function streamCompare(
  body: CompareRequestInput,
  onEvent: (event: CompareEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/compare", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await toProblemError(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser<CompareEvent>();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const event of parser.push(value)) onEvent(event);
  }
}
