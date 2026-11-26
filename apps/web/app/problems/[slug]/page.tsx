import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Human-readable docs for each RFC 9457 problem `type` we return. The RFC
 * recommends that type URIs resolve to documentation like this.
 */
const DOCS: Record<string, { title: string; body: string }> = {
  "validation-error": { title: "Validation error", body: "The request did not match the API contract. The `errors` array lists each invalid field as a dotted `pointer` (e.g. body.models.0) and a message." },
  "not-found": { title: "Not found", body: "The resource does not exist, or the API path is wrong." },
  conflict: { title: "Conflict", body: "The request conflicts with the current state, e.g. an Idempotency-Key that was already used for a comparison, or cancelling a finished run." },
  "idempotency-key-reused": { title: "Idempotency key reused", body: "The same Idempotency-Key was sent with a different body. Use a fresh key for a new request." },
  "rate-limited": { title: "Rate limited", body: "Either our shared token/request budget for the model provider is exhausted, or the provider returned 429. `retryAfterMs` says when to try again." },
  "upstream-timeout": { title: "Model timed out", body: "The model did not respond (or did not produce a first token) in time, even after retries." },
  "upstream-error": { title: "Model call failed", body: "The model provider returned an error. `upstreamStatus` has the provider's status code when known." },
  unauthorized: { title: "Unauthorized", body: "Authentication failed. (Auth is not enabled in the PoC.)" },
  "internal-error": { title: "Internal error", body: "An unexpected server error. Quote the `requestId` when reporting it." },
  "service-unavailable": { title: "Service unavailable", body: "A dependency (database or queue) is unavailable. Retry after the Retry-After header." },
};

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) notFound();
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{doc.title}</CardTitle>
        <code className="text-muted-foreground text-xs">type: /problems/{slug}</code>
      </CardHeader>
      <CardContent className="text-sm">{doc.body}</CardContent>
    </Card>
  );
}
