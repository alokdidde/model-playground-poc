import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The DBOS system-database URL, with the database's CA certificate wired in.
 *
 * DBOS connects through node-postgres, which (unlike Prisma) treats
 * `sslmode=require` as `verify-full`. DO Managed Postgres signs its
 * certificates with a per-account CA, so without that CA the TLS handshake
 * fails with "self-signed certificate in certificate chain".
 *
 * When DATABASE_CA_CERT (PEM text, from `doctl databases get-ca`) is set, we
 * write it to a temp file and point `sslrootcert` at it, keeping full
 * certificate and hostname verification. Without it the URL is used as is
 * (local docker compose has no TLS).
 */
export function dbosSystemDatabaseUrl(): string {
  const url = process.env.DBOS_SYSTEM_DATABASE_URL;
  if (!url) throw new Error("DBOS_SYSTEM_DATABASE_URL is not set");
  const ca = process.env.DATABASE_CA_CERT?.trim();
  if (!ca) return url;

  const caPath = join(tmpdir(), "fomo-db-ca.crt");
  writeFileSync(caPath, ca + "\n", { mode: 0o644 });
  const parsed = new URL(url);
  parsed.searchParams.set("sslmode", "verify-full");
  parsed.searchParams.set("sslrootcert", caPath);
  return parsed.toString();
}
