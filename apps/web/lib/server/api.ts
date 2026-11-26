import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@fomo/db";
import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPES, type FieldError, type Problem } from "@fomo/shared";
import { ApiError, errors } from "./errors";
import { logger } from "./logger";
import { PRINCIPAL_HEADER, REQUEST_ID_HEADER, type Principal } from "../request-context";

const MAX_BODY_BYTES = 1_000_000;

type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface HandlerContext<B, Q, P> {
  req: NextRequest;
  body: B;
  query: Q;
  params: P;
  requestId: string;
  principal: Principal;
}

interface RouteDefinition<BS, QS, PS> {
  body?: BS;
  query?: QS;
  params?: PS;
  /** Return a plain object (sent as 200 JSON) or a Response for full control. */
  handler: (ctx: HandlerContext<Infer<BS>, Infer<QS>, Infer<PS>>) => Promise<unknown>;
}

/**
 * Wraps every API route so they all behave the same way:
 *  - validates params, query and JSON body with zod (400 with field errors),
 *  - converts thrown errors into RFC 9457 problem responses,
 *  - logs one structured line per request with the request id and duration,
 *  - exposes the principal set by middleware (anonymous until auth is added).
 */
export function apiRoute<
  BS extends z.ZodType | undefined = undefined,
  QS extends z.ZodType | undefined = undefined,
  PS extends z.ZodType | undefined = undefined,
>(definition: RouteDefinition<BS, QS, PS>) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const startedAt = Date.now();
    const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    const instance = req.nextUrl.pathname;
    let response: Response;

    try {
      const principal = JSON.parse(req.headers.get(PRINCIPAL_HEADER) ?? '{"id":"anonymous","kind":"anonymous"}') as Principal;
      const params = parse(definition.params, await segment.params, "params");
      const query = parse(definition.query, Object.fromEntries(req.nextUrl.searchParams), "query");
      const body = definition.body ? parse(definition.body, await readJson(req), "body") : undefined;

      const result = await definition.handler({
        req,
        body: body as Infer<BS>,
        query: query as Infer<QS>,
        params: params as Infer<PS>,
        requestId,
        principal,
      });
      response = result instanceof Response ? result : NextResponse.json(result);
    } catch (error) {
      response = problemResponse(toApiError(error, requestId), instance, requestId);
    }

    response.headers.set(REQUEST_ID_HEADER, requestId);
    logger.info("request", {
      requestId,
      method: req.method,
      path: instance,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return response;
  };
}

function parse(schema: z.ZodType | undefined, value: unknown, location: "body" | "query" | "params") {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) throw errors.validation(toFieldErrors(result.error, location));
  return result.data;
}

export function toFieldErrors(error: z.ZodError, location: string): FieldError[] {
  return error.issues.map((issue) => ({
    pointer: [location, ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
}

async function readJson(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw errors.unsupportedMediaType();
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw errors.payloadTooLarge(MAX_BODY_BYTES);

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw errors.payloadTooLarge(MAX_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw errors.badRequest("The body is not valid JSON.");
  }
}

function toApiError(error: unknown, requestId: string): ApiError {
  if (error instanceof ApiError) return error;

  // Unique constraint races (e.g. two requests with the same idempotency key).
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return errors.conflict("A resource with the same unique key already exists.");
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.error("database unavailable", { requestId, error: error.message });
    return errors.unavailable("The database is unavailable. Try again shortly.");
  }

  logger.error("unhandled error", {
    requestId,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
  });
  return new ApiError(500, PROBLEM_TYPES.internal, "Internal server error", "Something went wrong. Quote the requestId when reporting it.");
}

export function problemResponse(error: ApiError, instance: string, requestId: string): Response {
  const problem: Problem = error.toProblem(instance, requestId);
  return new Response(JSON.stringify(problem), {
    status: error.status,
    headers: { "content-type": PROBLEM_CONTENT_TYPE, ...error.headers },
  });
}

/** JSON response with an explicit status, e.g. `json(run, 202, { Location: ... })`. */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return NextResponse.json(data, { status, headers });
}

/** Reads and sanity-checks the Idempotency-Key header (IETF draft-ietf-httpapi-idempotency-key-header). */
export function readIdempotencyKey(req: NextRequest): string | undefined {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return undefined;
  if (key.length > 128) throw errors.badRequest("Idempotency-Key must be at most 128 characters.");
  return key;
}
