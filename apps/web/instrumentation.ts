/**
 * Runs once when the server starts. Loads the model catalog now, so the first
 * compare after a deploy doesn't wait for the provider's model list.
 * A failure here is harmless: the first request loads it instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getGateway } = await import("./lib/server/services");
    void getGateway()
      .provider.listModels()
      .catch(() => undefined);
  }
}
