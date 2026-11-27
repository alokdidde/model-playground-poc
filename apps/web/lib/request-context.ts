/**
 * Values that middleware attaches to every request. Kept in a tiny module
 * with no Node imports because middleware runs on the Edge runtime.
 */
export const REQUEST_ID_HEADER = "x-request-id";
export const PRINCIPAL_HEADER = "x-fomo-principal";

/** Who is calling. Today always anonymous; the shape is ready for real auth. */
export interface Principal {
  id: string;
  kind: "anonymous" | "user" | "api-key";
}
