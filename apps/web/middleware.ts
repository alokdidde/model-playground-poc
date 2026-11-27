import { NextResponse, type NextRequest } from "next/server";
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
 * Any principal header sent by the client is overwritten, so it cannot be
 * spoofed from outside.
 */
export async function middleware(req: NextRequest) {
  const requestId = sanitizeRequestId(req.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();

  const principal = await authenticate(req);
  if (!principal) {
    return new NextResponse(
      JSON.stringify({
        type: "/problems/unauthorized",
        title: "Unauthorized",
        status: 401,
        instance: req.nextUrl.pathname,
        requestId,
      }),
      { status: 401, headers: { "content-type": "application/problem+json", [REQUEST_ID_HEADER]: requestId } },
    );
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

function sanitizeRequestId(value: string | null): string | null {
  return value && /^[\w.-]{8,128}$/.test(value) ? value : null;
}

export const config = {
  matcher: ["/api/:path*"],
};
