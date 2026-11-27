import { NextResponse, type NextRequest } from "next/server";
import { PROBLEM_TYPES } from "@fomo/shared";
import { PRINCIPAL_HEADER, REQUEST_ID_HEADER, type Principal } from "./lib/request-context";

/**
 * Runs before every API route.
 *
 *  1. Request id: reuse the caller's x-request-id (useful behind a proxy) or
 *     mint one, and pass it to the route and back in the response, so a
 *     single id ties together client errors, logs and problem responses.
 *  2. Authentication hook: `authenticate()` decides who is calling. Today it
 *     always returns an anonymous principal. To add auth later, verify a
 *     session cookie, JWT or API key here and return 401 for bad
 *     credentials; route handlers already receive the principal.
 *
 *  3. Cross-site write guard: a POST/PUT/DELETE started by another site's
 *     page is refused with 403 (see isCrossSiteWrite). Without auth this is
 *     what stops a random page from spending our inference budget, or
 *     stopping someone's run, through a visitor's browser.
 *
 * Any principal header sent by the client is overwritten, so it cannot be
 * spoofed from outside.
 */
export async function middleware(req: NextRequest) {
  const requestId = sanitizeRequestId(req.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();

  if (isCrossSiteWrite(req)) {
    return problem(403, PROBLEM_TYPES.forbidden, "Forbidden", "Cross-site requests may not change data.", req, requestId);
  }

  const principal = await authenticate(req);
  if (!principal) {
    return problem(401, PROBLEM_TYPES.unauthorized, "Unauthorized", undefined, req, requestId);
  }

  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set(PRINCIPAL_HEADER, JSON.stringify(principal));

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/** Returns the caller, or null to reject the request with 401. */
async function authenticate(_req: NextRequest): Promise<Principal | null> {
  // Example for later:
  //   const key = req.headers.get("authorization")?.replace(/^Bearer /, "");
  //   if (!key) return null;
  //   return { id: await lookupApiKey(key), kind: "api-key" };
  return { id: "anonymous", kind: "anonymous" };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True for a state-changing request that a browser sent from another origin.
 *
 * Browsers send Sec-Fetch-Site on every request; only "same-origin" (our own
 * pages) and "none" (typed into the address bar) are allowed. "same-site" is
 * refused too, because on *.ondigitalocean.app other people's apps are the
 * same site. Older browsers without it fall back to comparing Origin with
 * Host. Non-browser clients (curl, scripts) send neither and pass: they are
 * not a CSRF vector, and real abuse control needs auth plus quotas.
 */
export function isCrossSiteWrite(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" or garbage
  }
}

function problem(status: number, type: string, title: string, detail: string | undefined, req: NextRequest, requestId: string) {
  return new NextResponse(
    JSON.stringify({ type, title, status, ...(detail ? { detail } : {}), instance: req.nextUrl.pathname, requestId }),
    { status, headers: { "content-type": "application/problem+json", [REQUEST_ID_HEADER]: requestId } },
  );
}

function sanitizeRequestId(value: string | null): string | null {
  return value && /^[\w.-]{8,128}$/.test(value) ? value : null;
}

export const config = {
  matcher: ["/api/:path*"],
};
